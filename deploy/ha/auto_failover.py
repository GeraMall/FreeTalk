"""Single-candidate, fenced HA controller. No automatic failback or power-on."""
import concurrent.futures
import json
import hashlib
import os
import pathlib
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from hostkey_provider import Hostkey

CONFIG=pathlib.Path('/etc/trlka-ha/automatic.json')
PROOF=pathlib.Path('/run/trlka-ha/owner.json')
ACTIVATION=pathlib.Path('/var/lib/trlka-ha-controller/activated-epoch')
LSN=re.compile(r'^[0-9A-F]+/[0-9A-F]+$',re.I)
_last_log={'signature':None,'at':0}

def log(event,**fields):
    line=json.dumps({'event':event,**fields})
    if line==_last_log['signature'] and time.monotonic()-_last_log['at']<60:return
    _last_log.update(signature=line,at=time.monotonic())
    print(line,flush=True)

def run(*args,timeout=30):
    result=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if result.returncode:raise RuntimeError('Command failed: '+args[0])
    return result.stdout.strip()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):raise RuntimeError('Redirect prohibited')

class Witness:
    def __init__(self,config):
        self.url=config['witness_url'].rstrip('/')
        if not re.fullmatch(r'https://trlka-ha-witness\.[a-z0-9-]+\.workers\.dev',self.url):
            raise ValueError('Unexpected witness URL')
        self.token=pathlib.Path('/etc/trlka-ha/witness.key').read_text().strip()
        self.cached=None;self.cached_until=0
        context=ssl.create_default_context()
        if config.get('witness_tls12'):context.maximum_version=ssl.TLSVersion.TLSv1_2
        self.opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=context))
    def call(self,operation='state',**body):
        if operation=='state' and self.cached is not None and time.monotonic()<self.cached_until:
            return dict(self.cached)
        request=urllib.request.Request(self.url+'/'+operation,
            data=json.dumps(body).encode() if operation!='state' else None,
            headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json','Cache-Control':'no-store','User-Agent':'TRLKA-HA/1.0'},
            method='GET' if operation=='state' else 'POST')
        with self.opener.open(request,timeout=10) as response:
            value=json.loads(response.read(4096))
        if (not isinstance(value,dict) or value.get('owner') not in ('moscow','petersburg')
            or type(value.get('epoch')) is not int or value['epoch']<1
            or type(value.get('reserveEligible')) is not bool
            or type(value.get('fencePending')) is not bool
            or (value['reserveEligible'] and (not isinstance(value.get('syncLsn'),str) or not LSN.fullmatch(value['syncLsn'])))):
            raise RuntimeError('Invalid witness response')
        self.cached=dict(value);self.cached_until=time.monotonic()+30
        return value

class Database:
    def query(self,sql,timeout=10):
        return run('psql','-U','postgres','-d','postgres','-AtX','-v','ON_ERROR_STOP=1','-c',sql,timeout=timeout)
    def recovery(self):return self.query('SELECT pg_is_in_recovery()')=='t'
    def sync_enabled(self):return self.query('SHOW synchronous_standby_names')=='FIRST 1 (trlka_petersburg)'
    def sync(self,enabled):
        value='FIRST 1 (trlka_petersburg)' if enabled else ''
        if self.query('SHOW synchronous_standby_names')!=value:
            self.query("ALTER SYSTEM SET synchronous_standby_names = '"+value+"'")
            self.query('SELECT pg_reload_conf()')
        if self.query('SHOW synchronous_commit')!='on':
            self.query("ALTER SYSTEM SET synchronous_commit = 'on'")
            self.query('SELECT pg_reload_conf()')
    def streaming(self):
        # A black-holed WireGuard path can still be reported as streaming until
        # wal_sender_timeout (60 s). Do not hold all API commits for that timeout.
        # The receiver normally acknowledges at least every 10 s. Eligibility
        # must still be revoked by the witness before disabling synchronous WAL.
        return self.query("SELECT count(*) FROM pg_stat_replication WHERE application_name='trlka_petersburg' AND state='streaming' AND reply_time >= clock_timestamp() - interval '20 seconds'")=='1'
    def barrier(self):
        value=self.query('SELECT pg_current_wal_flush_lsn()')
        if not LSN.fullmatch(value):raise RuntimeError('Invalid WAL barrier')
        for _ in range(20):
            if self.query("SELECT COALESCE(bool_or(flush_lsn >= '"+value+"'::pg_lsn),false) FROM pg_stat_replication WHERE application_name='trlka_petersburg' AND state='streaming'")=='t':return value
            time.sleep(1)
        raise RuntimeError('Reserve has not flushed the sync barrier')
    def replay_ready(self,barrier):
        if not isinstance(barrier,str) or not LSN.fullmatch(barrier):return False
        return self.query("SELECT pg_is_in_recovery() AND NOT pg_is_wal_replay_paused() AND COALESCE(pg_last_wal_replay_lsn() >= '"+barrier+"'::pg_lsn,false)")=='t'
    def promote(self):
        if self.query('SELECT pg_promote(true,60)',timeout=75)!='t' or self.recovery():
            raise RuntimeError('Promotion failed')

def save_proof(node,state):
    PROOF.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
    temp=PROOF.with_suffix('.tmp')
    temp.write_text(json.dumps({'node':node,'owner':state['owner'],'epoch':state['epoch'],
        'until':time.time()+150,'allowAsync':not state['reserveEligible'],'fencePending':state['fencePending']}))
    temp.chmod(0o644);os.replace(temp,PROOF)

class Runtime:
    def ensure_database(self):run('systemctl','start','postgresql@16-main',timeout=45)
    def primary_reachable(self):
        urls=[('http://10.73.54.1:18080/api/health',{'Host':'freetalk.185-225-201-129.sslip.io'}),
              ('https://freetalk.185-225-201-129.sslip.io/api/health',{})]
        def probe(entry):
            try:
                with urllib.request.urlopen(urllib.request.Request(entry[0],headers=entry[1]),timeout=4) as response:
                    data=json.loads(response.read(4096))
                    return response.status==200 and data.get('ok') is True and data.get('service')=='freetalk-api'
            except Exception:return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:return any(pool.map(probe,urls))
    def standby_files_ready(self):
        root=pathlib.Path('/var/lib/trlka-ha-standby-files')
        config=pathlib.Path('/root/trlka-ha/Caddyfile.failover')
        try:
            ready=json.loads(pathlib.Path('/var/lib/trlka-ha-controller/files-ready.json').read_text())
            # Publication already hashes every payload file. Do not re-read all
            # installers from a small reserve disk in the outage critical path.
            digest=hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()
            return (0<=time.time()-ready['publishedAt']<1200 and digest==ready['sha256']
                and config.read_bytes()==(root/'Caddyfile.failover').read_bytes())
        except Exception:return False
    def freeze_sync(self):
        run('systemctl','stop','trlka-ha-sync.timer')
        # Let a local publication finish; never kill it in the middle of replacing files.
        for _ in range(180):
            state=run('systemctl','show','trlka-ha-sync.service','-p','ActiveState','--value')
            if state not in ('active','activating','deactivating'):return
            time.sleep(1)
        raise RuntimeError('Standby file synchronization did not quiesce')
    def activate_reserve(self):
        staged=pathlib.Path('/var/lib/trlka-ha-controller/last-good-caddy/.local/share/caddy/certificates')
        dest=pathlib.Path('/var/lib/caddy/.local/share/caddy/certificates')
        for issuer in staged.iterdir():
            if not issuer.is_dir():continue
            for name in ('trlka.com','www.trlka.com','freetalk.185-225-201-129.sslip.io'):
                source=issuer/name
                if not source.is_dir():continue
                target=dest/issuer.name/name
                shutil.copytree(source,target,dirs_exist_ok=True)
                run('chown','-R','caddy:caddy',str(target))
        config='/root/trlka-ha/Caddyfile.failover'
        run('caddy','validate','--config',config)
        pathlib.Path('/etc/trlka-ha/role').write_text('primary\n')
        run('systemctl','start','freetalk-api',timeout=75)
        run('systemctl','start','freetalk-signaling',timeout=45)
        for port,service in [(8790,'freetalk-api'),(8787,'freetalk-signaling')]:
            for attempt in range(20):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=5) as response:
                        health=json.loads(response.read(4096))
                    if health.get('ok') is True and health.get('service')==service:break
                except Exception:pass
                if attempt==19:raise RuntimeError('Promoted service is not healthy')
                time.sleep(1)
        shutil.copyfile(config,'/etc/caddy/Caddyfile')
        os.chmod('/etc/caddy/Caddyfile',0o644)
        run('systemctl','reload','caddy')
        run('systemctl','start','--no-block','trlka-ha-dns.service')
    def ensure_primary_services(self):
        self.ensure_database()
        run('systemctl','start','freetalk-api','freetalk-signaling',timeout=90)
        run('systemctl','start','caddy',timeout=45)
    def retire(self):
        run('systemctl','stop','freetalk-signaling','freetalk-api',timeout=45)
        run('systemctl','stop','postgresql@16-main',timeout=45)
        # Never start an old primary after ownership has moved elsewhere.
        PROOF.unlink(missing_ok=True)

class Controller:
    def __init__(self,config,db,witness,provider,runtime,clock=time.monotonic):
        self.config=config;self.db=db;self.witness=witness;self.provider=provider;self.runtime=runtime;self.clock=clock
        self.down_since=None
    def tick(self):
        if not self.config.get('armed'):
            state=self.witness.call();log('ha.observe',node=self.config['node'],owner=state['owner'],epoch=state['epoch']);return
        if self.config['node']=='moscow':return self.primary()
        return self.reserve()
    def primary(self):
        state=self.witness.call()
        if state['owner']!='moscow':
            self.runtime.retire();log('ha.retired',owner=state['owner']);return
        if state['fencePending']:
            # The reserve has frozen eligibility. Never disable sync in this state.
            log('ha.fencing-pending');return
        self.runtime.ensure_database()
        if self.db.recovery():raise RuntimeError('Owned primary unexpectedly remains in recovery')
        if self.db.streaming():
            self.db.sync(True)
            if not state['reserveEligible']:
                barrier=self.db.barrier()
                state=self.witness.call('eligibility',epoch=state['epoch'],eligible=True,lsn=barrier)
        else:
            # This acknowledgement MUST precede allowing unreplicated commits.
            if state['reserveEligible']:
                state=self.witness.call('eligibility',epoch=state['epoch'],eligible=False)
            self.db.sync(False)
        save_proof('moscow',state)
        self.runtime.ensure_primary_services()
        log('ha.primary',epoch=state['epoch'],synchronous=state['reserveEligible'])
    def reserve(self):
        state=self.witness.call()
        if state['owner']=='petersburg':
            return self.finish_promotion(state)
        PROOF.unlink(missing_ok=True)
        self.runtime.ensure_database()
        if not self.db.recovery():raise RuntimeError('Reserve unexpectedly writable before ownership transfer')
        if self.runtime.primary_reachable() and not state['fencePending']:
            self.down_since=None;return
        if self.down_since is None:self.down_since=self.clock()
        if not state['fencePending'] and self.clock()-self.down_since<self.config.get('failure_seconds',90):return
        if not state['reserveEligible'] or not self.db.replay_ready(state['syncLsn']):
            log('ha.promotion-refused',reason='reserve-not-synchronously-eligible');return
        if not self.runtime.standby_files_ready():
            log('ha.promotion-refused',reason='standby-files-stale');return
        self.runtime.freeze_sync()
        # Synchronization may have completed between preflight and freezing.
        if not self.runtime.standby_files_ready():
            raise RuntimeError('Standby publication changed before fencing')
        if not state['fencePending']:
            state=self.witness.call('begin-fence',epoch=state['epoch'])
        # Provider must prove power-off. A network timeout is never fencing proof.
        self.provider.fence()
        state=self.witness.call('claim',epoch=state['epoch'],fenced=True)
        self.finish_promotion(state)
    def finish_promotion(self,state):
        if state['owner']!='petersburg':raise RuntimeError('Wrong owner for promotion')
        self.runtime.ensure_database()
        if self.db.recovery():
            self.runtime.freeze_sync()
            self.db.promote()
        # Also repair a restart between pg_promote and disabling the old sync peer.
        self.db.sync(False)
        save_proof('petersburg',state)
        activation=ACTIVATION
        if not activation.is_file() or activation.read_text().strip()!=str(state['epoch']):
            self.runtime.activate_reserve()
            activation.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            activation.write_text(str(state['epoch']))
            log('ha.promoted',epoch=state['epoch'])
        else:
            self.runtime.ensure_primary_services()

def main():
    import fcntl
    singleton=open('/run/lock/trlka-ha-automatic.lock','w')
    fcntl.flock(singleton,fcntl.LOCK_EX|fcntl.LOCK_NB)
    config=json.loads(CONFIG.read_text())
    if config.get('node') not in ('moscow','petersburg'):raise ValueError('Invalid node')
    controller=Controller(config,Database(),Witness(config),Hostkey(),Runtime())
    while True:
        try:
            config.update(json.loads(CONFIG.read_text()))
            if not pathlib.Path('/etc/trlka-ha/automatic-paused').exists():controller.tick()
        except Exception as error:
            log('ha.operation-failed',error=type(error).__name__)
        time.sleep(5)

if __name__=='__main__':main()

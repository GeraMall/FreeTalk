import pathlib
import tempfile
import unittest
from unittest.mock import patch
import auto_failover as ha
from hostkey_provider import Hostkey,ProviderError

class FakeDB:
    def __init__(self,events,recovery=True,streaming=True):
        self.events=events;self.in_recovery=recovery;self.connected=streaming;self.caught_up=True
    def recovery(self):return self.in_recovery
    def streaming(self):return self.connected
    def sync(self,enabled):self.events.append(('sync',enabled))
    def barrier(self):self.events.append('barrier');return '0/900'
    def replay_ready(self,barrier):return self.caught_up
    def promote(self):self.events.append('promote');self.in_recovery=False

class FakeWitness:
    def __init__(self,events):
        self.events=events;self.fail_eligibility=False
        self.state={'epoch':1,'owner':'moscow','reserveEligible':True,'syncLsn':'0/800','fencePending':False}
    def call(self,operation='state',**body):
        if operation!='state':self.events.append((operation,body))
        if operation=='eligibility':
            if self.fail_eligibility:raise RuntimeError('Witness unavailable')
            self.state.update(reserveEligible=body['eligible'])
        elif operation=='begin-fence':self.state['fencePending']=True
        elif operation=='claim':self.state.update(owner='petersburg',epoch=2,reserveEligible=False,fencePending=False)
        return dict(self.state)

class FakeProvider:
    def __init__(self,events):self.events=events;self.confirmed=True
    def fence(self):
        self.events.append('fence')
        if not self.confirmed:raise ProviderError('Cannot prove power-off')

class FakeRuntime:
    def __init__(self,events):self.events=events;self.reachable=False;self.fresh=True
    def primary_reachable(self):return self.reachable
    def standby_files_ready(self):return self.fresh
    def freeze_sync(self):self.events.append('freeze-sync')
    def activate_reserve(self):self.events.append('activate')
    def ensure_database(self):pass
    def ensure_primary_services(self):self.events.append('services')
    def retire(self):self.events.append('retire')

class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.events=[];self.db=FakeDB(self.events);self.w=FakeWitness(self.events)
        self.p=FakeProvider(self.events);self.runtime=FakeRuntime(self.events)
        self.config={'node':'petersburg','armed':True,'failure_seconds':90}
        self.now=100
        self.c=ha.Controller(self.config,self.db,self.w,self.p,self.runtime,lambda:self.now)
        self.temp=tempfile.TemporaryDirectory()
        self.patch_activation=patch.object(ha,'ACTIVATION',pathlib.Path(self.temp.name)/'epoch')
        self.patch_activation.start()
        self.patch_proof=patch.object(ha,'save_proof',lambda node,state:self.events.append('proof'))
        self.patch_proof.start()
    def tearDown(self):
        self.patch_activation.stop();self.patch_proof.stop();self.temp.cleanup()
    def fail_long_enough(self):
        self.c.tick();self.now+=91;self.c.tick()
    def test_transient_failure_does_not_fence(self):
        self.c.tick();self.now+=40;self.runtime.reachable=True;self.c.tick()
        self.assertNotIn('fence',self.events)
        self.assertIsNone(self.c.down_since)
    def test_power_off_must_precede_claim_and_promotion(self):
        self.fail_long_enough()
        names=[entry[0] if isinstance(entry,tuple) else entry for entry in self.events]
        self.assertLess(names.index('begin-fence'),names.index('fence'))
        self.assertLess(names.index('fence'),names.index('claim'))
        self.assertLess(names.index('claim'),names.index('promote'))
        self.assertLess(names.index('promote'),names.index('activate'))
        self.c.tick()
        self.assertEqual(self.events.count('promote'),1)
        self.assertEqual(self.events.count('activate'),1)
    def test_provider_timeout_never_promotes_or_claims(self):
        self.p.confirmed=False
        self.c.tick();self.now+=91
        with self.assertRaises(ProviderError):self.c.tick()
        self.assertNotIn('promote',self.events)
        self.assertFalse(any(isinstance(e,tuple) and e[0]=='claim' for e in self.events))
    def test_restart_after_promotion_still_disables_the_missing_sync_peer(self):
        self.w.state.update(owner='petersburg',epoch=2,reserveEligible=False)
        self.db.in_recovery=False
        self.c.tick()
        self.assertIn(('sync',False),self.events)
        self.assertLess(self.events.index(('sync',False)),self.events.index('activate'))
    def test_stale_replica_or_files_never_fences(self):
        for attr in ('db','files','eligibility'):
            self.events.clear();self.db.caught_up=True;self.runtime.fresh=True;self.w.state['reserveEligible']=True
            if attr=='db':self.db.caught_up=False
            elif attr=='files':self.runtime.fresh=False
            else:self.w.state['reserveEligible']=False
            self.c.down_since=0;self.c.tick()
            self.assertNotIn('fence',self.events)
    def test_witness_revocation_precedes_async_commits(self):
        self.config['node']='moscow';self.db.in_recovery=False;self.db.connected=False
        self.c.tick()
        names=[entry[0] if isinstance(entry,tuple) else entry for entry in self.events]
        self.assertLess(names.index('eligibility'),names.index('sync'))
        self.assertIn(('sync',False),self.events)
    def test_failed_revocation_keeps_synchronous_writes_required(self):
        self.config['node']='moscow';self.db.in_recovery=False;self.db.connected=False;self.w.fail_eligibility=True
        with self.assertRaises(RuntimeError):self.c.tick()
        self.assertNotIn(('sync',False),self.events)
    def test_resync_barrier_precedes_eligibility(self):
        self.config['node']='moscow';self.db.in_recovery=False;self.w.state['reserveEligible']=False
        self.c.tick()
        names=[entry[0] if isinstance(entry,tuple) else entry for entry in self.events]
        self.assertLess(names.index('sync'),names.index('barrier'))
        self.assertLess(names.index('barrier'),names.index('eligibility'))
    def test_fencing_intent_blocks_primary_degradation(self):
        self.config['node']='moscow';self.db.in_recovery=False;self.db.connected=False;self.w.state['fencePending']=True
        self.c.tick()
        self.assertNotIn(('sync',False),self.events)
    def test_retired_primary_never_starts_services(self):
        self.config['node']='moscow';self.db.in_recovery=False;self.w.state['owner']='petersburg'
        self.c.tick()
        self.assertEqual(self.events,['retire'])
    def test_observation_mode_never_changes_database_or_power(self):
        self.config['armed']=False;self.c.down_since=0
        self.c.tick();self.assertEqual(self.events,[])

class ProviderTests(unittest.TestCase):
    def test_unrelated_actions_and_power_on_are_prohibited(self):
        with self.assertRaises(ProviderError):Hostkey().call('on')
        with self.assertRaises(ProviderError):Hostkey().call('reinstall')
    def test_callback_must_match_the_selected_server(self):
        provider=Hostkey()
        provider.callback=lambda _: {'result':'OK','scope':'STOPPED','context':{'id':123}}
        with self.assertRaises(ProviderError):provider.completed('test')
    @patch('hostkey_provider.time.sleep')
    def test_already_powered_off_needs_two_fresh_status_confirmations(self,_):
        provider=Hostkey();provider.login=lambda:None
        calls=[]
        def status():calls.append('status');return 'SHUTDOWN'
        provider.status=status
        provider.call=lambda action: self.fail('Must not submit off for an already fenced server')
        provider.fence()
        self.assertEqual(calls,['status','status'])
    @patch('hostkey_provider.time.sleep')
    def test_powering_down_is_not_confirmed_power_off(self,_):
        provider=Hostkey();provider.login=lambda:None;provider.call=lambda _: 'job'
        provider.completed=lambda _: {'result':'OK'};provider.status=lambda:'POWERING_DOWN'
        with self.assertRaises(ProviderError):provider.fence()

if __name__=='__main__':unittest.main()

"""Restricted REG.API client: only TRLKA's apex address and cache lifetime."""
import json
import pathlib
import ssl
import urllib.parse
import urllib.request

PRIMARY='185.225.201.129'
RESERVE='191.44.38.60'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):raise RuntimeError('DNS API redirect prohibited')


class RegDns:
    def __init__(self,path='/etc/trlka-ha/regru-api.json'):
        self.secret=json.loads(pathlib.Path(path).read_text())
        if self.secret.get('domain')!='trlka.com':raise ValueError('Unexpected DNS scope')
        context=ssl.create_default_context()
        context.maximum_version=ssl.TLSVersion.TLSv1_2
        self.opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=context))

    def call(self,operation,**fields):
        if operation not in ('get_resource_records','add_alias','remove_record','update_soa'):
            raise ValueError('DNS operation prohibited')
        if operation=='add_alias' and (fields.get('subdomain')!='@' or fields.get('ipaddr') not in (PRIMARY,RESERVE)):
            raise ValueError('Unexpected DNS target')
        if operation=='remove_record' and (fields.get('subdomain')!='@' or fields.get('record_type')!='A' or fields.get('content') not in (PRIMARY,RESERVE)):
            raise ValueError('Unexpected DNS deletion')
        body={'username':self.secret['username'],'password':self.secret['password'],
              'domain_name':'trlka.com','output_format':'json',**fields}
        url='https://api.reg.ru/api/regru2/zone/'+operation
        request=urllib.request.Request(url,data=urllib.parse.urlencode(body).encode(),
            headers={'User-Agent':'TRLKA-HA/1.0'},method='POST')
        try:
            with self.opener.open(request,timeout=25) as response:
                result=json.loads(response.read(1024*1024))
            if result.get('result')!='success':raise RuntimeError('DNS API rejected request')
            domains=result.get('answer',{}).get('domains',[])
            if len(domains)!=1 or domains[0].get('dname')!='trlka.com' or domains[0].get('result')!='success':
                raise RuntimeError('DNS API domain result mismatch')
            return domains[0]
        except Exception as error:
            raise RuntimeError('REG.RU operation failed: '+type(error).__name__) from None

    def zone(self):return self.call('get_resource_records')

    @staticmethod
    def addresses(zone):
        rows=zone.get('rrs',[])
        addresses={r['content'] for r in rows if r.get('subname')=='@' and r.get('rectype')=='A' and r.get('state')=='A'}
        if not addresses or not addresses.issubset({PRIMARY,RESERVE}):
            raise RuntimeError('Apex DNS differs from the approved server addresses')
        if any(r.get('subname')=='@' and r.get('rectype') in ('AAAA','CNAME') for r in rows):
            raise RuntimeError('Conflicting apex DNS records')
        return addresses

    def short_ttl(self):
        before=self.zone()
        self.addresses(before)
        self.call('update_soa',ttl='300',minimum_ttl='300')
        after=self.zone()
        if before['rrs']!=after['rrs']:raise RuntimeError('DNS records changed during TTL update')
        # REG.RU currently clamps the ordinary zone TTL to at least one hour.
        if after.get('soa',{}).get('ttl') not in ('300',300,'5m','3600',3600,'1h'):
            raise RuntimeError('DNS TTL was not shortened')
        return after['soa']

    def reserve_address(self):
        before=self.zone()
        addresses=self.addresses(before)
        if addresses=={RESERVE}:return False
        untouched=[r for r in before['rrs'] if not (r.get('subname')=='@' and r.get('rectype')=='A')]
        # Add first: interrupted calls never leave the apex without an A record.
        # A lost response is reconciled by re-reading on the next timer tick.
        if RESERVE not in addresses:self.call('add_alias',subdomain='@',ipaddr=RESERVE)
        if self.addresses(self.zone())=={PRIMARY,RESERVE}:
            self.call('remove_record',subdomain='@',record_type='A',content=PRIMARY)
        after=self.zone()
        if self.addresses(after)!={RESERVE}:raise RuntimeError('Reserve DNS update not confirmed')
        if untouched!=[r for r in after['rrs'] if not (r.get('subname')=='@' and r.get('rectype')=='A')]:
            raise RuntimeError('Unrelated DNS records changed')
        return True


def main():
    from auto_failover import CONFIG,PROOF,Witness,log
    from primary_guard import permitted
    import time
    config=json.loads(CONFIG.read_text())
    if config.get('node')!='petersburg' or not config.get('armed'):return
    try:proof=json.loads(PROOF.read_text())
    except Exception:return
    if not permitted(config,proof,time.time()):return
    state=Witness(config).call()
    if state['owner']!='petersburg' or state['epoch']!=proof['epoch'] or state['fencePending']:
        raise RuntimeError('DNS ownership not confirmed')
    with urllib.request.urlopen('http://127.0.0.1:8790/health',timeout=5) as response:
        health=json.loads(response.read(4096))
    if health.get('ok') is not True or health.get('service')!='freetalk-api':
        raise RuntimeError('Reserve API is not ready for DNS')
    changed=RegDns().reserve_address()
    log('ha.dns-reserve',changed=changed)


if __name__=='__main__':main()

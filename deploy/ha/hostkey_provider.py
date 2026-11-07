"""HOSTKEY control plane. Tokens stay in memory; responses are never logged whole."""
import json
import pathlib
import time
import urllib.parse
import urllib.request

class ProviderError(RuntimeError):
    pass

class Hostkey:
    BASE='https://invapi.hostkey.ru/'
    def __init__(self,key_file='/etc/trlka-ha/hostkey-api.key',server_id=83515):
        self.key_file=pathlib.Path(key_file)
        self.server_id=int(server_id)
        self.token=None
    def request(self,endpoint,**fields):
        data=urllib.parse.urlencode(fields).encode()
        request=urllib.request.Request(self.BASE+endpoint,data=data,method='POST',headers={'Content-Type':'application/x-www-form-urlencoded'})
        try:
            with urllib.request.urlopen(request,timeout=20) as response:
                if response.geturl()!=self.BASE+endpoint:raise ProviderError('Unexpected provider redirect')
                return json.loads(response.read(512*1024))
        except Exception as error:
            raise ProviderError('HOSTKEY request failed: '+type(error).__name__) from None
    def login(self):
        response=self.request('auth.php',action='login',key=self.key_file.read_text().strip())
        result=response.get('result')
        if not isinstance(result,dict) or not isinstance(result.get('token'),str):
            raise ProviderError('HOSTKEY login rejected')
        servers=result.get('servers',[])
        if not isinstance(servers,list) or self.server_id not in [int(s) for s in servers]:
            raise ProviderError('HOSTKEY server scope mismatch')
        self.token=result['token']
        return {'server_id':self.server_id,'scope_verified':True}
    def call(self,action):
        if action not in ('status','off','hard_off'):
            raise ProviderError('Power-on and unrelated provider actions are prohibited')
        if not self.token:self.login()
        response=self.request('eq.php',action=action,id=self.server_id,token=self.token)
        if response.get('result')!='OK':raise ProviderError('HOSTKEY '+action+' rejected')
        callback=response.get('callback')
        if not isinstance(callback,str) or not callback:raise ProviderError('HOSTKEY callback missing')
        return callback
    def callback(self,key):
        return self.request('eq_callback.php',action='check',key=key)
    def completed(self,key,timeout=90):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            response=self.callback(key)
            if response.get('result')=='OK':
                context=response.get('context',{})
                if str(context.get('id'))!=str(self.server_id):
                    raise ProviderError('HOSTKEY callback server mismatch')
                return response
            if response.get('result') not in ('Not ready','WAIT','RUNNING'):
                raise ProviderError('HOSTKEY task failed or returned unknown state')
            time.sleep(2)
        raise ProviderError('HOSTKEY task timed out')
    def status(self):
        response=self.completed(self.call('status'))
        status=response.get('scope')
        if not isinstance(status,str):raise ProviderError('Missing power status')
        return status.upper()
    def fence(self):
        self.login()
        # HOSTKEY eq/status reports SHUTDOWN for this VPS when Invapi shows
        # "Powered off" and the VM's hypervisor state is SHUTOFF.
        off_states={'STOPPED','SHUTOFF','SHUTDOWN','POWERED_OFF','OFF'}
        # A hosting outage may have already stopped the machine. Requiring a
        # second stop action would incorrectly block promotion on such faults.
        if self.status() in off_states:
            time.sleep(3)
            if self.status() in off_states:return
        self.completed(self.call('off'))
        for attempt in range(8):
            state=self.status()
            if state in off_states:
                time.sleep(3)
                if self.status() in off_states:return
            if attempt==4:self.completed(self.call('hard_off'))
            time.sleep(3)
        raise ProviderError('Cannot confirm that the primary is powered off')

if __name__=='__main__':
    p=Hostkey()
    print(json.dumps(p.login()))
    key=p.call('status')
    for _ in range(30):
        response=p.callback(key)
        # Diagnostic prints only key names, never tokens or echoed request fields.
        print(json.dumps({'callback_fields':list(response),'result_type':type(response.get('result')).__name__, 'result':response.get('result') if isinstance(response.get('result'),str) and len(response['result'])<24 else '[structured]'}))
        result=response.get('result')
        if result == 'OK':
            for name in ('status','power','power_status','state','message','scope','context','data'):
                value=response.get(name)
                if isinstance(value,dict):print(json.dumps({name+'_fields':list(value)}))
                elif isinstance(value,str) and len(value)<120:print(json.dumps({name:value}))
            break
        time.sleep(2)

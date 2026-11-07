import copy
import unittest
from regru_dns import RegDns,PRIMARY,RESERVE


def a(ip):return {'subname':'@','rectype':'A','state':'A','content':ip}


class FakeDns(RegDns):
    def __init__(self):
        self.rows=[a(PRIMARY),{'subname':'www','rectype':'CNAME','content':'trlka.com.','state':'A'}]
        self.operations=[];self.lose_add_response=False
    def call(self,operation,**fields):
        self.operations.append((operation,fields))
        if operation=='add_alias':
            self.rows.append(a(fields['ipaddr']))
            if self.lose_add_response:raise RuntimeError('Response lost after write')
        if operation=='remove_record':self.rows=[r for r in self.rows if r!=a(fields['content'])]
        return {'dname':'trlka.com','result':'success','rrs':copy.deepcopy(self.rows)}


class DnsTests(unittest.TestCase):
    def test_adds_reserve_before_removing_only_the_old_apex_and_preserves_www(self):
        dns=FakeDns()
        self.assertTrue(dns.reserve_address())
        writes=[op for op,_ in dns.operations if op!='get_resource_records']
        self.assertEqual(writes,['add_alias','remove_record'])
        self.assertEqual(dns.rows[0]['rectype'],'CNAME')
        self.assertEqual(dns.addresses(dns.zone()),{RESERVE})
        self.assertFalse(dns.reserve_address())
    def test_lost_add_response_reconciles_without_duplicate_writes_or_missing_apex(self):
        dns=FakeDns();dns.lose_add_response=True
        with self.assertRaises(RuntimeError):dns.reserve_address()
        self.assertEqual(dns.addresses(dns.zone()),{PRIMARY,RESERVE})
        dns.lose_add_response=False
        dns.reserve_address()
        self.assertEqual(sum(op=='add_alias' for op,_ in dns.operations),1)
        self.assertEqual(dns.addresses(dns.zone()),{RESERVE})
    def test_unexpected_dns_addresses_are_never_overwritten(self):
        dns=FakeDns();dns.rows.append(a('203.0.113.55'))
        with self.assertRaises(RuntimeError):dns.reserve_address()
        self.assertEqual([op for op,_ in dns.operations],['get_resource_records'])


if __name__=='__main__':unittest.main()

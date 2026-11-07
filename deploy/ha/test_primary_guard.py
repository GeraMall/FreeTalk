import unittest
from primary_guard import permitted


class GuardTests(unittest.TestCase):
    def test_requires_current_owner_and_fresh_unfenced_proof(self):
        config={'node':'moscow','armed':True}
        proof={'node':'moscow','owner':'moscow','epoch':1,'until':250,'fencePending':False}
        self.assertTrue(permitted(config,proof,100))
        for change in ({'owner':'petersburg'},{'node':'petersburg'},{'epoch':True},
                       {'until':99},{'until':500},{'fencePending':True}):
            self.assertFalse(permitted(config,{**proof,**change},100))
        self.assertFalse(permitted({**config,'armed':False},proof,100))
        self.assertFalse(permitted(config,{},100))


if __name__=='__main__':unittest.main()

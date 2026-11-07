import json
import pathlib
import tempfile
import time
import unittest
from snapshot_manifest import PAYLOAD,entries,verify


class SnapshotTests(unittest.TestCase):
    def test_mixed_or_partial_export_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder)
            for name in PAYLOAD:
                path=root/name
                if '.' in name:path.write_text('bundle')
                else:path.mkdir();(path/'payload').write_text('first')
            (root/'manifest.json').write_text(json.dumps({'version':1,'createdAt':time.time(),'entries':entries(root)}))
            self.assertEqual(len(verify(root)),64)
            (root/'api/payload').write_text('changed during export')
            with self.assertRaises(RuntimeError):verify(root)


if __name__=='__main__':unittest.main()

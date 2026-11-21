import hashlib
import json
import os
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


HELPER = runpy.run_path(str(Path(__file__).with_name("install-update")))
update_error = HELPER["UpdateError"]
fixture = b"test package content"


def manifest(**changes):
    fields = {"url": "https://example.com/update.deb", "size": len(fixture)}
    fields["sha256"] = hashlib.sha256(fixture).hexdigest()
    fields.update(changes)
    return json.dumps({
        "schema": 1,
        "version": "0.4.0-beta.233",
        "platforms": {"deb": fields},
    }).encode()


class SignedMetadataTest(unittest.TestCase):
    def test_maps_beta_version_and_preserves_hash(self):
        self.assertEqual(HELPER["update_metadata"](manifest()), (
            "0.4.0~beta.233", len(fixture), hashlib.sha256(fixture).hexdigest(),
        ))

    def test_rejects_ambiguous_or_invalid_manifest(self):
        for invalid in (
            manifest(size=True),
            manifest(size=HELPER["MAX_PACKAGE"] + 1),
            manifest(sha256="a" * 63),
            manifest().replace(b"0.4.0-beta.233", b"0.4.0-beta.0233"),
            manifest().replace(b'"schema": 1', b'"schema": 2, "schema": 1'),
        ):
            with self.subTest(invalid=invalid), self.assertRaises(update_error):
                HELPER["update_metadata"](invalid)


@unittest.skipUnless(sys.platform == "linux", "Linux file descriptor semantics")
class InstallStagingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.stage = self.directory / "staged"
        self.stage.mkdir(mode=0o700)
        self.uid = os.getuid()
        (self.stage / "manifest.json").write_bytes(manifest())
        (self.stage / "manifest.json.minisig").write_bytes(b"test-only signature")
        (self.stage / "package.deb").write_bytes(fixture)

    def test_rejects_symlinked_and_oversized_inputs(self):
        (self.stage / "symlink").symlink_to(self.stage / "package.deb")
        descriptor = HELPER["user_stage"](str(self.stage), self.uid)
        self.addCleanup(os.close, descriptor)
        copy = HELPER["copy_verified_input"]
        output = self.directory / "verified"
        with self.assertRaises(OSError):
            copy(descriptor, "symlink", output, self.uid, 1024)
        with self.assertRaises(update_error):
            copy(descriptor, "package.deb", output, self.uid, 1)
        self.assertFalse(output.exists())

    def test_does_not_touch_apt_if_signature_or_package_is_invalid(self):
        install = HELPER["install"]
        for signature_status in (1, 0):
            calls = []

            def command(arguments, **_options):
                calls.append(arguments[0])
                return SimpleNamespace(returncode=signature_status)

            (self.stage / "package.deb").write_bytes(b"x" * len(fixture))
            with patch.dict(install.__globals__, {
                "trusted_key": lambda: "/fixture/public-key",
                "command": command,
            }), self.assertRaises(update_error):
                install(str(self.stage), self.uid)
            self.assertEqual(calls, ["/usr/bin/minisign"])


if __name__ == "__main__":
    unittest.main()

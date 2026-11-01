"""Verify a device IPA without Apple's SDK; also runs on Windows after download."""
import hashlib
import json
import plistlib
import stat
import struct
import sys
import zipfile
from pathlib import Path, PurePosixPath


def verify(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP entries")
        for name in names:
            relative = PurePosixPath(name)
            if relative.is_absolute() or ".." in relative.parts or "\\" in name:
                raise ValueError("Unsafe ZIP entry")
            if not name.startswith("Payload/"):
                raise ValueError("IPA must contain only Payload/")
        roots = {name.split("/")[1] for name in names if len(name.split("/")) > 1 and name.split("/")[1]}
        if roots != {"TRLKA.app"}:
            raise ValueError("Expected exactly Payload/TRLKA.app")
        prefix = "Payload/TRLKA.app/"
        info = plistlib.loads(archive.read(prefix + "Info.plist"))
        assert info["CFBundleIdentifier"] == "com.trlka.ios", "Unexpected bundle identifier"
        assert info["CFBundlePackageType"] == "APPL", "Not an application"
        assert info["CFBundleSupportedPlatforms"] == ["iPhoneOS"], "Not a device build"
        assert set(info["UIDeviceFamily"]) == {1, 2}, "Expected iPhone and iPad support"
        assert info["MinimumOSVersion"] == "17.0", "Unexpected minimum iOS"
        assert info["TRLKAAPIBaseURL"] == "https://freetalk.191-44-38-60.sslip.io/api", "Unexpected API origin"
        assert not info.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads"), "Unsafe ATS configuration"
        executable = info["CFBundleExecutable"]
        assert "/" not in executable and executable not in ("", ".", "..")
        entry = archive.getinfo(prefix + executable)
        assert (entry.external_attr >> 16) & stat.S_IXUSR, "Executable permission missing"
        binary = archive.read(entry)
        magic, cpu, _, filetype, commands, command_bytes, _, _ = struct.unpack_from("<8I", binary)
        assert magic == 0xFEEDFACF and cpu == 0x0100000C and filetype == 2, "Expected arm64 Mach-O executable"
        position = 32
        platforms = []
        assert position + command_bytes <= len(binary), "Truncated commands"
        for _ in range(commands):
            command, size = struct.unpack_from("<II", binary, position)
            assert size >= 8 and position + size <= 32 + command_bytes, "Invalid load command"
            if command == 0x32:  # LC_BUILD_VERSION
                platforms.append(struct.unpack_from("<I", binary, position + 8)[0])
            if command in (0x21, 0x2C):  # LC_ENCRYPTION_INFO[_64]
                assert struct.unpack_from("<I", binary, position + 16)[0] == 0, "Encrypted executable"
            position += size
        assert platforms == [2], "Expected iOS platform, not Simulator or Mac Catalyst"
        assert position == 32 + command_bytes, "Load command size mismatch"
        assert prefix + "embedded.mobileprovision" not in names, "Unexpected provisioning profile"
        assert not any(name.endswith((".p12", ".p8", ".pem", ".key")) for name in names), "Unexpected signing material"
        assert not any(name.endswith(".dylib") and ("debug" in name or "preview" in name) for name in names), "Debug library in release IPA"
        bad = archive.testzip()
        assert bad is None, f"ZIP CRC failure: {bad}"
        return {
            "file": Path(path).name,
            "bundleID": info["CFBundleIdentifier"],
            "version": info["CFBundleShortVersionString"],
            "build": info["CFBundleVersion"],
            "minimumIOS": info["MinimumOSVersion"],
            "architecture": "arm64",
            "platform": "iOS device",
            "signing": "Unsigned; requires personal signing before installation",
            "sizeBytes": Path(path).stat().st_size,
            "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        }


if __name__ == "__main__":
    print(json.dumps(verify(sys.argv[1]), indent=2, ensure_ascii=False))

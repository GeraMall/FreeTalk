"""Verify native-only WebRTC entrypoints in actual APK DEX class definitions.

Unlike a strings search, this rejects a removed class even if a descriptor is
still present as an unresolved reference. No Android SDK or third-party modules.
"""
import argparse
import json
import struct
import zipfile

REQUIRED = {
    "Lorg/jni_zero/JniInit;",
    "Lorg/jni_zero/JniUtil;",
    "Lorg/webrtc/NativeLibrary;",
    "Lorg/webrtc/PeerConnectionFactory;",
}


def class_descriptors(data):
    if not data.startswith(b"dex\n"):
        raise ValueError("Invalid DEX header")
    u32 = lambda offset: struct.unpack_from("<I", data, offset)[0]
    string_count, string_offset = u32(56), u32(60)
    type_count, type_offset = u32(64), u32(68)
    class_count, class_offset = u32(96), u32(100)
    descriptors = set()
    for index in range(class_count):
        type_index = u32(class_offset + index * 32)
        if type_index >= type_count:
            raise ValueError("Invalid DEX class type index")
        string_index = u32(type_offset + type_index * 4)
        if string_index >= string_count:
            raise ValueError("Invalid DEX descriptor index")
        offset = u32(string_offset + string_index * 4)
        while data[offset] & 128:
            offset += 1
        offset += 1  # Skip UTF-16 length (ULEB128), then read MUTF8 descriptor.
        end = data.index(0, offset)
        descriptors.add(data[offset:end].decode("utf-8"))
    return descriptors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("apk")
    args = parser.parse_args()
    present = set()
    with zipfile.ZipFile(args.apk) as archive:
        dex_files = [name for name in archive.namelist() if name.startswith("classes") and name.endswith(".dex") and "/" not in name]
        for name in dex_files:
            present.update(class_descriptors(archive.read(name)))
    missing = sorted(REQUIRED - present)
    print(json.dumps({"apk": args.apk, "dexFiles": len(dex_files), "required": sorted(REQUIRED), "missing": missing, "passed": not missing}))
    if missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

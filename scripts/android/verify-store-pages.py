"""Check 16 KiB ELF load segments in an APK or App Bundle."""

import struct
import sys
from zipfile import ZipFile


def load_alignments(binary):
    if binary[:4] != b"\x7fELF" or binary[5] != 1:
        raise ValueError("Expected little-endian ELF")
    if binary[4] == 2:
        program_start = struct.unpack_from("<Q", binary, 32)[0]
        align_offset, align_format, sizes_offset = 48, "<Q", 54
    elif binary[4] == 1:
        program_start = struct.unpack_from("<I", binary, 28)[0]
        align_offset, align_format, sizes_offset = 28, "<I", 42
    else:
        raise ValueError("Unsupported ELF class")
    entry_size, entry_count = struct.unpack_from("<HH", binary, sizes_offset)
    for i in range(entry_count):
        entry = program_start + i * entry_size
        if struct.unpack_from("<I", binary, entry)[0] == 1:  # PT_LOAD
            yield struct.unpack_from(align_format, binary, entry + align_offset)[0]


def verify(path):
    checked = 0
    with ZipFile(path) as package:
        for name in package.namelist():
            parts = name.split("/")
            if len(parts) < 3 or parts[-3] != "lib" or not name.endswith(".so"):
                continue
            if parts[-2] not in {"arm64-v8a", "x86_64"}:
                continue
            alignments = list(load_alignments(package.read(name)))
            if not alignments or min(alignments) < 16384:
                raise ValueError(f"16 KiB alignment failed: {name} {alignments}")
            checked += 1
            print(f"{name}: {min(alignments)}")
    if not checked:
        raise ValueError("No 64-bit native libraries found")
    print(f"{checked} compatible 64-bit native libraries")


if __name__ == "__main__":
    verify(sys.argv[1])

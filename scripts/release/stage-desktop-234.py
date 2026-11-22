import hashlib
import json
import os
import plistlib
import shutil
import struct
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path


VERSION = '0.4.0-beta.234'
REPO = 'GeraMall/FreeTalk'
TAG = f'desktop-v{VERSION}'
BASE = Path(os.environ.get('TRLKA_STAGING_ROOT', Path(__file__).resolve().parent))
INCOMING = BASE / 'incoming'
STAGE = BASE / 'stage'
WINDOWS_SOURCE = Path(os.environ.get('TRLKA_WINDOWS_SOURCE', 'D:/DevCache/trlka-windows-234-release'))
MACOS_SOURCE = Path(os.environ.get('TRLKA_MACOS_SOURCE', 'D:/DevCache/trlka-macos-234-release'))
PREVIOUS_SOURCE = Path(os.environ.get('TRLKA_PREVIOUS_SOURCE', 'D:/FreeTalk-macos-232'))
VERIFY_UPDATER = WINDOWS_SOURCE / 'scripts/windows/verify-updater.mjs'
TAURI_CONFIG = 'apps/desktop/src-tauri/tauri.conf.json'
WINDOWS_FILES = [
    f'Trlka_{VERSION}_x64-setup.exe',
    f'Trlka_{VERSION}_x64-setup.exe.sig',
    f'Trlka_{VERSION}_portable_x64.exe',
]
MACOS_FILES = [
    f'Trlka_{VERSION}_aarch64.app.tar.gz',
    f'Trlka_{VERSION}_aarch64.app.tar.gz.sig',
    f'Trlka_{VERSION}_aarch64.dmg',
]


def verify_provenance(run_id, sha, job_prefix):
    result = subprocess.run(
        ['gh', 'run', 'view', str(run_id), '--repo', REPO, '--json', 'headSha,conclusion,jobs'],
        check=True, capture_output=True, text=True, encoding='utf-8',
    )
    run = json.loads(result.stdout)
    assert run['headSha'] == sha, run['headSha']
    assert run['conclusion'] == 'success', run['conclusion']
    jobs = [job for job in run['jobs'] if job['name'].startswith(job_prefix)]
    assert len(jobs) == 1 and jobs[0]['conclusion'] == 'success', jobs
    if job_prefix == 'macos':
        runtime = next(step for step in jobs[0]['steps'] if step['name'] == 'Verify macOS runtime paths')
        assert runtime['conclusion'] == 'success', runtime


def verify_pe(filename, expect_x64):
    blob = filename.read_bytes()
    assert len(blob) > 1_000_000, filename
    assert blob[:2] == b'MZ', filename
    pe = struct.unpack_from('<I', blob, 0x3C)[0]
    assert blob[pe:pe + 4] == b'PE\0\0', filename
    machine = struct.unpack_from('<H', blob, pe + 4)[0]
    expected_machines = (0x8664,) if expect_x64 else (0x14c, 0x8664)
    assert machine in expected_machines, filename
    assert f'{VERSION}\0'.encode('utf-16le') in blob, f'Wrong ProductVersion in {filename}'


def verify_mac(archive, dmg, identifier):
    with dmg.open('rb') as file:
        file.seek(-512, 2)
        assert file.read(4) == b'koly', f'Unexpected DMG trailer in {dmg}'

    with tarfile.open(archive, 'r:gz') as package:
        names = package.getnames()
        plists = [name for name in names if name.lstrip('./').split('/')[1:] == ['Contents', 'Info.plist']]
        assert len(plists) == 1, plists
        app_dir = plists[0].removesuffix('/Contents/Info.plist')
        assert app_dir.lstrip('./') == 'Trlka.app', app_dir
        with package.extractfile(plists[0]) as stream:
            info = plistlib.load(stream)
        assert info['CFBundleIdentifier'] == identifier, info['CFBundleIdentifier']
        assert info['CFBundleShortVersionString'] == VERSION, info['CFBundleShortVersionString']
        assert info['CFBundleExecutable'] == 'freetalk', info['CFBundleExecutable']

        with package.extractfile(f'{app_dir}/Contents/MacOS/freetalk') as stream:
            header = stream.read(32)
            magic, cpu_type, _, _, command_count, command_size, _, _ = struct.unpack('<8I', header)
            assert magic == 0xfeedfacf and cpu_type == 0x0100000c, 'macOS executable is not arm64 Mach-O'
            commands = stream.read(command_size)
        offset = 0
        rpaths = []
        for _ in range(command_count):
            load_type, load_size = struct.unpack_from('<2I', commands, offset)
            assert load_size >= 8 and offset + load_size <= command_size
            if load_type == 0x8000001c:
                path_offset = struct.unpack_from('<I', commands, offset + 8)[0]
                rpaths.append(commands[offset + path_offset:offset + load_size].split(b'\0', 1)[0])
            offset += load_size
        assert b'/usr/lib/swift' in rpaths, rpaths


def verify_updater(file, source):
    signature = file.with_name(file.name + '.sig')
    result = subprocess.run(
        ['node', str(VERIFY_UPDATER), str(file), str(signature), str(source / TAURI_CONFIG)],
        check=True, capture_output=True, text=True, encoding='utf-8',
    )
    details = json.loads(result.stdout)
    assert details['verified'] is True
    return signature.read_text('utf-8').strip()


def metadata(file):
    with file.open('rb') as stream:
        sha256 = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {
        'name': file.name,
        'size': file.stat().st_size,
        'sha256': sha256,
    }


def main():
    verify_provenance(45045081119, '9ecb185a009fa2faf751d05321a789a0eebd4d50', 'windows')
    verify_provenance(45045085525, '758adb875ed2eb8e263939c1a7736d01340616cf', 'macos')
    windows_tauri = json.loads((WINDOWS_SOURCE / TAURI_CONFIG).read_text('utf-8'))
    macos_tauri = json.loads((MACOS_SOURCE / TAURI_CONFIG).read_text('utf-8'))
    previous_tauri = json.loads((PREVIOUS_SOURCE / TAURI_CONFIG).read_text('utf-8'))
    assert windows_tauri['version'] == macos_tauri['version'] == VERSION
    assert windows_tauri['identifier'] == macos_tauri['identifier'] == previous_tauri['identifier']
    assert windows_tauri['plugins']['updater'] == macos_tauri['plugins']['updater'] == previous_tauri['plugins']['updater']

    windows = [INCOMING / 'windows' / name for name in WINDOWS_FILES]
    macos = [INCOMING / 'macos' / name for name in MACOS_FILES]
    STAGE.mkdir(exist_ok=True)
    for file in windows + macos:
        assert file.is_file() and file.stat().st_size > 0, file
    verify_pe(windows[0], expect_x64=False)
    verify_pe(windows[2], expect_x64=True)
    verify_mac(macos[0], macos[2], macos_tauri['identifier'])

    url_base = f'https://github.com/{REPO}/releases/download/{TAG}/'
    platforms = {}
    for name, file, source in [('windows-x86_64', windows[0], WINDOWS_SOURCE), ('darwin-aarch64', macos[0], MACOS_SOURCE)]:
        platforms[name] = {'signature': verify_updater(file, source), 'url': url_base + file.name}

    manifest = {
        'version': VERSION,
        'notes': 'TRLKA beta.234. Карточки участников в звонке выровнены и появляются плавнее. Демонстрация в мобильном вебе разворачивается на весь экран и сохраняет весь кадр при повороте устройства.',
        'pub_date': datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
        'platforms': platforms,
    }

    for file in windows + macos:
        shutil.copyfile(file, STAGE / file.name)
    latest = STAGE / 'latest.json'
    latest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8', newline='\n')
    info = [metadata(STAGE / file.name) for file in windows + macos] + [metadata(latest)]
    sums = STAGE / 'SHA256SUMS.txt'
    sums.write_text(''.join(f"{entry['sha256']}  {entry['name']}\n" for entry in info), 'utf-8', newline='\n')
    info.append(metadata(sums))
    (BASE / 'verified-metadata.json').write_text(json.dumps(info, indent=2) + '\n', 'utf-8', newline='\n')
    print(json.dumps(info, indent=2))


if __name__ == '__main__':
    main()

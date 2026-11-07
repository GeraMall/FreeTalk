"""Validate a complete export before publishing it on the standby."""
import hashlib
import json
import os
import pathlib
import stat
import sys
import time

PAYLOAD=('api','www','config','caddy','server.bundle.mjs','Caddyfile.failover')


def entries(root):
    result=[]
    for name in PAYLOAD:
        start=root/name
        if not start.exists():raise RuntimeError('Missing snapshot payload')
        paths=[start]
        if start.is_dir():
            for directory,dirs,files in os.walk(start,followlinks=False):
                paths += [pathlib.Path(directory)/n for n in dirs+files]
        for path in paths:
            mode=path.lstat().st_mode
            rel=path.relative_to(root).as_posix()
            if stat.S_ISLNK(mode):result.append([rel,'link',os.readlink(path)])
            elif stat.S_ISREG(mode):
                with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
                result.append([rel,'file',digest])
            elif not stat.S_ISDIR(mode):raise RuntimeError('Unexpected snapshot file type')
    return sorted(result)


def verify(root):
    manifest=json.loads((root/'manifest.json').read_text())
    if manifest.get('version')!=1 or entries(root)!=manifest.get('entries'):
        raise RuntimeError('Snapshot checksum mismatch')
    if not 0<=time.time()-manifest['createdAt']<1200:
        raise RuntimeError('Snapshot is stale')
    return hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest()


def main():
    root=pathlib.Path(sys.argv[2])
    if sys.argv[1]=='create':
        manifest={'version':1,'createdAt':time.time(),'entries':entries(root)}
        temp=root/'manifest.json.new'
        temp.write_text(json.dumps(manifest,separators=(',',':')))
        os.replace(temp,root/'manifest.json')
    elif sys.argv[1]=='verify':print(verify(root))
    else:raise ValueError('Unknown manifest operation')


if __name__=='__main__':main()

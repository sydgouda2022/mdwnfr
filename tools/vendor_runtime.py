"""Prepare a self-hosted, pinned Pyodide 0.27.8 browser runtime.

This developer packaging helper is deliberately NOT executed on every IDE launch.
It downloads to temporary files, checks the critical file formats, and publishes
only a complete manifest. A partial network failure never produces an apparently
ready offline PWA. The Cloudflare build vendors the complete pinned runtime; no alternative CDN is supported.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
from urllib.request import urlopen
import zipfile

try:
    from .runtime_assets import PYODIDE_FILES, PYODIDE_VERSION, ROOT, MIN_BYTES, inspect
except ImportError: # direct IDE/developer invocation
    from runtime_assets import PYODIDE_FILES, PYODIDE_VERSION, ROOT, MIN_BYTES, inspect
BASE=f'https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full/'


def validate_one(name: str, data: bytes) -> None:
    if len(data)<MIN_BYTES[name]:
        raise ValueError(f'{name}: incomplete payload ({len(data)} bytes)')
    if name=='pyodide.asm.wasm' and data[:4]!=b'\x00asm':
        raise ValueError('Invalid WebAssembly header')
    if name=='python_stdlib.zip':
        from io import BytesIO
        with zipfile.ZipFile(BytesIO(data)) as z:
            if not z.namelist() or z.testzip() is not None:
                raise ValueError('Corrupt Python stdlib archive')
    if name=='pyodide-lock.json' and not isinstance(json.loads(data),dict):
        raise ValueError('Invalid lockfile')
    if name=='pyodide.asm.js' and b'WebAssembly' not in data and b'wasm' not in data:
        raise ValueError('Invalid Pyodide runtime JS')
    if name=='pyodide.mjs' and b'loadPyodide' not in data:
        raise ValueError('Invalid Pyodide module')


def vendor(root: Path=ROOT, base: str=BASE) -> Path:
    folder=root/'web/vendor/pyodide'
    folder.mkdir(parents=True,exist_ok=True)
    staged=[]
    try:
        for name in PYODIDE_FILES:
            target=folder/name
            if target.is_file():
                try:
                    validate_one(name,target.read_bytes())
                    continue
                except (ValueError,zipfile.BadZipFile,UnicodeDecodeError):
                    pass
            print('[runtime] Downloading',name,flush=True)
            temporary=folder/(name+'.partial')
            # Exclusive temporary file, and bounded read chunks to avoid loading
            # a large wasm download into memory while it is transferred.
            with urlopen(base+name,timeout=45) as response, temporary.open('wb') as sink:
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk:break
                    sink.write(chunk)
            validate_one(name,temporary.read_bytes())
            staged.append((temporary,target))
        # Only once all downloads are validated do we replace originals.
        for temporary,target in staged:os.replace(temporary,target)
        lines=[]
        for name in PYODIDE_FILES:
            data=(folder/name).read_bytes()
            validate_one(name,data)
            lines.append(hashlib.sha256(data).hexdigest()+'  '+name)
        manifest_tmp=folder/'MANIFEST.sha256.partial'
        manifest_tmp.write_text('\n'.join(lines)+'\n',encoding='utf-8')
        os.replace(manifest_tmp,folder/'MANIFEST.sha256')
        if not inspect(root)['runtime_ready']:
            raise ValueError('Downloaded runtime failed independent inspection')
        print('[runtime] Verified self-hosted Pyodide',PYODIDE_VERSION,flush=True)
        return folder
    finally:
        for temporary,_ in staged:temporary.unlink(missing_ok=True)

if __name__=='__main__':
    vendor()

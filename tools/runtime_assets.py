"""Deterministic, offline-capable readiness inspection for a Pyodide PWA.

No network calls. One authoritative inventory is reused by the build, IDE
checks and tests. SHA-256 pinning here verifies the locally downloaded files
against the generated publication manifest; it does not authenticate a remote
publisher independently.
"""
from __future__ import annotations
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYODIDE_VERSION='0.27.8'
PYTHON_MINOR='3.12'
PYODIDE_FILES=('pyodide.mjs','pyodide.asm.js','pyodide.asm.wasm',
               'python_stdlib.zip','pyodide-lock.json')
# Catch truncated files and false-success HTML/error responses without requiring
# the native Python test machine to have Pyodide installed.
MIN_BYTES={'pyodide.mjs':1000,'pyodide.asm.js':100000,
           'pyodide.asm.wasm':1000000,'python_stdlib.zip':100000,
           'pyodide-lock.json':1000}


def inspect(root: Path=ROOT) -> dict:
    runtime=root/'web/vendor/pyodide'
    paths={name:runtime/name for name in PYODIDE_FILES}
    missing=[name for name,p in paths.items() if not p.is_file()]
    invalid=[name for name,p in paths.items() if p.is_file() and p.stat().st_size<MIN_BYTES[name]]
    problems=[]
    # Hashes alone are not enough: check that the published files have the
    # required Pyodide binary/container structure (reject cached error pages).
    if not missing and not invalid:
        try:
            with (runtime/'pyodide.asm.wasm').open('rb') as f:
                if f.read(4)!=b'\x00asm':
                    problems.append('Invalid Pyodide WebAssembly header')
            with zipfile.ZipFile(runtime/'python_stdlib.zip') as archive:
                if not archive.namelist() or archive.testzip() is not None:
                    problems.append('Corrupt or empty Python standard library')
            lock=json.loads((runtime/'pyodide-lock.json').read_text(encoding='utf-8'))
            if not isinstance(lock,dict) or not lock:
                problems.append('Invalid Pyodide lockfile')
            if 'loadPyodide' not in (runtime/'pyodide.mjs').read_text(encoding='utf-8'):
                problems.append('Invalid Pyodide module entry point')
        except (OSError,UnicodeDecodeError,ValueError,zipfile.BadZipFile,RuntimeError) as error:
            problems.append('Invalid Pyodide runtime format: '+str(error))
    manifest=runtime/'MANIFEST.sha256'
    hashes={}
    if not manifest.is_file():
        problems.append('Missing Pyodide manifest')
    else:
        try:
            for line in manifest.read_text('utf-8').splitlines():
                digest,name=line.split('  ',1)
                if name not in paths or name in hashes or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):
                    raise ValueError('Malformed or unexpected SHA-256 entry')
                hashes[name]=digest
            if set(hashes)!=set(PYODIDE_FILES):
                problems.append('Incomplete Pyodide manifest')
            for name,p in paths.items():
                if p.is_file() and name in hashes:
                    if hashlib.sha256(p.read_bytes()).hexdigest()!=hashes[name]:
                        problems.append('Pyodide hash mismatch: '+name)
        except (ValueError,UnicodeDecodeError) as e:
            problems.append('Invalid Pyodide manifest: '+str(e))
    font=root/'web/assets/fonts/hieroglyphs.woff2'
    font_ok=font.is_file() and font.stat().st_size>=1000
    if font_ok and font.read_bytes()[:4]!=b'wOF2':
        font_ok=False
    return {'pyodide_version':PYODIDE_VERSION,'runtime_ready':not(missing or invalid or problems),
            'font_ready':font_ok,'offline_ready':not(missing or invalid or problems) and font_ok,
            'missing':missing,'invalid':invalid,'problems':problems}

if __name__=='__main__':
    import json
    print(json.dumps(inspect(),indent=2))

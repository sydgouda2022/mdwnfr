"""Generate the exact offline download inventory from a completed static build.

No browser or network dependencies. The manifest is a *local integrity inventory*,
not a signature or a claim that a device has finished installing the PWA.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

# Always-cached shell includes every Python module imported by the browser RPC core.
SHELL = (
    'index.html', 'style.css', 'boot.mjs', 'app.js', 'editor_controls.mjs', 'hieroglyph_facing.mjs', 'quadrat_preview.mjs', 'keyboard_catalog.js', 'worker.js', 'storage.js',
    'manifest.webmanifest', 'runtime-status.json',
    'core/mdwnfr/__init__.py', 'core/mdwnfr/document.py',
    'core/mdwnfr/quadrat.py', 'core/mdwnfr/silhouette.py', 'core/mdwnfr/tables.py',
    'core/mdwnfr/cartouches.py',
    'core/mdwnfr/typography.py', 'core/mdwnfr/layout.py',
    'core/mdwnfr/lexicon.py',
    'core/mdwnfr/history.py', 'core/mdwnfr/session.py',
    'core/mdwnfr/layout_sync.py', 'core/mdwnfr/api.py',
    'core/mdwnfr/data/lexicon.json',
    'core/mdwnfr/data/glyph_geometry.json',
    'lexicon-install.mjs', 'lexicon/lexicon.json', 'lexicon/manifest.json',
    'core/mdwnfr/data/catalog_integrity.json',
    'core/mdwnfr/data/artwork_catalog.json',
    'core/mdwnfr/data/artwork_silhouettes.json','artwork/catalog.json',
    'icons/app-192.png', 'icons/app-512.png',
    'icons/apple-touch-icon.png', 'icons/keyboard_icon.svg',
)
RUNTIME = (
    'vendor/pyodide/pyodide.mjs',
    'vendor/pyodide/pyodide.asm.js',
    'vendor/pyodide/pyodide.asm.wasm',
    'vendor/pyodide/python_stdlib.zip',
    'vendor/pyodide/pyodide-lock.json',
    'assets/fonts/hieroglyphs.woff2',
)


def publish(dist: Path) -> dict:
    status=json.loads((dist/'runtime-status.json').read_text(encoding='utf-8'))
    paths=list(SHELL+RUNTIME if status['offline_ready'] else SHELL)
    artwork=json.loads((dist/'artwork/catalog.json').read_text(encoding='utf-8'))
    paths.extend('artwork/'+item['file'] for item in artwork['artworks'])
    records=[]
    for name in paths:
        if name.startswith('/') or '..' in Path(name).parts:
            raise ValueError('Invalid offline asset path: '+name)
        data=(dist/name).read_bytes()
        records.append({'path':'/'+name, 'bytes':len(data),
                        'sha256':hashlib.sha256(data).hexdigest()})
    import tomllib
    version=tomllib.loads((dist.parent/'pyproject.toml').read_text(encoding='utf-8'))['project']['version']
    publication={'format':'mdwnfr-offline-publication-v1',
                 'version':version,
                 'complete':status['offline_ready'],
                 'pyodide_version':status['pyodide_version'],
                 'assets':records}
    (dist/'offline-assets.json').write_text(
        json.dumps(publication,sort_keys=True,separators=(',',':')),
        encoding='utf-8')
    return publication
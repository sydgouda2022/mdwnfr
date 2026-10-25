"""Build a no-Node, Cloudflare-Pages-ready static folder from source.

Deliberately never copies prior application code or an unrelated local DB.
"""
from pathlib import Path
from shutil import copy2
import hashlib, json
from runtime_assets import inspect
from shutil import copytree, rmtree, ignore_patterns
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'dist'
if DEST.exists():rmtree(DEST)
copytree(ROOT/'web',DEST,ignore=ignore_patterns('__pycache__','*.pyc','.DS_Store'))
copytree(ROOT/'core',DEST/'core',ignore=ignore_patterns('__pycache__','*.pyc','.DS_Store'))
# Startup can detect when a newly activated worker owns a different HTML schema.
# Hash source bytes before inserting the marker, avoiding a circular fingerprint.
release_files=('index.html','boot.mjs','app.js','style.css','editor_controls.mjs','core/mdwnfr/document.py')
release=hashlib.sha256(b'\0'.join((DEST/name).read_bytes() for name in release_files)).hexdigest()[:16]
index=DEST/'index.html'
index.write_text(index.read_text(encoding='utf-8').replace(
    'name="mdwnfr-build" content="development"',
    f'name="mdwnfr-build" content="{release}"'),encoding='utf-8')
# The runtime is always self-hosted. A release without the licensed font is invalid.
font=ROOT/'web/assets/fonts/hieroglyphs.woff2'
if not font.is_file() or font.stat().st_size<1000 or font.read_bytes()[:4]!=b'wOF2':
    raise ValueError('Missing verified local hieroglyphic font')

artwork_catalog = json.loads((ROOT/'core/mdwnfr/data/artwork_catalog.json').read_text(encoding='utf-8'))
if artwork_catalog['count'] != len(artwork_catalog['artworks']):
    raise ValueError('Clip-art catalog count mismatch')
seen_artwork=set()
for artwork in artwork_catalog['artworks']:
    if artwork['id'] in seen_artwork:
        raise ValueError('Duplicate clip-art identifier')
    seen_artwork.add(artwork['id'])
    path=ROOT/'web'/'artwork'/artwork['file']
    if path.parent != ROOT/'web'/'artwork' or not path.is_file():
        raise ValueError('Clip-art asset missing or invalid path: '+artwork['id'])
    if hashlib.sha256(path.read_bytes()).hexdigest() != artwork['sha256']:
        raise ValueError('Clip-art asset fingerprint mismatch: '+artwork['id'])
# Contour geometry is packaged as verified Python data, never inferred by
# the visual page. Fail the build if the contour table lags the source assets.
profile_path=ROOT/'core/mdwnfr/data/artwork_silhouettes.json'
profiles=json.loads(profile_path.read_text(encoding='utf-8'))
if (profiles.get('format')!='mdwnfr-silhouette-v2' or profiles.get('rows')!=256
        or profiles.get('columns')!=256 or set(profiles.get('entries',{}))!=seen_artwork):
    raise ValueError('Missing or invalid 2D silhouette inventory')
for artwork in artwork_catalog['artworks']:
    entry=profiles['entries'][artwork['id']]
    if entry.get('sha256')!=artwork['sha256'] or not isinstance(entry.get('mask'),str):
        raise ValueError('Outdated 2D silhouette: '+artwork['id'])
    import base64
    try:
        bits=base64.b64decode(entry['mask'],validate=True)
    except ValueError as exc:
        raise ValueError('Invalid silhouette encoding: '+artwork['id']) from exc
    if len(bits)!=8192 or not any(bits):
        raise ValueError('Invalid silhouette bitmap: '+artwork['id'])
copy2(ROOT/'core/mdwnfr/data/artwork_catalog.json', DEST/'artwork/catalog.json')
# Every installed PWA verifies the exact lexicon bytes before launching Python.
# Metadata status and counts come from the verified source package, never guesses.
catalog=DEST/'core/mdwnfr/data/lexicon.json'
raw=catalog.read_bytes()
from catalog_integrity import validate_release_catalog
data=validate_release_catalog(raw)
manifest={'format':'mdwnfr-catalog-integrity-v1',
          'sha256':hashlib.sha256(raw).hexdigest(),
          'bytes':len(raw),'spelling_records':len(data['entries']),
          'complete':data['metadata'].get('complete') is True,
          'published_dataset_sha256':data['metadata'].get('published_dataset_sha256','')}
(catalog.parent/'catalog_integrity.json').write_text(
    json.dumps(manifest,sort_keys=True,separators=(',',':')),encoding='utf-8')
print('Built:',DEST)
runtime=inspect()
(DEST/'runtime-status.json').write_text(json.dumps(runtime,sort_keys=True,separators=(',',':')),encoding='utf-8')
print('Offline runtime:', 'READY' if runtime['offline_ready'] else 'NOT READY (development/CDN only)')

# Publish an integrity-checked atomic offline precache inventory.
from offline_publication import publish
publication=publish(DEST)
print('Offline publication:', 'COMPLETE' if publication['complete'] else 'SHELL ONLY',
      f'({len(publication["assets"])} checked assets)')

# Content-addressed service-worker cache for repeatable IDE rebuilds.
import re
cache_fingerprint=hashlib.sha256((DEST/'offline-assets.json').read_bytes()).hexdigest()[:16]
sw=DEST/'sw.js'
sw_source=sw.read_text(encoding='utf-8')
sw_source=re.sub(r"const CACHE = 'mdwnfr-offline-[^']+';",
                 f"const CACHE = 'mdwnfr-offline-{cache_fingerprint}';",sw_source)
sw.write_text(sw_source,encoding='utf-8')

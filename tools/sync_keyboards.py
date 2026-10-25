#!/usr/bin/env python3
"""One-way SHA-256-verified consumer of the standalone Hieroglyphic Keyboard API.

Never imports a second dictionary implementation into MdwNfr. Only a pinned,
verified upstream release can update its browser assets. It never touches
documents, user learning, appointments, or installed IndexedDB storage.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
LOCK=ROOT/'keyboard-lock.json'
REPO='sydgouda2022/hieroglyphic-keyboard'
MODULES=('keyboard_api.mjs','keyboard_search.mjs','_generic_search.mjs',
         'lexicon_install.mjs','keyboard_catalog.js')
PREFIX='https://raw.githubusercontent.com/{repo}/{sha}/{path}'

def digest(data: bytes)->str:
    return hashlib.sha256(data).hexdigest()

def fetch(url: str)->bytes:
    req=urllib.request.Request(url,headers={'User-Agent':'mdwnfr-keyboard-api-v1'})
    with urllib.request.urlopen(req,timeout=90) as response:
        if response.status!=200:
            raise ValueError(f'HTTP {response.status}: {url}')
        return response.read()

def lockfile()->dict:
    data=json.loads(LOCK.read_text('utf-8'))
    if data.get('format')!='keyboard-dependencies-v1' or set(data.get('dependencies',{}))!={'hieroglyphic-keyboard'}:
        raise ValueError('Unsupported independent keyboard dependency graph')
    if data['dependencies']['hieroglyphic-keyboard']['upstream_repository']!=REPO:
        raise ValueError('Unexpected keyboard publisher')
    return data

def verify()->None:
    entry=lockfile()['dependencies']['hieroglyphic-keyboard']
    catalog=(ROOT/'web/lexicon/lexicon.json').read_bytes()
    manifest=(ROOT/'web/lexicon/manifest.json').read_bytes()
    meta=json.loads(manifest)
    if (meta.get('language')!='egy' or meta.get('sha256')!=digest(catalog)
            or meta.get('bytes')!=len(catalog) or
            entry['manifest_sha256']!=digest(manifest) or
            entry['lexicon_sha256']!=digest(catalog)):
        raise ValueError('Independent keyboard release hash mismatch')
    if meta['spelling_records']!=len(json.loads(catalog)['entries']):
        raise ValueError('Independent keyboard release count mismatch')
    hashes=entry.get('api_files_sha256')
    if not isinstance(hashes,dict) or set(hashes)!=set(MODULES):
        raise ValueError('Missing locked keyboard API checksums')
    for name, expected in hashes.items():
        if digest((ROOT/'web/vendor/hieroglyphic'/name).read_bytes())!=expected:
            raise ValueError('Unverified keyboard API module: '+name)
    print('Verified independently pinned Hieroglyphic Keyboard API and lexicon.')

def update()->bool:
    lock=lockfile()
    pinned=lock['dependencies']['hieroglyphic-keyboard']
    latest=json.loads(fetch('https://api.github.com/repos/'+REPO+'/commits/main'))['sha']
    if latest==pinned['source_commit']:
        verify()
        return False
    def source(path:str)->bytes:
        return fetch(PREFIX.format(repo=REPO,sha=latest,path=path))
    manifest=source('release/manifest.json')
    catalog=source('release/lexicon.json')
    meta=json.loads(manifest)
    if (meta.get('language')!='egy' or meta['sha256']!=digest(catalog)
            or meta['bytes']!=len(catalog) or
            meta['spelling_records']!=len(json.loads(catalog)['entries']) or
            meta['spelling_records']<40000):
        raise ValueError('Unverified or regressed keyboard lexicon')
    modules={name:source('src/'+name) for name in MODULES}
    if b"API_VERSION='1.0.0'" not in modules['keyboard_api.mjs']:
        raise ValueError('Keyboard API major version requires explicit integration')
    files={
      'web/lexicon/lexicon.json':catalog,
      'web/lexicon/manifest.json':manifest,
      'web/lexicon/coverage.json':source('release/coverage.json'),
      **{'web/vendor/hieroglyphic/'+name:value for name,value in modules.items()}
    }
    pinned.update(source_commit=latest,version=meta['release'],
                  manifest_sha256=digest(manifest),lexicon_sha256=digest(catalog),
                  api_files_sha256={name:digest(value) for name,value in modules.items()})
    files['keyboard-lock.json']=(json.dumps(lock,indent=2,ensure_ascii=False)+'\n').encode()
    # Stage and validate EVERY file before replacing the checked-out copy.
    with tempfile.TemporaryDirectory(prefix='mdwnfr-keyboard-') as folder:
        staging=Path(folder)
        for path, data in files.items():
            target=staging/path
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(data)
        for path in files:
            target=ROOT/path
            target.parent.mkdir(parents=True,exist_ok=True)
            os.replace(staging/path,target)
    verify()
    print('Consumed pinned Hieroglyphic Keyboard release:',latest)
    return True

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--verify',action='store_true')
    args=parser.parse_args()
    verify() if args.verify else update()

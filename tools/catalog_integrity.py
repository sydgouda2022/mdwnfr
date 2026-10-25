"""Validate the one published Late Egyptian Python/browser prediction catalogue.

Source authenticity and the 41,330-row SQLite authority are checked independently
by GitHub Actions. The browser checks the manifest hash at installation.
"""
from __future__ import annotations
import json

def validate_release_catalog(raw:bytes)->dict:
    data=json.loads(raw)
    if data.get('format')!='mdwnfr-predict-v1' or not isinstance(data.get('entries'),list):
        raise ValueError('Invalid native Egyptian lexicon format')
    entries=data['entries']
    meta=data.get('metadata')
    if not isinstance(meta,dict) or not entries or meta.get('spelling_records')!=len(entries):
        raise ValueError('Inconsistent Egyptian spelling catalogue')
    if meta.get('complete') is not False:
        raise ValueError('Only the audited development release may be published')
    return data

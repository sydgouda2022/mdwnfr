"""Reproducible layout throughput and geometry benchmark (no pass/fail timing gate).

Run from the repo root:
  PYTHONPATH=core python tools/benchmark_layout_v2.py --words 2000 --artworks 8

Uses actual deterministic document models and real silhouette data. Timings
depend on CPU and should be compared on the same environment and Python.
"""
import argparse
import json
import time
from copy import deepcopy

from mdwnfr.document import new_document, word, clipart
from mdwnfr.layout import layout_document, incremental_layout_document


def build_document(words, artworks, direction, surface='A3', font_size=10):
    doc=new_document('Measured object-stream layout',direction=direction,
                     surface=surface,font_size_pt=font_size)
    corpus=['𓅓𓏏','𓈖','𓇋𓏏','𓂋𓈖','𓏺','𓅓𓈖']
    assets=['bennu','horus-falcon-raster','amun-ra']
    items=[]
    anchors={words*(j+1)//(artworks+1) for j in range(artworks)}
    for i in range(words):
        if i in anchors:
            obj=clipart(assets[i%len(assets)],35+i%31,'normal')
            obj['y_align']=(i%7)/7
            items.append(obj)
        items.append(word(list(corpus[i%len(corpus)])))
    doc['items']=items
    return doc


def timed(label,callback):
    start=time.perf_counter()
    result=callback()
    return result,{'stage':label,'elapsed_ms':round((time.perf_counter()-start)*1000,2)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--words',type=int,default=2000)
    parser.add_argument('--artworks',type=int,default=8)
    parser.add_argument('--direction',choices=['rtl','ltr'],default='rtl')
    parser.add_argument('--surface',choices=['A4','A3','A2'],default='A3')
    parser.add_argument('--font-size',type=int,default=10)
    parser.add_argument('--edit-at',type=float,default=.5,
                        help='Fraction of stream preceding the insertion, 0.0-1.0')
    options=parser.parse_args()
    if not 1<=options.words<=100000 or not 0<=options.artworks<=min(200,options.words):
        parser.error('Use 1-100000 words and 0-200 artworks (not more artworks than words)')
    if not 0<=options.edit_at<=1 or not 6<=options.font_size<=72:
        parser.error('Use --edit-at 0.0-1.0 and --font-size 6-72')
    doc=build_document(options.words,options.artworks,options.direction,
                       options.surface,options.font_size)
    original,base=timed('full_initial',lambda:layout_document(doc))
    edited=deepcopy(doc)
    edited['items'].insert(int(len(edited['items'])*options.edit_at),word(['𓅓','𓇋']))
    edited['revision']+=1
    updated,edit=timed('insert_middle',lambda:incremental_layout_document(
        edited,doc,original))
    full,full_parity=timed('full_parity',lambda:layout_document(edited))
    if updated[0]!=full:
        raise AssertionError('Incremental reflow diverged from full compositor')
    compact,project=timed('compact_projection',lambda:incremental_layout_document(
        edited,compact=True))
    if compact[0]['document_id']!=doc['id']:
        raise AssertionError('Compact projection has wrong document ID')
    records=[base,edit,full_parity,project]
    report={
        'words':options.words,'artworks':options.artworks,
        'direction':options.direction,'surface':doc['surface'],
        'font_size_pt':options.font_size,'edit_at':options.edit_at,
        'pages':len(updated[0]['pages']),
        'objects':len(edited['items']),
        'layout_mode':updated[1]['mode'],
        'reused_prefix_columns':updated[1]['reused_prefix_columns'],
        'sample_timings':records
    }
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()

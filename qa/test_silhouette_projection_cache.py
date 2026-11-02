"""Exact silhouette projection parity and cached row-run invariants.

All reference calculations use the original raster-row collision semantics,
not a second word-layout implementation or approximate contour envelopes.
"""
import random
import unittest
from copy import deepcopy

from mdwnfr.silhouette import (
    SIZE, _profiles, _mask_rows, _free_from_blocks, free_sectors,
    _occupied_mask_row_runs,
)
from mdwnfr.document import new_document, word, clipart
from mdwnfr.layout import layout_document, incremental_layout_document


def original_free(mask, *, image_width, image_height, x_offset,
                  slot_left, slot_right, top, bottom, clearance, flip,
                  image_top):
    from math import floor, ceil
    epsilon = 2e-5
    x0 = max(0, min(SIZE, floor(
        (slot_left-clearance-x_offset+epsilon)/image_width*SIZE)))
    x1 = max(0, min(SIZE, ceil(
        (slot_right+clearance-x_offset-epsilon)/image_width*SIZE)))
    if x1 <= x0:
        return [(top, bottom)]
    blocked = []
    for j, occupied in enumerate(_mask_rows(mask)):
        if not occupied:
            continue
        def intersects(lo, hi):
            return bool((occupied >> (SIZE-hi)) & ((1 << (hi-lo))-1))
        overlaps = (intersects(x0, x1) if flip != 'mirror' else
                    intersects(SIZE-x1, SIZE-x0))
        if flip == 'auto':
            overlaps = overlaps or intersects(SIZE-x1, SIZE-x0)
        if not overlaps:
            continue
        lo = max(top, image_top+image_height*j/SIZE-clearance)
        hi = min(bottom, image_top+image_height*(j+1)/SIZE+clearance)
        if hi > lo:
            blocked.append((lo, hi))
    return _free_from_blocks(blocked,top,bottom)


class SilhouetteProjectionParity(unittest.TestCase):
    def test_pixel_exact_free_sectors_for_real_masks(self):
        rng = random.Random(773)
        profiles = _profiles()
        for art in ('bennu', 'horus-falcon-raster', 'amun-ra'):
            mask = profiles[art]['mask']
            for flip in ('normal', 'mirror', 'auto'):
                for _ in range(110):
                    image_width = rng.uniform(15, 120)
                    image_height = rng.uniform(15, 140)
                    x_offset = rng.uniform(-35, 70)
                    left = rng.uniform(-25, 140)
                    top = rng.uniform(0, 35)
                    bottom = top + rng.uniform(35, 230)
                    config = dict(image_width=image_width,
                        image_height=image_height, x_offset=x_offset,
                        slot_left=left, slot_right=left+rng.uniform(1, 30),
                        top=top, bottom=bottom, clearance=rng.uniform(0, 8),
                        flip=flip, image_top=rng.uniform(top-20, top+70))
                    before = original_free(mask, **config)
                    after = free_sectors(None, mask=mask, **config)
                    self.assertEqual(after,before,(art,flip,config))

    def test_projection_cache_keeps_transparent_areas_and_reuses_rows(self):
        mask = _profiles()['bennu']['mask']
        _occupied_mask_row_runs.cache_clear()
        runs = _occupied_mask_row_runs(mask,10,220,'normal')
        self.assertTrue(runs)
        self.assertTrue(all(0 <= a < b <= SIZE for a,b in runs))
        self.assertTrue(all(runs[i][1] < runs[i+1][0]
                            for i in range(len(runs)-1)))
        for _ in range(15):
            self.assertIs(_occupied_mask_row_runs(mask,10,220,'normal'),runs)
        self.assertGreaterEqual(_occupied_mask_row_runs.cache_info().hits,15)

    def test_illustrated_papyrus_retains_stable_word_order(self):
        for direction in ('ltr','rtl'):
            with self.subTest(direction=direction):
                doc = new_document('Masked papyrus layout',
                                   direction=direction, surface='papyrus',
                                   font_size_pt=12)
                items=[]
                for i in range(180):
                    if i in (12,40,130):
                        art=clipart(('bennu','horus-falcon-raster',
                                     'amun-ra')[i % 3],40,'normal')
                        art['y_align']=.2
                        items.append(art)
                    items.append(word(['𓅓','𓏏'] if i % 3 else ['𓈖']))
                doc['items']=items
                preserved = deepcopy(doc)
                base=layout_document(doc)
                edited=deepcopy(doc)
                edited['items'].insert(105,word(['𓇋','𓏏']))
                edited['revision']+=1
                recomposed,_=incremental_layout_document(edited,doc,base)
                self.assertEqual(recomposed,layout_document(edited))
                self.assertEqual(doc,preserved)
                ids=[p['id'] for page in recomposed['pages']
                     for col in page['columns'] for p in col['placements']
                     if p['type']=='word']
                self.assertEqual(ids,[item['id'] for item in edited['items']
                                      if item['type']=='word'])


if __name__ == '__main__':
    unittest.main()

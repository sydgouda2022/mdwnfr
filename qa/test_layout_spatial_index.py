"""Spatial-index and divider parity for Layout Engine 2.

Every optimized candidate set is checked against the unindexed, exact ink
intersection rule. These tests guard against trading away contour accuracy
for speed; they do not introduce a second compositor.
"""
import random
import unittest
from copy import deepcopy

from mdwnfr.document import new_document, word, clipart
from mdwnfr.layout import (
    _anchor_word_ink, _intersect_ink_runs, divider_ink_runs,
    layout_document, incremental_layout_document, expand_compact_layout,
)


class SpatialIndexParity(unittest.TestCase):
    def test_divider_sweep_matches_cartesian_reference(self):
        rng = random.Random(811)
        for _ in range(350):
            def generate():
                spans=[]
                for _ in range(rng.randrange(0, 24)):
                    top=rng.uniform(0, 360)
                    spans.append((top, top + rng.uniform(.01, 35)))
                return divider_ink_runs(spans, 0)
            a, b = generate(), generate()
            original = divider_ink_runs(sorted(
                (max(u, w), min(v, z))
                for u, v in a for w, z in b
                if min(v, z) > max(u, w) + 1e-8
            ), 0)
            self.assertEqual(_intersect_ink_runs(a, b), original)

    def test_candidate_index_never_drops_intersecting_ink(self):
        rng = random.Random(414)
        for _ in range(350):
            width = rng.uniform(5, 30)
            clearance = width / 4
            index = {}
            for slot in range(rng.randrange(1, 60)):
                glyphs = []
                for _ in range(rng.randrange(0, 8)):
                    ink_width = width * rng.uniform(.02, .7)
                    glyphs.append((slot * width + rng.uniform(0, width - ink_width),
                                   rng.uniform(0, 250), ink_width,
                                   rng.uniform(.5, 20)))
                index[slot] = glyphs
            x = rng.uniform(0, 60 * width)
            artwork_width = rng.uniform(3, 17 * width)
            def overlaps(ink):
                left, _, w, _ = ink
                return left < x + artwork_width + clearance and left + w > x - clearance
            expected = [ink for glyphs in index.values() for ink in glyphs
                        if overlaps(ink)]
            optimized = [ink for ink in _anchor_word_ink(
                index, x, artwork_width, clearance, width) if overlaps(ink)]
            self.assertEqual(sorted(optimized), sorted(expected))

    def test_reused_origins_do_not_recompute_each_identical_word(self):
        from unittest.mock import patch
        from mdwnfr.layout import free_word_starts
        doc=new_document('Cached legal origins',surface='A3',font_size_pt=10)
        doc['items']=[word(['𓅓','𓏏']) for _ in range(480)]
        with patch('mdwnfr.layout.free_word_starts',
                   wraps=free_word_starts) as query:
            result=layout_document(doc)
        count=sum(1 for p in result['pages'] for c in p['columns']
                  for _ in c['placements'])
        self.assertEqual(count,480)
        self.assertLess(query.call_count,480//4,
                        'Repeated words must not rescan unchanged obstacles')

    def test_dense_mixed_stream_retains_ids_and_compact_parity(self):
        for direction in ('rtl', 'ltr'):
            with self.subTest(direction=direction):
                doc = new_document('Dense mixed layout', direction=direction,
                                   surface='A3', font_size_pt=10)
                words = ['𓅓𓏏', '𓈖', '𓇋𓏏', '𓂋', '𓏺', '𓅓𓈖']
                art = ('horus-falcon-raster', 'bennu', 'amun-ra')
                items = []
                for i in range(720):
                    if i in (25, 130, 245, 355, 480, 620):
                        obj = clipart(art[(i // 100) % len(art)], 35 + i % 30, 'normal')
                        obj['y_align'] = (i % 7) / 7
                        items.append(obj)
                    items.append(word(list(words[i % len(words)])))
                doc['items'] = items
                before = deepcopy(doc)
                full = layout_document(doc)
                compact, stats = incremental_layout_document(doc, compact=True)
                self.assertEqual(expand_compact_layout(compact,
                    {item['id']: item for item in doc['items']}), full)
                self.assertEqual(doc, before, 'Reflow must not mutate objects')
                self.assertEqual(stats['mode'], 'object_stream')
                ids = [p['id'] for page in full['pages']
                       for col in page['columns'] for p in col['placements']]
                self.assertEqual(len(ids), len(doc['items']))
                self.assertEqual(set(ids), {item['id'] for item in doc['items']})
                rendered_words = [p['id'] for page in full['pages']
                    for col in page['columns'] if col['kind'] == 'words'
                    for p in col['placements']]
                self.assertEqual(rendered_words, [item['id'] for item in items
                                                   if item['type'] == 'word'])
                edited = deepcopy(doc)
                edited['items'].insert(360, word(['𓂋', '𓈖']))
                edited['revision'] += 1
                updated, stats = incremental_layout_document(edited, doc, full)
                self.assertEqual(updated, layout_document(edited))
                self.assertEqual(stats['mode'], 'object_stream')


if __name__ == '__main__':
    unittest.main()

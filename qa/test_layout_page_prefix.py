"""Page-prefix caching must be byte-for-byte identical to full recomposition.

The test intentionally exercises the real font contours and existing
compositor. No alternate placement rules, synthetic glyph metrics, or page
coordinates are introduced.
"""
from copy import deepcopy
import unittest

from mdwnfr.document import new_document, word, clipart, cartouche
from mdwnfr.tables import table
from mdwnfr.layout import (
    layout_document, incremental_layout_document, expand_compact_layout,
    LayoutSession
)


def document(direction):
    doc = new_document('Stable completed pages', direction=direction,
                       surface='A4', font_size_pt=18)
    items = []
    for index in range(960):
        if index in (80, 450, 720):
            bird = clipart('horus-falcon-raster' if index != 720 else 'bennu',
                           40, 'normal')
            bird['y_align'] = .25
            items.append(bird)
        if index == 180:
            items.append(table(2, 2))
        if index == 630:
            items.append(cartouche('horizontal', [['𓅓', '𓏏'], ['𓈖']]))
        items.append(word(['𓅓','𓏏'] if index % 3 else ['𓈖']))
    doc['items'] = items
    return doc


class CompletedPageRecomposition(unittest.TestCase):
    def test_full_and_compact_match_after_late_edit(self):
        for direction in ('rtl', 'ltr'):
            with self.subTest(direction=direction):
                doc = document(direction)
                previous = deepcopy(doc)
                full = layout_document(doc)
                self.assertGreaterEqual(len(full['pages']), 2,
                                        'Fixture must create complete pages')
                compact, _ = incremental_layout_document(doc, compact=True)
                edited = deepcopy(doc)
                edited['items'].insert(len(edited['items']) - 12,
                                       word(['𓇋', '𓏏']))
                edited['revision'] += 1
                expected = layout_document(edited)
                optimized, stats = incremental_layout_document(edited, doc, full)
                self.assertEqual(optimized, expected)
                self.assertEqual(stats['mode'], 'complete_page_prefix',
                                 'A late edit should reuse safe completed pages')
                self.assertGreater(stats['reused_prefix_columns'], 0)
                self.assertGreater(stats['start_index'], 0)
                compact_result, compact_stats = incremental_layout_document(
                    edited, doc, compact, compact=True)
                self.assertEqual(compact_stats['mode'], 'complete_page_prefix')
                self.assertEqual(expand_compact_layout(compact_result,
                    {item['id']: item for item in edited['items']}), expected)
                self.assertEqual(doc, previous, 'Cache must not mutate source')

    def test_early_edits_or_changed_paper_reflow_everything(self):
        doc = document('rtl')
        previous = layout_document(doc)
        early = deepcopy(doc)
        early['items'].insert(1, word(['𓈖', '𓇋']))
        early['revision'] += 1
        result, stats = incremental_layout_document(early, doc, previous)
        self.assertEqual(result, layout_document(early))
        self.assertEqual(stats['mode'], 'object_stream')
        changed_paper = deepcopy(doc)
        changed_paper['surface'] = 'A3'
        changed_paper['revision'] += 1
        result, stats = incremental_layout_document(changed_paper, doc, previous)
        self.assertEqual(result, layout_document(changed_paper))
        self.assertEqual(stats['mode'], 'object_stream')

    def test_layout_session_is_reused_without_faking_revision(self):
        doc = document('ltr')
        session = LayoutSession(compact=True)
        _, first = session.calculate(doc)
        self.assertEqual(first['mode'], 'object_stream')
        updated = deepcopy(doc)
        updated['items'][-1] = word(['𓅓'])
        updated['revision'] += 1
        result, stats = session.calculate(updated)
        self.assertEqual(result['revision'], updated['revision'])
        self.assertEqual(expand_compact_layout(result,
            {obj['id']: obj for obj in updated['items']}),
            layout_document(updated))
        self.assertEqual(stats['mode'], 'complete_page_prefix')
        self.assertLess(stats['computed_columns'],
                        first['computed_columns'])


if __name__ == '__main__':
    unittest.main()

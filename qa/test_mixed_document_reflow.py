"""Stress the canonical object stream across paper and editing changes.

The compositor is the only source of geometry. Switching paper, deleting
surrounding words, and changing artwork sizes must never reassign object IDs,
lose text, or leave a stale compact projection.
"""
import unittest
from copy import deepcopy
from mdwnfr.document import new_document, word, clipart, cartouche, transaction
from mdwnfr.tables import table
from mdwnfr.layout import layout_document, incremental_layout_document, expand_compact_layout


class MixedDocumentReflow(unittest.TestCase):
    def build(self, direction):
        doc = new_document('Mixed object reflow', direction=direction,
                           surface='A3', font_size_pt=10)
        bird = clipart('horus-falcon-raster', 52, 'normal')
        bird['y_align'] = .25
        amun = clipart('amun-ra', 43)
        amun['y_align'] = .45
        cells = table(2, 2)
        cells['rows'][0][0]['items'] = [word(['𓈖','𓏏'])]
        seal = cartouche('horizontal', [['𓅓','𓏏'], ['𓈖']])
        doc['items'] = (
            [word(['𓅓','𓏏']) for _ in range(36)] + [bird] +
            [word(['𓈖','𓏺']) for _ in range(48)] + [cells] +
            [word(['𓅓']) for _ in range(25)] + [seal] +
            [word(['𓂋','𓈖']) for _ in range(30)] + [amun] +
            [word(['𓏺']) for _ in range(58)])
        return doc, [bird['id'], cells['id'], seal['id'], amun['id']]

    @staticmethod
    def placed(layout):
        return [(column['kind'], placement['id'])
                for page in layout['pages'] for column in page['columns']
                for placement in column['placements']]

    def check(self, doc):
        full = layout_document(doc)
        compact, _ = incremental_layout_document(doc, compact=True)
        self.assertEqual(expand_compact_layout(
            compact, {obj['id']: obj for obj in doc['items']}), full)
        placed = self.placed(full)
        for obj in doc['items']:
            self.assertIn(obj['id'], [id for _, id in placed])
            if obj['type'] != 'table':
                self.assertEqual(sum(id == obj['id'] for _, id in placed), 1)
        rendered_words = [id for kind,id in placed if kind == 'words']
        self.assertEqual(rendered_words,
                         [obj['id'] for obj in doc['items']
                          if obj['type'] == 'word'])
        self.assertTrue(all(page['width'] > 0 and page['height'] > 0
                            for page in full['pages']))
        return full

    def test_delete_resize_paper_direction_preserves_ids_and_stream(self):
        for direction in ('rtl','ltr'):
            with self.subTest(direction=direction):
                doc, object_ids = self.build(direction)
                original_ids = [obj['id'] for obj in doc['items']]
                self.check(doc)
                # Delete both sides of the bird and cartouche, preserving the
                # actual objects and their relative order.
                edited = deepcopy(doc)
                edited['items'] = [obj for i,obj in enumerate(edited['items'])
                                   if obj['type'] != 'word' or i % 5 != 0]
                edited['revision'] += 1
                expected = [obj['id'] for obj in edited['items']]
                for paper in ('A4','A2','A3'):
                    edited['surface'] = paper
                    edited['revision'] += 1
                    actual = self.check(edited)
                    self.assertEqual([obj['id'] for obj in edited['items']], expected)
                    self.assertEqual([id for _,id in self.placed(actual)
                                      if id in object_ids], object_ids)
                # Resize artwork using the official validated document action.
                bird = object_ids[0]
                before = next(obj for obj in edited['items'] if obj['id']==bird)
                edited = transaction(edited, {'op':'set_clipart','id':bird,
                                               'width_mm':before['width_mm']+16})
                self.check(edited)
                self.assertEqual([obj['id'] for obj in edited['items']], expected)
                edited['direction'] = 'ltr' if direction == 'rtl' else 'rtl'
                edited['revision'] += 1
                self.check(edited)

    def test_reflow_does_not_mutate_persistent_content(self):
        doc, _ = self.build('rtl')
        before = deepcopy(doc)
        old = layout_document(doc)
        after = deepcopy(doc)
        after['items'].insert(20, word(['𓇋','𓏏']))
        after['revision'] += 1
        incremental, stats = incremental_layout_document(after, doc, old)
        self.assertEqual(incremental, layout_document(after))
        self.assertEqual(stats['mode'], 'object_stream')
        self.assertEqual(doc, before)
        self.assertEqual(after['items'][21]['id'], doc['items'][20]['id'])


if __name__ == '__main__':
    unittest.main()

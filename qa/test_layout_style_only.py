"""Color-only editing must reuse geometry without confusing content revisions."""
from copy import deepcopy
import unittest

from mdwnfr.document import new_document, word, clipart, cartouche, assert_document
from mdwnfr.tables import table
from mdwnfr.layout import (
    layout_document, incremental_layout_document,
    expand_compact_layout, LayoutSession,
)
from mdwnfr.layout_sync import LayoutDocumentSession


def make_document(surface, direction):
    doc = new_document('Style-only layout', surface=surface,
                       direction=direction, font_size_pt=14)
    words = [('𓅓', '𓏏'), ('𓇋',), ('𓈖', '𓏺'), ('𓂋',)]
    items = []
    for i in range(140):
        if i == 34:
            art = clipart('bennu', 38, 'normal')
            art['y_align'] = .24
            items.append(art)
        if i == 78:
            items.append(table(2, 2))
        if i == 115:
            items.append(cartouche('horizontal', [['𓅓', '𓏏'], ['𓈖']]))
        items.append(word(list(words[i % 4])))
    doc['items'] = items
    assert_document(doc)
    return doc


class StyleOnlyLayoutTests(unittest.TestCase):
    def test_colors_preserve_exact_geometry_for_paper_and_papyrus(self):
        for surface in ('A4', 'A3', 'papyrus'):
            for direction in ('ltr', 'rtl'):
                with self.subTest(surface=surface, direction=direction):
                    doc = make_document(surface, direction)
                    before = deepcopy(doc)
                    full = layout_document(doc)
                    compact, _ = incremental_layout_document(doc, compact=True)
                    edited = deepcopy(doc)
                    changes = [entry for entry in edited['items']
                               if entry['type'] == 'word']
                    changes[0]['color'] = '#ac2533'
                    changes[len(changes)//2]['color'] = '#ac2533'
                    changes[-1]['color'] = '#ac2533'
                    edited['revision'] += 1
                    expected = layout_document(edited)
                    actual, stats = incremental_layout_document(edited, doc, full)
                    self.assertEqual(stats['mode'], 'style_only')
                    self.assertEqual(stats['computed_columns'], 0)
                    self.assertEqual(actual, expected)
                    # A retained prior snapshot must not be mutated by editing.
                    self.assertEqual(full, layout_document(doc))
                    comp, cstats = incremental_layout_document(
                        edited, doc, compact, compact=True)
                    self.assertEqual(cstats['mode'], 'style_only')
                    self.assertEqual(comp['revision'], edited['revision'])
                    self.assertEqual(expand_compact_layout(comp,
                        {item['id']: item for item in edited['items']}), expected)
                    self.assertEqual(doc, before)

    def test_changed_geometry_and_metrics_do_not_use_style_fast_path(self):
        doc = make_document('A4', 'rtl')
        previous = layout_document(doc)
        for change in ('signs', 'bold', 'font', 'clipart', 'direction'):
            altered = deepcopy(doc)
            altered['revision'] += 1
            first = next(o for o in altered['items'] if o['type'] == 'word')
            if change == 'signs':
                first['signs'] = ['𓅓', '𓇋']
                # A new symbol cannot keep the original persistent atom IDs.
                first['symbol_ids'] = [first['symbol_ids'][0], 'fresh-atom-id']
            elif change == 'bold':
                first['bold'] = not first['bold']
            elif change == 'font':
                altered['font_size_pt'] = 16
            elif change == 'clipart':
                next(o for o in altered['items']
                     if o['type'] == 'clipart')['width_mm'] += 10
            else:
                altered['direction'] = 'ltr'
            with self.subTest(change=change):
                actual, stats = incremental_layout_document(altered, doc, previous)
                self.assertNotEqual(stats['mode'], 'style_only')
                self.assertEqual(actual, layout_document(altered))

    def test_compact_layout_session_and_revisioned_deltas(self):
        doc = make_document('papyrus', 'rtl')
        session = LayoutSession(compact=True)
        previous, _ = session.calculate(doc)
        modified = deepcopy(doc)
        target = next(i for i in modified['items'] if i['type'] == 'word')
        target['color'] = '#ac2533'
        modified['revision'] += 1
        snapshot, stats = session.calculate(modified)
        self.assertEqual(stats['mode'], 'style_only')
        self.assertEqual(snapshot['revision'], modified['revision'])
        self.assertEqual(expand_compact_layout(snapshot,
            {item['id']: item for item in modified['items']}), layout_document(modified))
        self.assertEqual(previous['revision'], doc['revision'])
        # The production delta mirror must not treat a color edit as a
        # revision gap or generate new IDs.
        mirror = LayoutDocumentSession()
        mirror.open(doc, summary_only=True)
        index = next(i for i, o in enumerate(doc['items']) if o['type'] == 'word')
        response = mirror.sync(doc['id'], doc['revision'], [{
            'document_id':doc['id'], 'base_revision':doc['revision'],
            'revision':modified['revision'],
            'change':{'kind':'update', 'updates':[{
                'index':index, 'object':deepcopy(modified['items'][index])}]}
        }], summary_only=True)
        self.assertEqual(response['layout_stats']['mode'], 'style_only')
        self.assertEqual(response['revision'], modified['revision'])


if __name__ == '__main__':
    unittest.main()

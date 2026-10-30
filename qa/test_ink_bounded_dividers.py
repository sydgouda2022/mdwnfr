"""An inserted object is the separator: lines must not rule blank space."""
import math
import unittest

from mdwnfr.document import new_document, word, clipart
from mdwnfr.layout import divider_ink_runs, layout_document, object_clearance_mm


class InkBoundedDividers(unittest.TestCase):
    def test_normal_word_gaps_join_but_long_empty_regions_do_not(self):
        runs = [(10, 13), (14, 17), (26, 28), (35, 39)]
        self.assertEqual(divider_ink_runs(runs, 2),
                         [(10, 17), (26, 28), (35, 39)])
        self.assertEqual(divider_ink_runs(runs, 0), runs)

    def test_no_divider_through_visual_extent_of_artwork(self):
        for direction in ('ltr', 'rtl'):
            with self.subTest(direction=direction):
                doc = new_document('Object is the divider', direction=direction,
                                   surface='A3', font_size_pt=10)
                art = clipart('horus-falcon-raster', 60, 'normal')
                art['y_align'] = .25
                doc['items'] = ([word(['𓅓', '𓏏']) for _ in range(24)]
                                + [art]
                                + [word(['𓅓', '𓈖']) for _ in range(900)])
                layout = layout_document(doc)
                clearance = object_clearance_mm(layout['column_width_mm'])
                found_art = False
                count = 0
                for page in layout['pages']:
                    for col in page['columns']:
                        if col['kind'] != 'clipart':
                            continue
                        for obj in col['placements']:
                            if obj['id'] != art['id']:
                                continue
                            found_art = True
                            left = obj['x'] - clearance
                            right = obj['x'] + obj['width_mm'] + clearance
                            top = obj['y'] - clearance
                            bottom = obj['y'] + obj['height'] + clearance
                            for line in page['dividers']:
                                count += 1
                                if not (left < line['x'] + line['thickness_mm']/2
                                        and line['x']-line['thickness_mm']/2 < right):
                                    continue
                                self.assertTrue(
                                    line['y2'] <= top + 1e-4 or
                                    line['y1'] >= bottom - 1e-4,
                                    'Illustration, not a decorative line, '
                                    'must divide nearby writing')
                self.assertTrue(found_art)
                self.assertGreater(count, 0)

    def test_every_divider_has_glyph_ink_on_both_sides(self):
        for direction in ('ltr', 'rtl'):
            with self.subTest(direction=direction):
                doc = new_document('Ink-bounded only', direction=direction,
                                   surface='A3', font_size_pt=10)
                art = clipart('bennu', 55, 'normal')
                art['y_align'] = .25
                doc['items'] = ([word(['𓅓', '𓈖']) for _ in range(18)]
                                + [art]
                                + [word(['𓈖', '𓇋']) for _ in range(360)])
                layout = layout_document(doc)
                width = layout['column_width_mm']
                margin = layout['margins_mm']['left']
                tested = 0
                for page in layout['pages']:
                    slots = {}
                    for col in page['columns']:
                        if col['kind'] == 'words' and col['placements']:
                            slot = round((col['x'] - margin)/width)
                            slots.setdefault(slot, []).extend(col['text_runs'])
                    prepared = {slot: divider_ink_runs(runs, width/2)
                                for slot, runs in slots.items()}
                    for line in page['dividers']:
                        right = round((line['x']-margin)/width)
                        for side in (right-1, right):
                            self.assertTrue(any(
                                a <= line['y1'] + 1e-4 and
                                b >= line['y2'] - 1e-4
                                for a, b in prepared.get(side, [])),
                                'Divider extends outside actual text ink')
                        tested += 1
                self.assertGreater(tested, 0)


if __name__ == '__main__':
    unittest.main()

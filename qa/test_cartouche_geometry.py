"""Joined cartouche geometry and obstacle-mask consistency."""
import unittest

from mdwnfr.document import new_document, cartouche
from mdwnfr.layout import layout_document
from mdwnfr.silhouette import cartouche_object_mask, _mask_rows


class JoinedCartoucheGeometryTests(unittest.TestCase):
    def test_cartouche_outline_is_one_continuous_path(self):
        for orientation in ('horizontal', 'vertical'):
            for direction in ('rtl', 'ltr'):
                with self.subTest(orientation=orientation, direction=direction):
                    doc = new_document('Joined cartouche', direction=direction,
                                       font_size_pt=16)
                    obj = cartouche(orientation, [['𓅓', '𓏏'], ['𓈖']])
                    doc['items'] = [obj]
                    layout = layout_document(doc)
                    entry = next(p for page in layout['pages']
                                 for column in page['columns']
                                 if column['kind'] == 'cartouche'
                                 for p in column['placements'])
                    geometry = entry['cartouche']
                    path = geometry['outline_path']
                    self.assertEqual(path.count('M '), 1,
                                     'The rope and finishing tie must share one path')
                    self.assertNotIn(' Z', path,
                                     'A closed oval plus a detached tie is not one rope')
                    self.assertEqual(len(geometry['words']), 2)
                    self.assertEqual(
                        geometry['terminal_end'],
                        'bottom' if orientation == 'vertical' else
                        ('left' if direction == 'rtl' else 'right'))

    def test_cartouche_obstacle_mask_matches_joined_capsule(self):
        for orientation in ('horizontal', 'vertical'):
            for direction in ('rtl', 'ltr'):
                with self.subTest(orientation=orientation, direction=direction):
                    doc = new_document('Cartouche mask', direction=direction,
                                       font_size_pt=16)
                    obj = cartouche(orientation, [['𓅓']])
                    doc['items'] = [obj]
                    layout = layout_document(doc)
                    entry = next(p for page in layout['pages']
                                 for column in page['columns']
                                 if column['kind'] == 'cartouche'
                                 for p in column['placements'])
                    geometry = entry['cartouche']
                    encoded = cartouche_object_mask(
                        geometry['width_mm'], geometry['height'], orientation,
                        geometry['terminal_end'], geometry['stroke_mm'])
                    rows = _mask_rows(encoded)
                    center_bit = 1 << (256 - 1 - 128)
                    if orientation == 'horizontal':
                        self.assertEqual(rows[128], (1 << 256) - 1)
                    else:
                        self.assertTrue(all(row & center_bit for row in rows))


if __name__ == '__main__':
    unittest.main()

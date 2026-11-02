"""Two user-visible geometry regressions: connected royal cartouche and dividers.

A divider must be clipped to the *painted mask*, not the image rectangle.
Cartesian line segments in the final detailed layout are checked using
exactly the same silhouette query used for quadrat collision avoidance.
"""
import unittest
from mdwnfr.document import new_document, word, clipart, cartouche
from mdwnfr.layout import layout_document, object_clearance_mm, incremental_layout_document, expand_compact_layout
from mdwnfr.silhouette import free_sectors, _mask_rows


class JoinedCartoucheAndDivider(unittest.TestCase):
    def test_cartouche_is_one_continuous_outline_in_both_directions(self):
        for orientation in ('horizontal','vertical'):
            for direction in ('rtl','ltr'):
                with self.subTest(orientation=orientation,direction=direction):
                    doc=new_document('Joined cartouche',direction=direction,
                        font_size_pt=16)
                    obj=cartouche(orientation,[['𓅓','𓏏'],['𓈖']])
                    doc['items']=[obj]
                    layout=layout_document(doc)
                    entry=next(p for page in layout['pages'] for c in page['columns']
                               if c['kind']=='cartouche' for p in c['placements'])
                    geometry=entry['cartouche']
                    path=geometry['outline_path']
                    self.assertEqual(path.count('M '),1,
                        'One enclosure must not use separate SVG paths')
                    self.assertNotIn(' Z',path)
                    self.assertEqual(len(geometry['words']),2)
                    self.assertEqual(
                        geometry['terminal_end'],
                        'bottom' if orientation=='vertical' else
                        ('left' if direction=='rtl' else 'right'))
                    mask_entry=layout_document(doc)
                    self.assertEqual(mask_entry,layout)
                    compact,_=incremental_layout_document(doc,compact=True)
                    self.assertEqual(expand_compact_layout(compact,
                        {obj['id']:obj}),layout)

    def test_dividers_respect_actual_bird_mask_not_opaque_image_frame(self):
        tested=0
        for direction in ('rtl','ltr'):
            for artwork in ('horus-falcon-raster','bennu'):
                with self.subTest(direction=direction,artwork=artwork):
                    doc=new_document('Contour-aware dividers',direction=direction,
                        surface='A3',font_size_pt=10)
                    bird=clipart(artwork,72,'normal')
                    bird['y_align']=.28
                    doc['items']=[word(['𓅓','𓏏']) for _ in range(55)]+[
                        bird]+[word(['𓈖']) if i%2 else word(['𓅓','𓏏'])
                                for i in range(900)]
                    layout=layout_document(doc)
                    clearance=object_clearance_mm(layout['column_width_mm'])
                    for pg in layout['pages']:
                        art=next((p for c in pg['columns'] if c['kind']=='clipart'
                                  for p in c['placements'] if p['id']==bird['id']),None)
                        if art is None:continue
                        adjacent=[d for d in pg['dividers']
                                  if d['x']>=art['x']-clearance and
                                     d['x']<=art['x']+art['width_mm']+clearance]
                        self.assertGreater(len(adjacent),0,
                            'Fixture requires writing dividers near the bird')
                        for divider in adjacent:
                            allowed=free_sectors(art['artwork_id'],
                                image_width=art['width_mm'],image_height=art['height'],
                                x_offset=art['x'],image_top=art['y'],
                                slot_left=divider['x']-divider['thickness_mm']/2,
                                slot_right=divider['x']+divider['thickness_mm']/2,
                                top=0,bottom=pg['height'],
                                clearance=clearance,flip=art['resolved_flip'])
                            self.assertTrue(any(
                                a<=divider['y1']+.0001 and
                                b>=divider['y2']-.0001 for a,b in allowed),
                                'Divider intersects painted bird or quarter-column clearance')
                            tested+=1
        self.assertGreater(tested,12)


if __name__=='__main__':
    unittest.main()

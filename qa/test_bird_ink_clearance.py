"""Bird silhouettes: measure FINAL painted glyph ink, not word boxes.

These are final-page, post-justification invariants for Horus/Bennu, not
tests of the intermediate anchor solver. Actual catalogue masks, physical
position, glyph rectangles, RTL facing and quarter-column clearance are used.
"""
import unittest
from copy import deepcopy

from mdwnfr.document import new_document, word, clipart
from mdwnfr.layout import (layout_document, incremental_layout_document,
                           expand_compact_layout, object_clearance_mm)
from mdwnfr.silhouette import free_sectors


BIRDS = ('horus-falcon-raster', 'bennu')
SPELLINGS = (['𓅓', '𓏏'], ['𓈖'], ['𓇋', '𓏏'], ['𓏺'])


def document(bird, direction, surface, width_mm, y_align):
    doc = new_document('Illustrated ink clearance',
                       direction=direction,surface=surface,font_size_pt=10)
    initial = [word(SPELLINGS[i % len(SPELLINGS)]) for i in range(18)]
    obj = clipart(bird,width_mm,'auto')
    obj['y_align'] = y_align
    trailing = [word(SPELLINGS[i % len(SPELLINGS)])
                for i in range(300)]
    doc['items'] = [*initial,obj,*trailing]
    return doc,obj


def bird_placements(layout):
    for page in layout['pages']:
        for column in page['columns']:
            if column['kind'] == 'clipart':
                for placement in column['placements']:
                    yield page,placement


def ink_near_bird(layout):
    """Check each final glyph ink rectangle against nearby 2D mask cells."""
    visited = 0
    overlap_columns=set()
    clear_below=set()
    clear_above=set()
    for page,bird in bird_placements(layout):
        clearance=object_clearance_mm(layout['column_width_mm'])
        for col in page['columns']:
            if col['kind']!='words':
                continue
            for placed in col['placements']:
                for g in placed['quadrat']['signs']:
                    # SVG mirrors the entire quadrat in RTL. Collision
                    # assertions must inspect the same physical ink position.
                    local_x=(g['x'] if layout['direction']=='ltr' else
                             layout['column_width_mm']-g['x']-g['width'])
                    x=placed['x']+local_x
                    y=placed['y']+g['y']
                    w,h=g['width'],g['height']
                    if not (x < bird['x']+bird['width_mm']+clearance and
                            x+w > bird['x']-clearance):
                        continue
                    visited+=1
                    possible=free_sectors(bird['artwork_id'],
                        image_width=bird['width_mm'], image_height=bird['height'],
                        x_offset=bird['x'],slot_left=x,slot_right=x+w,
                        top=y-.0002,bottom=y+h+.0002,
                        clearance=clearance,flip=bird['resolved_flip'],
                        image_top=bird['y'])
                    assert any(a<=y+0.0004 and b>=y+h-0.0004
                               for a,b in possible), (
                        'Final glyph ink violates bird silhouette clearance',
                        bird['artwork_id'],page['index'],placed['id'],
                        g['sign'],(x,y,w,h),(bird['x'],bird['y'],
                                           bird['width_mm'],bird['height']))
                    overlap_columns.add((page['index'],round(col['x'],5)))
                    if y >= bird['y']+bird['height']+clearance:
                        clear_below.add((page['index'],round(col['x'],5)))
                    if y+h <= bird['y']-clearance:
                        clear_above.add((page['index'],round(col['x'],5)))
    return visited,overlap_columns,clear_above,clear_below


class FinalBirdInkClearance(unittest.TestCase):
    def test_final_quadrat_ink_stays_out_of_actual_bird_contours(self):
        for bird in BIRDS:
            for direction in ('ltr','rtl'):
                for surface in ('A4','A3','papyrus'):
                    with self.subTest(bird=bird,direction=direction,surface=surface):
                        doc,obj=document(bird,direction,surface,60,.24)
                        page=layout_document(doc)
                        visited,overlap,upper,lower=ink_near_bird(page)
                        self.assertGreater(visited,0,'Fixture never approached bird ink')
                        self.assertGreater(len(overlap),1,
                            'One image box must not reserve all of its reading columns')
                        self.assertGreater(len(lower),0,
                            'Words must reclaim legally clear space below the bird')
                        self.assertEqual(sum(1 for _ in bird_placements(page)),1)
                        self.assertEqual([p['id'] for pg in page['pages']
                          for col in pg['columns'] if col['kind']=='words'
                          for p in col['placements']],
                          [i['id'] for i in doc['items'] if i['type']=='word'])


    def test_two_birds_do_not_strand_following_text_on_trailing_page_edge(self):
        # Mirrors the mobile browser fixture at its larger 22 pt font size.
        for direction in ('rtl','ltr'):
            with self.subTest(direction=direction):
                doc=new_document('Two floating birds',direction=direction,
                                 surface='A4',font_size_pt=22)
                items=[]
                count=0
                def add_words(n):
                    nonlocal count
                    for _ in range(n):
                        items.append(word(SPELLINGS[count % len(SPELLINGS)]))
                        count+=1
                add_words(18)
                horus=clipart('horus-falcon-raster',60,'auto')
                horus['y_align']=.22
                items.append(horus)
                add_words(185)
                bennu=clipart('bennu',60,'auto')
                bennu['y_align']=.29
                items.append(bennu)
                add_words(280)
                doc['items']=items
                result=layout_document(doc)
                for page,art in bird_placements(result):
                    self.assertGreaterEqual(art['x'],-1e-6)
                    self.assertLessEqual(art['x']+art['width_mm'],
                                         page['width']+1e-6)
                    ink=[]
                    for col in page['columns']:
                        if col['kind']!='words':
                            continue
                        for placed in col['placements']:
                            for glyph in placed['quadrat']['signs']:
                                gx=(glyph['x'] if direction=='ltr' else
                                    result['column_width_mm']-glyph['x']-glyph['width'])
                                ink.append((placed['x']+gx,placed['y']+glyph['y'],
                                            glyph['width'],glyph['height']))
                    shared=[(x,y,w,h) for x,y,w,h in ink
                            if x<art['x']+art['width_mm'] and x+w>art['x']]
                    self.assertTrue(shared,
                        f"{direction}: {art['artwork_id']} isolated at page {page['index']}; "
                        f"art x={art['x']:.2f}..{art['x']+art['width_mm']:.2f}, "
                        f"word glyph x-range={min((x for x,_,_,_ in ink),default=-1):.2f}"
                        f"..{max((x+w for x,_,w,_ in ink),default=-1):.2f}; "
                        f"columns={len(page['columns'])}, words={len(ink)}, "
                        f"intersect={len(shared)}")

    def test_resizing_both_birds_keeps_collision_and_compact_parity(self):
        for bird in BIRDS:
            for direction in ('ltr','rtl'):
                with self.subTest(bird=bird,direction=direction):
                    doc,obj=document(bird,direction,'A3',42,.22)
                    before=layout_document(doc)
                    self.assertGreater(ink_near_bird(before)[0],0)
                    new=deepcopy(doc)
                    resized=next(i for i in new['items'] if i['id']==obj['id'])
                    resized['width_mm']=75
                    new['revision']+=1
                    expected=layout_document(new)
                    result,_=incremental_layout_document(new,doc,before)
                    self.assertEqual(result,expected)
                    self.assertGreater(ink_near_bird(result)[0],0)
                    compact,_=incremental_layout_document(new,compact=True)
                    self.assertEqual(expand_compact_layout(compact,
                        {item['id']:item for item in new['items']}),expected)


if __name__=='__main__':
    unittest.main()

"""Silhouette layout invariants across real shipped Egyptian font profiles."""
import json,math,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'core'))
from mdwnfr.quadrat import compose,expand_internal,expand_after_word,expand_to_ink_bottom,glyph_geometry,glyph_scanlines,glyph_optical_factors,_silhouette_advance
from mdwnfr.layout import fixed_page_column_grid, layout_document, column_width_mm
from mdwnfr.typography import DIVIDER_TO_STEM_RATIO, glyph_reference_stroke_mm, divider_stroke_mm

C=20.0
def near(test,left,right):
    test.assertTrue(math.isclose(left,right,rel_tol=1e-8,abs_tol=1e-8),
                    f'{left} != {right}')

class VisibleInkComposition(unittest.TestCase):
    def test_vertical_dividers_are_exactly_twice_the_prior_thickness(self):
        self.assertEqual(DIVIDER_TO_STEM_RATIO,6.0)
        for font_pt in (6,12,22,36,72):
            target=round(6.0*glyph_reference_stroke_mm(font_pt),5)
            near(self,divider_stroke_mm(font_pt),target)
        # Verify the published layout uses the same authoritative metric,
        # without moving a divider away from its original column boundary.
        from mdwnfr.document import new_document,transaction
        doc=new_document('Divider thickness')
        for index in range(48):
            doc=transaction(doc,{'op':'insert_word','index':index,
                                 'signs':['𓅓']})
        result=layout_document(doc)
        dividers=[line for page in result['pages']
                  for line in page['dividers']]
        self.assertTrue(dividers,'Dense text should produce column dividers')
        for line in dividers:
            near(self,line['thickness_mm'],divider_stroke_mm(doc['font_size_pt']))
            self.assertGreater(line['y2'],line['y1'])

    def test_optical_detail_is_calculated_from_ink_and_bounded(self):
        factors=glyph_optical_factors()
        self.assertTrue(all(1.0<=value<=1.18 for value in factors.values()))
        # Complex figures are larger than plain, heavy vertical strokes,
        # but all scaling remains uniform and contained inside the column.
        self.assertGreater(factors['𓅓'],factors['𓏺'])
        for sign in ('𓅓','𓅱','𓀀','𓉐','𓈖'):
            q=compose([sign],C)
            g=q.signs[0]
            box=glyph_geometry()[sign]
            near(self,g.width/g.height,(box[2]-box[0])/(box[3]-box[1]))
            self.assertLessEqual(g.width,3*C/4+1e-8)
            self.assertLessEqual(g.height,C+1e-8)

    def test_one_font_one_catalogue(self):
        data=json.loads((ROOT/'core/mdwnfr/data/glyph_geometry.json').read_text())
        self.assertEqual(data['format'],'mdwnfr-glyph-ink-v2')
        self.assertEqual(data['resolution'],64)
        self.assertEqual(len(glyph_scanlines()),1072)
        self.assertEqual(len(glyph_optical_factors()),1072)
        self.assertEqual(len(glyph_geometry()),1072)
        self.assertEqual(data['font_sha256'],
                         'b792accc6207ca9caa59fc67f53926b6985a99d255dd432d7c68b68a6dfd62f8')

    def test_owl_uses_one_row_and_half_width_margins(self):
        q=compose(list('𓅓'),C)
        self.assertEqual(q.rows,((0,),))
        s=q.signs[0]
        near(self,s.width,C/2*glyph_optical_factors()['𓅓'])
        near(self,s.x,(C-s.width)/2)
        near(self,C-s.x-s.width,(C-s.width)/2)
        near(self,s.y,0.0)
        near(self,q.height-s.y-s.height,s.height/2)
        near(self,q.height,1.5*s.height)
        self.assertEqual(len(q.flexible_gaps),1)

    def test_real_silhouette_profiles_reduce_unused_gap(self):
        # Complementary half-width ink contours may have overlapping
        # rectangular boxes while their actual ink remains well separated.
        a=[[0,32] for _ in range(64)]
        b=[[32,64] for _ in range(64)]
        gap=_silhouette_advance(a,b,2.0,4.0,2.0,4.0)
        self.assertGreater(gap,1.0)  # includes the quarter-sum-width ink gap
        self.assertLess(gap,3.0)    # bounding-rectangle gap would be 3.0
        for row_a,row_b in zip(a,b):
            free=(gap+row_b[0]*2/64)-(row_a[1]*2/64)
            self.assertGreaterEqual(free,(2+2)/4)

    def test_each_glyph_has_nonempty_bounded_silhouette(self):
        for sign,rows in glyph_scanlines().items():
            self.assertEqual(len(rows),64,sign)
            self.assertTrue(any(r is not None for r in rows),sign)
            for r in rows:
                if r is not None:self.assertTrue(0<=r[0]<r[1]<=64,sign)

    def test_two_slender_glyphs_share_row_and_gap_is_half_width(self):
        q=compose(list('𓇋𓇋'),C)
        self.assertEqual(q.rows,((0,1),))
        a,b=q.signs
        near(self,a.height,b.height)
        near(self,b.x-a.x-a.width,(a.width+b.width)/4)
        near(self,a.y,0.0)
        near(self,q.height-(a.y+a.height),a.height/2)
        near(self,q.height,1.5*a.height)
        for g in (a,b):
            box=glyph_geometry()[g.sign]
            near(self,g.width/g.height,(box[2]-box[0])/(box[3]-box[1]))

    def test_mixed_slender_signs_use_taller_row(self):
        q=compose(list('𓇋𓇄'),C)
        self.assertEqual(q.rows,((0,1),))
        a,b=q.signs
        taller=max(a.height,b.height)
        near(self,q.height,1.5*taller)
        near(self,a.y+a.height/2,b.y+b.height/2)
        near(self,q.flexible_gaps[0],taller/2)
        self.assertEqual(len(q.flexible_gaps),1)

    def test_owl_does_not_share_row_with_narrow_reed(self):
        q=compose(list('𓇋𓅓'),C)
        self.assertEqual(q.rows,((0,),(1,)))
        a,b=q.signs
        near(self,b.y-(a.y+a.height),a.height/2)
        near(self,a.y,0.0)

    def test_flat_signs_preserve_silhouette_ratio(self):
        for sign in '𓈖𓏏':
            q=compose([sign],C)
            g=q.signs[0]
            box=glyph_geometry()[sign]
            near(self,g.width/g.height,(box[2]-box[0])/(box[3]-box[1]))
            ratio=(box[2]-box[0])/(box[3]-box[1])
            target=min(3*C/4,max(C/2,ratio*C/4))
            near(self,g.width,min(3*C/4,target*glyph_optical_factors()[sign]))
            self.assertGreaterEqual(g.width,C/2)
            self.assertLessEqual(g.width,3*C/4)
            near(self,q.height,1.5*g.height)

    def test_ultranarrow_stroke_has_bounded_height(self):
        q=compose(list('𓏺'),C)
        self.assertEqual(q.rows,((0,),))
        self.assertLessEqual(q.signs[0].height,C+1e-8)
        near(self,q.height,1.5*q.signs[0].height)
        self.assertLessEqual(q.signs[0].height,C+1e-8)
        self.assertGreaterEqual(q.signs[0].x,0)
        self.assertLessEqual(q.signs[0].x+q.signs[0].width,C+1e-8)

    def test_svg_bearing_coordinates_match_ink_rectangle(self):
        for sign in '𓅓𓇋𓏏𓈖𓏺':
            g=compose([sign],C).signs[0]
            left,bottom,right,top=glyph_geometry()[sign]
            near(self,g.text_x+left*g.font_size,g.x)
            near(self,g.text_x+right*g.font_size,g.x+g.width)
            near(self,g.text_y-top*g.font_size,g.y)
            near(self,g.text_y-bottom*g.font_size,g.y+g.height)

    def test_independent_words_share_exact_silhouette_row_spacing(self):
        from mdwnfr.document import new_document,transaction
        from mdwnfr.layout import layout_document
        doc=new_document('Measured column spacing')
        doc=transaction(doc,{'op':'insert_word','index':0,'signs':['𓅓']})
        doc=transaction(doc,{'op':'insert_word','index':1,'signs':['𓈖']})
        result=layout_document(doc)
        placements=[item for page in result['pages'] for col in page['columns']
                    for item in col['placements'] if item.get('type')=='word']
        self.assertGreaterEqual(len(placements),2)
        first,second=placements[:2]
        a=first['quadrat']['signs'][0]
        b=second['quadrat']['signs'][0]
        bottom=first['y']+a['y']+a['height']
        top=second['y']+b['y']
        # The last column is incomplete, so the natural preceding-row
        # half-height gap remains and only the terminal whitespace disappears.
        self.assertAlmostEqual(top-bottom,a['height']/2,places=4)
        self.assertAlmostEqual(placements[-1]['quadrat']['flexible_gaps'][-1],0)

    def test_asymmetric_neighbors_have_one_preceding_half_height_gap(self):
        for sequence in ('𓅓𓈖', '𓈖𓅓', '𓅓𓅓', '𓈖𓈖'):
            q=compose(list(sequence),C)
            self.assertEqual(q.rows,((0,),(1,)))
            first,next_sign=q.signs
            near(self,first.y,0.0)
            near(self,next_sign.y-first.y-first.height,first.height/2)
            near(self,q.height-next_sign.y-next_sign.height,next_sign.height/2)
            near(self,q.height,1.5*(first.height+next_sign.height))
            self.assertEqual(len(q.flexible_gaps),2)

    def test_several_rows_have_only_one_trailing_half_height_gap(self):
        for sequence in ('𓅓𓏏𓈖𓇋', '𓇋𓇋𓅓𓏏', '𓏏𓅓𓅓'):
            q=compose(list(sequence),C)
            self.assertEqual(len(q.rows),len(q.flexible_gaps))
            heights=[max(q.signs[i].height for i in row) for row in q.rows]
            near(self,q.height,1.5*sum(heights))
            for index,row in enumerate(q.rows):
                top=min(q.signs[i].y for i in row)
                if index==0:near(self,top,0.0)
                else:
                    preceding=q.rows[index-1]
                    bottom=max(q.signs[i].y+q.signs[i].height for i in preceding)
                    near(self,top-bottom,heights[index-1]/2)
                near(self,q.flexible_gaps[index],heights[index]/2)

    def test_fixed_paper_shares_remaining_width_and_papyrus_keeps_nominal(self):
        count,width=fixed_page_column_grid(310,15)
        self.assertEqual(count,20)
        near(self,width,15.5)
        near(self,count*width,310)
        # A4 uses the SAME uniform width for every occupied column slot.
        from mdwnfr.document import new_document
        from mdwnfr.document import SURFACES,validated_margins
        doc=new_document('Fixed paper width')
        frame=SURFACES[doc['surface']][0]-sum(validated_margins(doc)[s]
                                              for s in ('left','right'))
        expected_n,expected_width=fixed_page_column_grid(
            frame,column_width_mm(doc['font_size_pt']))
        result=layout_document(doc)
        near(self,result['column_width_mm'],expected_width)
        near(self,expected_n*result['column_width_mm'],frame)
        papyrus={**doc,'surface':'papyrus'}
        papyrus_result=layout_document(papyrus)
        near(self,papyrus_result['column_width_mm'],
             column_width_mm(doc['font_size_pt']))

    def test_equal_justification_shares_per_sign_and_not_per_word(self):
        q=compose(list('𓇋𓇋𓅓𓏏'),C)
        self.assertEqual(q.rows[0],(0,1))
        remainder=10
        adjusted=expand_internal(q,remainder)
        self.assertEqual(len(q.signs),4)
        near(self,adjusted.height-q.height,remainder)
        old_gaps=q.flexible_gaps
        new_gaps=adjusted.flexible_gaps
        for index,group in enumerate(q.rows):
            near(self,new_gaps[index]-old_gaps[index],
                 remainder*len(group)/len(q.signs))
        for before,after in zip(q.signs,adjusted.signs):
            near(self,before.height,after.height)
            near(self,before.width,after.width)
            near(self,before.font_size,after.font_size)
            near(self,before.x,after.x)

    def test_completed_page_column_expands_each_word_equally(self):
        from mdwnfr.document import new_document,transaction,validated_margins,SURFACES
        doc=new_document('Fit the remaining column')
        for i in range(34):
            doc=transaction(doc,{'op':'insert_word','index':i,'signs':['𓅓']})
        result=layout_document(doc)
        first=[col for page in result['pages'] for col in page['columns']
               if col['kind']=='words' and col['placements']][0]
        word_positions=first['placements']
        self.assertGreaterEqual(len(word_positions),3)
        top=validated_margins(doc)['top']
        bottom=SURFACES[doc['surface']][1]-validated_margins(doc)['bottom']
        last=word_positions[-1]
        self.assertAlmostEqual(last['y']+last['height'],bottom,places=4)
        self.assertAlmostEqual(word_positions[0]['y'],top,places=4)
        natural=compose(['𓅓'],result['column_width_mm'])
        # All available gaps are interior after closing the final ink edge.
        # N one-sign words therefore have N-1 distributable gaps; the final
        # word's trailing half-height gap is removed, not enlarged.
        trailing=natural.flexible_gaps[-1]
        expected=(bottom-top-len(word_positions)*natural.height+trailing)/(len(word_positions)-1)
        self.assertGreater(expected,0.0)
        for entry in word_positions[:-1]:
            self.assertAlmostEqual(entry['height']-natural.height,expected,places=4)
        self.assertAlmostEqual(word_positions[-1]['height'],
                               natural.height-trailing,places=4)
        for left,right in zip(word_positions,word_positions[1:]):
            self.assertAlmostEqual(right['y']-(left['y']+left['height']),0,places=4)

    def test_completed_column_balances_first_and_last_visible_ink(self):
        from mdwnfr.document import new_document,transaction,validated_margins,SURFACES
        from mdwnfr.layout import incremental_layout_document,expand_compact_layout
        doc=new_document('Page edge ink',font_size_pt=22)
        for i in range(34):
            doc=transaction(doc,{'op':'insert_word','index':i,
                                 'signs':['𓅓'] if i%3 else ['𓈖']})
        full=layout_document(doc)
        ink_cols=[col for p in full['pages'] for col in p['columns']
                  if col['kind']=='words' and col.get('ink_bottom_aligned')]
        self.assertTrue(ink_cols,'Expected at least one full justified column')
        margins=validated_margins(doc)
        bottom=SURFACES[doc['surface']][1]-margins['bottom']
        for col in ink_cols:
            words=col['placements']
            first=words[0]
            last=words[-1]
            first_ink=first['y']+min(s['y'] for s in first['quadrat']['signs'])
            last_ink=last['y']+max(s['y']+s['height'] for s in last['quadrat']['signs'])
            self.assertAlmostEqual(first_ink,margins['top'],places=4)
            self.assertAlmostEqual(last_ink,bottom,places=4)
            self.assertAlmostEqual(last['y']+last['height'],bottom,places=4)
            self.assertAlmostEqual(last['quadrat']['flexible_gaps'][-1],0,places=7)
        compact,_=incremental_layout_document(doc,compact=True)
        detailed=expand_compact_layout(compact,{o['id']:o for o in doc['items']})
        compact_cols=[col for p in detailed['pages'] for col in p['columns']
                      if col['kind']=='words' and col.get('ink_bottom_aligned')]
        self.assertEqual(len(ink_cols),len(compact_cols))
        for original,derived in zip(ink_cols,compact_cols):
            self.assertEqual([p['id'] for p in original['placements']],
                             [p['id'] for p in derived['placements']])
            for a,b in zip(original['placements'],derived['placements']):
                self.assertAlmostEqual(a['y'],b['y'],places=5)
                for a_sign,b_sign in zip(a['quadrat']['signs'],b['quadrat']['signs']):
                    self.assertAlmostEqual(a_sign['y'],b_sign['y'],places=7)
                    self.assertAlmostEqual(a_sign['height'],b_sign['height'],places=7)

    def test_final_column_keeps_words_natural_and_not_page_justified(self):
        from mdwnfr.document import new_document,transaction,validated_margins,SURFACES
        from mdwnfr.layout import incremental_layout_document,expand_compact_layout
        for sequence in [['𓅓'],['𓅓','𓈖'],['𓇋','𓅓','𓏏']]:
            doc=new_document('Natural unfinished column')
            for index,sign in enumerate(sequence):
                doc=transaction(doc,{'op':'insert_word','index':index,
                                     'signs':[sign]})
            layout=layout_document(doc)
            columns=[c for page in layout['pages'] for c in page['columns']
                     if c['kind']=='words' and c['placements']]
            self.assertEqual(len(columns),1)
            col=columns[0]
            self.assertFalse(col.get('word_boundary_justify',False))
            self.assertFalse(col.get('ink_bottom_aligned',False))
            self.assertTrue(col.get('terminal_gap_removed'))
            self.assertAlmostEqual(col['placements'][0]['y'],
                                   validated_margins(doc)['top'],places=5)
            last=col['placements'][-1]
            lower=SURFACES[doc['surface']][1]-validated_margins(doc)['bottom']
            self.assertLess(last['y']+last['height'],lower)
            self.assertAlmostEqual(last['quadrat']['flexible_gaps'][-1],0)
            for item in col['placements']:
                natural=compose(item['signs'],layout['column_width_mm'])
                for g,h in zip(item['quadrat']['signs'],natural.signs):
                    near(self,g['y'],h.y)
                    near(self,g['height'],h.height)
            compact,_=incremental_layout_document(doc,compact=True)
            detailed=expand_compact_layout(
                compact,{item['id']:item for item in doc['items']})
            recovered=detailed['pages'][0]['columns'][0]['placements']
            for full,small in zip(col['placements'],recovered):
                self.assertAlmostEqual(full['height'],small['height'],places=5)
                for a,b in zip(full['quadrat']['signs'],small['quadrat']['signs']):
                    near(self,a['y'],b['y'])

    def test_adjustment_changes_only_spaces_between_complete_words(self):
        from mdwnfr.document import new_document,transaction
        from mdwnfr.layout import incremental_layout_document,expand_compact_layout
        doc=new_document('Only overflow justifies')
        for i in range(37):
            signs=['𓇋','𓇋','𓅓'] if i%3==0 else ['𓅓']
            doc=transaction(doc,{'op':'insert_word','index':i,'signs':signs})
        full=layout_document(doc)
        justified=[col for page in full['pages'] for col in page['columns']
                   if col.get('word_boundary_justify')]
        self.assertTrue(justified)
        for col in justified:
            self.assertGreater(len(col['placements']),1)
            for item in col['placements']:
                natural=compose(item['signs'],full['column_width_mm'])
                for sign,origin in zip(item['quadrat']['signs'],natural.signs):
                    near(self,sign['x'],origin.x)
                    near(self,sign['y'],origin.y)
                    near(self,sign['height'],origin.height)
            spacers=[p['height']-compose(p['signs'],full['column_width_mm']).height
                     for p in col['placements'][:-1]]
            self.assertTrue(all(v>0 for v in spacers))
            self.assertLess(max(spacers)-min(spacers),0.00002)
        compact,_=incremental_layout_document(doc,compact=True)
        expanded=expand_compact_layout(compact,{i['id']:i for i in doc['items']})
        full_cols=[c for page in full['pages'] for c in page['columns']
                   if c.get('word_boundary_justify')]
        copy_cols=[c for page in expanded['pages'] for c in page['columns']
                   if c.get('word_boundary_justify')]
        self.assertEqual(len(full_cols),len(copy_cols))
        for old,new in zip(full_cols,copy_cols):
            for first,second in zip(old['placements'],new['placements']):
                self.assertAlmostEqual(first['y'],second['y'],places=5)
                for a,b in zip(first['quadrat']['signs'],
                               second['quadrat']['signs']):
                    near(self,a['y'],b['y'])

    def test_final_edge_redistribution_does_not_stretch_ink(self):
        q=compose(list('𓅓𓇋𓈖'),C)
        share=3.0
        tail=q.flexible_gaps[-1]
        eligible=sum(len(row) for row in q.rows[:-1])
        expected_extra=share*eligible-tail
        result=expand_to_ink_bottom(q,expected_extra)
        near(self,result.height,q.height+expected_extra)
        near(self,result.flexible_gaps[-1],0.0)
        for index,row in enumerate(q.rows[:-1]):
            near(self,result.flexible_gaps[index]-q.flexible_gaps[index],
                 share*len(row))
        for original,changed in zip(q.signs,result.signs):
            near(self,original.width,changed.width)
            near(self,original.height,changed.height)
            near(self,original.font_size,changed.font_size)
            near(self,original.x,changed.x)

    def test_justification_changes_only_whitespace(self):
        q=compose(list('𓅓𓇋𓏏'),C)
        other=expand_internal(q,11)
        near(self,other.height,q.height+11)
        self.assertEqual(q.rows,other.rows)
        for old,new in zip(q.signs,other.signs):
            near(self,old.x,new.x)
            near(self,old.width,new.width)
            near(self,old.height,new.height)
            near(self,old.font_size,new.font_size)
            near(self,new.text_y-old.text_y,new.y-old.y)

class ArtworkWordFlow(unittest.TestCase):
    @staticmethod
    def document(direction='rtl', offset=0, count=240, font_size=10):
        from mdwnfr.document import new_document, word, clipart
        doc=new_document('Word shapes around Horus',font_size_pt=font_size)
        doc['direction']=direction
        doc['items']=[word(list('𓍘𓈖𓂝𓂻') if i%3 else list('𓇋𓅓𓏏'))
                      for i in range(count)]
        art=clipart('horus-falcon-raster',65,flip='normal')
        art['x_offset_mm']=offset
        doc['items'].insert(min(32,count),art)
        return doc

    def assert_natural_ink(self, layout):
        for page in layout['pages']:
            for col in page['columns']:
                if col['kind']!='words':continue
                for item in col['placements']:
                    natural=compose(item['signs'],layout['column_width_mm'])
                    for actual,expected in zip(item['quadrat']['signs'],natural.signs):
                        for key in ('x','y','width','height','font_size','text_x','text_y'):
                            self.assertAlmostEqual(actual[key],getattr(expected,key),places=7,
                                msg=f"{col.get('slot_offset')} {item['id']} {key}")

    def test_wrapping_keeps_complete_word_shapes_in_both_directions(self):
        for direction in ('ltr','rtl'):
            for offset in (-22,0,42):
                for font_size in (10,22):
                    with self.subTest(direction=direction,offset=offset,font_size=font_size):
                        doc=self.document(direction,offset,font_size=font_size)
                        layout=layout_document(doc)
                        self.assertTrue(any(c.get('span')==0 and c['placements']
                            for p in layout['pages'] for c in p['columns']))
                        self.assert_natural_ink(layout)
                        words=[p['id'] for page in layout['pages'] for c in page['columns']
                               if c['kind']=='words' for p in c['placements']]
                        self.assertEqual(words,[o['id'] for o in doc['items'] if o['type']=='word'])

    def test_short_wrapped_stream_starts_at_top_without_forced_fill(self):
        from mdwnfr.document import new_document,word,clipart
        for count in (1,2):
            doc=new_document('Unfinished artwork sector')
            doc['items']=[clipart('horus-falcon-raster',65)]+[
                word(list('𓇋𓅓𓏏')) for _ in range(count)]
            layout=layout_document(doc)
            col=next(c for p in layout['pages'] for c in p['columns']
                     if c['kind']=='words' and c['placements'])
            self.assertAlmostEqual(col['placements'][0]['y'],18,places=5)
            self.assertFalse(col.get('word_boundary_justify',False))
            self.assert_natural_ink(layout)

    def test_compact_wrapped_layout_matches_full_geometry(self):
        from mdwnfr.layout import incremental_layout_document,expand_compact_layout
        doc=self.document(offset=-22)
        full=layout_document(doc)
        small,_=incremental_layout_document(doc,compact=True)
        expanded=expand_compact_layout(small,{o['id']:o for o in doc['items']})
        self.assertEqual(expanded,full)

    def test_dividers_join_matching_sectors_in_neighboring_slots(self):
        from mdwnfr.silhouette import free_sectors
        from mdwnfr.layout import object_clearance_mm
        layout=layout_document(self.document(offset=42))
        checked=0
        width=layout['column_width_mm']
        for page in layout['pages']:
            art=next((p for c in page['columns'] if c['kind']=='clipart'
                      for p in c['placements']),None)
            if art is None:continue
            sectors=[c for c in page['columns'] if c.get('span')==0 and c['placements']]
            for left in sectors:
                for right in sectors:
                    if not math.isclose(left['x']+width,right['x'],abs_tol=1e-5):continue
                    # The actual adjoining ink runs, not the outer column
                    # envelope, determine where a divider may exist.
                    for ltop,lbottom in left['text_runs']:
                        for rtop,rbottom in right['text_runs']:
                            top=max(ltop,rtop)
                            bottom=min(lbottom,rbottom)
                            if bottom-top<1:continue
                            thickness=divider_stroke_mm(layout['font_size_pt'])
                            safe=free_sectors(art['artwork_id'],image_width=art['width_mm'],
                                image_height=art['height'],x_offset=art['x'],
                                slot_left=right['x']-thickness/2,slot_right=right['x']+thickness/2,
                                top=top,bottom=bottom,clearance=object_clearance_mm(width),
                                flip=art['resolved_flip'],image_top=art['y'])
                            for a,b in safe:
                                if b-a<1:continue
                                checked+=1
                                self.assertTrue(any(math.isclose(d['x'],right['x'],abs_tol=1e-5)
                                    and d['y1']<=a+1e-4 and d['y2']>=b-1e-4
                                    for d in page['dividers']),
                                    f'Missing ink-bounded divider at {right["x"]}')
        self.assertGreater(checked,0)

    def test_dividers_terminate_at_both_adjacent_text_runs(self):
        from mdwnfr.layout import object_clearance_mm
        for direction in ('ltr','rtl'):
            layout=layout_document(self.document(direction=direction,offset=42))
            width=layout['column_width_mm']
            margins=layout['margins_mm']
            tested=0
            for page in layout['pages']:
                by_slot={}
                for column in page['columns']:
                    if column['kind']!='words' or not column['placements']:
                        continue
                    slot=round((column['x']-margins['left'])/width)
                    by_slot.setdefault(slot,[]).extend(column['text_runs'])
                for divider in page['dividers']:
                    right=round((divider['x']-margins['left'])/width)
                    left_runs=by_slot.get(right-1,[])
                    right_runs=by_slot.get(right,[])
                    for edge in (divider['y1'],divider['y2']):
                        self.assertTrue(any(a-1e-4<=edge<=b+1e-4
                                            for a,b in left_runs))
                        self.assertTrue(any(a-1e-4<=edge<=b+1e-4
                                            for a,b in right_runs))
                    tested+=1
            self.assertGreater(tested,0)
            self.assertAlmostEqual(object_clearance_mm(width),width/4)

    def test_contour_reclaims_below_bird_before_next_columns(self):
        from mdwnfr.document import new_document,word,clipart
        from mdwnfr.layout import object_clearance_mm
        for direction in ('ltr','rtl'):
            doc=new_document('Bird and lower margin',font_size_pt=10)
            doc['direction']=direction
            bird=clipart('horus-falcon-raster',60,flip='normal')
            bird['y_align']=.15
            doc['items']=[bird]+[word(['𓏺']) for _ in range(320)]
            layout=layout_document(doc)
            page=layout['pages'][0]
            art=next(p for col in page['columns'] if col['kind']=='clipart'
                     for p in col['placements'])
            width=layout['column_width_mm']
            clearance=object_clearance_mm(width)
            bottom=page['height']-layout['margins_mm']['bottom']
            below=[placement for col in page['columns'] if col['kind']=='words'
                   for placement in col['placements']
                   if placement['x']<art['x']+art['width_mm'] and
                      placement['x']+width>art['x'] and
                      placement['y']>=art['y']+art['height']+clearance-1e-4 and
                      placement['y']+max(g['y']+g['height']
                          for g in placement['quadrat']['signs'])<=bottom+1e-4]
            self.assertTrue(below,'Words must use the clear region below the bird')
            self.assert_natural_ink(layout)

    def test_words_and_dividers_keep_the_artwork_clearance(self):
        from mdwnfr.silhouette import free_sectors
        from mdwnfr.layout import object_clearance_mm
        for direction in ('rtl','ltr'):
            for offset in (-22,0,42):
                layout=layout_document(self.document(direction,offset))
                width=layout['column_width_mm']
                for page in layout['pages']:
                    arts=[p for c in page['columns'] if c['kind']=='clipart'
                          for p in c['placements']]
                    areas=[(p['x']+(g['x'] if direction=='ltr' else width-g['x']-g['width']),
                            p['x']+(g['x']+g['width'] if direction=='ltr' else width-g['x']),
                            p['y']+g['y'],p['y']+g['y']+g['height'])
                        for c in page['columns'] if c['kind']=='words'
                        for p in c['placements'] for g in p['quadrat']['signs']]
                    areas.extend((d['x']-d['thickness_mm']/2,d['x']+d['thickness_mm']/2,d['y1'],d['y2'])
                                 for d in page['dividers'])
                    for art in arts:
                        for left,right,top,bottom in areas:
                            safe=free_sectors(art['artwork_id'],image_width=art['width_mm'],
                                image_height=art['height'],x_offset=art['x'],
                                slot_left=left,slot_right=right,top=top,bottom=bottom,
                                clearance=object_clearance_mm(width),flip=art['resolved_flip'],image_top=art['y'])
                            self.assertLessEqual(bottom-top-sum(b-a for a,b in safe),.0001)

    def test_visible_ink_can_fill_the_channel_between_two_legs(self):
        import base64
        from mdwnfr.silhouette import free_word_starts,free_sectors
        from mdwnfr.layout import object_clearance_mm
        width=16
        # Two 2-mm opaque legs, with a genuinely transparent 12-mm channel.
        bits=((1<<32)-1)<<224 | (1<<32)-1
        mask=base64.b64encode(bits.to_bytes(32,'big')*256).decode('ascii')
        obstacle=(None,None,mask,width,80,0,'normal',20)
        q=compose(['𓏺'],width)
        clear=object_clearance_mm(width)
        self.assertEqual(clear,width/4)
        # The former column-sized exclusion rejects the entire lower lane.
        self.assertEqual(free_sectors(None,mask=mask,image_width=width,image_height=80,
            x_offset=0,slot_left=0,slot_right=width,top=18,bottom=100,
            clearance=clear,image_top=20),[])
        starts=free_word_starts(q,column_left=0,top=18,bottom=100,
                               clearance=clear,obstacles=[obstacle])
        self.assertTrue(any(a<=40<=b for a,b in starts))

    def test_clearance_is_a_quarter_column_from_actual_ink(self):
        from mdwnfr.silhouette import free_word_starts,solid_object_mask
        from mdwnfr.layout import object_clearance_mm
        width=20;clear=object_clearance_mm(width)
        q=compose(['𓅓'],width);g=q.signs[0]
        edge=g.x+g.width+clear
        def fits(x):
            starts=free_word_starts(q,column_left=0,top=18,bottom=100,
                clearance=clear,obstacles=[(None,None,solid_object_mask(),4,80,x,'normal',18)])
            return any(a<=40<=b for a,b in starts)
        self.assertTrue(fits(edge))
        self.assertFalse(fits(edge-.1))

    def test_dense_bennu_text_uses_transparent_channels_instead_of_column_boxes(self):
        from mdwnfr.document import new_document,word,clipart
        from mdwnfr.layout import object_clearance_mm
        from mdwnfr.silhouette import free_sectors
        for direction in ('rtl','ltr'):
            doc=new_document('Bennu contour reference')
            doc['direction']=direction
            doc['items']=[word(list('𓈖𓂝𓂻')) for _ in range(500)]
            doc['items'].insert(48,clipart('bennu',80,'normal'))
            layout=layout_document(doc);page=layout['pages'][0]
            art=next(p for c in page['columns'] if c['kind']=='clipart' for p in c['placements'])
            width=layout['column_width_mm'];reclaimed=0
            for col in page['columns']:
                if col['kind']!='words':continue
                for p in col['placements']:
                    if p['y']<art['y']+art['height']*.6:continue
                    safe=free_sectors(art['artwork_id'],image_width=art['width_mm'],
                        image_height=art['height'],x_offset=art['x'],
                        slot_left=p['x'],slot_right=p['x']+width,
                        top=p['y'],bottom=p['y']+p['height'],
                        clearance=object_clearance_mm(width),flip=art['resolved_flip'],image_top=art['y'])
                    if sum(b-a for a,b in safe)<p['height']-.01:reclaimed+=1
            self.assertGreater(reclaimed,2,'Narrow ink should occupy space rejected by column rectangles')
            self.assert_natural_ink(layout)
            self.assertEqual([p['id'] for page in layout['pages'] for c in page['columns']
                if c['kind']=='words' for p in c['placements']],
                [o['id'] for o in doc['items'] if o['type']=='word'])

if __name__=='__main__':unittest.main()

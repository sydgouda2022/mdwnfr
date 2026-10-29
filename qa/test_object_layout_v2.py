"""Object IDs/sequence are the source of truth; paper and typography only project them."""
import unittest
from copy import deepcopy
from mdwnfr.document import new_document,word,clipart
from mdwnfr.layout import layout_document,incremental_layout_document,expand_compact_layout

def ids_in_layout(layout):
    return [pl['id'] for page in layout['pages'] for col in page['columns']
            for pl in col['placements']]

def words_in_layout(layout):
    return [pl['id'] for page in layout['pages'] for col in page['columns']
            if col['kind']=='words' for pl in col['placements']]

class ObjectSequenceLayout(unittest.TestCase):
    def make_doc(self,direction='rtl',surface='A3'):
        doc=new_document('Object sequence 776 → 777',direction=direction)
        doc['surface']=surface
        prefix=[word(['𓅓','𓏏']) for _ in range(70)]
        image=clipart('horus-falcon-raster',60,'normal')
        image['y_align']=.18
        suffix=[word(['𓏺']) for _ in range(180)]
        doc['items']=[*prefix,image,*suffix]
        return doc,image['id']

    def test_a3_to_a4_and_deletions_preserve_id_and_order(self):
        for direction in ('rtl','ltr'):
            with self.subTest(direction=direction):
                doc,ident=self.make_doc(direction)
                a3=layout_document(doc)
                self.assertEqual(words_in_layout(a3),
                    [i['id'] for i in doc['items'] if i['type']=='word'])
                self.assertEqual(ids_in_layout(a3).count(ident),1)
                edited=deepcopy(doc)
                edited['items']=edited['items'][30:-40]
                edited['surface']='A4'
                edited['revision']+=1
                a4=layout_document(edited)
                self.assertEqual([i['id'] for i in edited['items']],
                                 [i['id'] for i in doc['items'][30:-40]])
                self.assertEqual(words_in_layout(a4),
                    [i['id'] for i in edited['items'] if i['type']=='word'])
                self.assertEqual(ids_in_layout(a4).count(ident),1)
                self.assertNotEqual(a3['column_width_mm'],a4['column_width_mm'])

    def test_object_offset_is_reclamped_when_paper_shrinks(self):
        for direction in ('rtl','ltr'):
            doc,image_id=self.make_doc(direction)
            image=next(item for item in doc['items'] if item['id']==image_id)
            image['x_offset_mm']=280.0
            a3=layout_document(doc)
            small=deepcopy(doc)
            small['surface']='A4'
            small['revision']+=1
            a4=layout_document(small)
            self.assertEqual(ids_in_layout(a3).count(image_id),1)
            self.assertEqual(ids_in_layout(a4).count(image_id),1)
            self.assertEqual(words_in_layout(a4),
                [item['id'] for item in small['items'] if item['type']=='word'])

    def test_geometry_is_rederived_from_sequence_not_saved_coordinates(self):
        doc,ident=self.make_doc()
        first=layout_document(doc)
        doc['items']=[i for i in doc['items']
                      if i['id']==ident or i['type']=='word' and i in doc['items'][-25:]]
        doc['revision']+=1
        second=layout_document(doc)
        self.assertEqual(words_in_layout(second),
                         [i['id'] for i in doc['items'] if i['type']=='word'])
        self.assertEqual(ids_in_layout(second).count(ident),1)
        compact,_=incremental_layout_document(doc,compact=True)
        self.assertEqual(expand_compact_layout(compact,{o['id']:o for o in doc['items']}),second)

    def test_each_quadrat_sign_has_persistent_identity(self):
        from mdwnfr.document import transaction
        from mdwnfr.history import recorded_transaction
        doc=new_document('Symbol atoms')
        first=word(['𓅓','𓏏','𓈖'])
        doc['items']=[first]
        ids=first['symbol_ids']
        self.assertEqual(len(set(ids)),3)
        before=layout_document(doc)
        quad=next(pl['quadrat'] for page in before['pages']
                  for col in page['columns'] for pl in col['placements']
                  if pl['id']==first['id'])
        self.assertEqual([g['id'] for g in quad['signs']],ids)
        resized=deepcopy(doc)
        resized['surface']='A3'
        resized['revision']=1
        after=layout_document(resized)
        q2=next(pl['quadrat'] for page in after['pages']
                for col in page['columns'] for pl in col['placements']
                if pl['id']==first['id'])
        self.assertEqual([g['id'] for g in q2['signs']],ids)
        command={'op':'replace_signs','id':first['id'],
                 'signs':['𓅓','𓇋','𓏏','𓈖']}
        result=recorded_transaction(doc,command)
        edited=result['document']['items'][0]
        self.assertEqual([edited['symbol_ids'][i] for i in (0,2,3)],ids)
        undone=transaction(result['document'],result['undo'])
        self.assertEqual(undone['items'][0]['symbol_ids'],ids)

    def test_legacy_words_keep_deterministic_atom_ids(self):
        from mdwnfr.document import assert_document
        doc=new_document('Legacy identity')
        item=word(['𓅓','𓏏'])
        del item['symbol_ids']
        doc['items']=[item]
        assert_document(doc)
        first=layout_document(doc)
        doc['surface']='A3'
        second=layout_document(doc)
        atoms=lambda snapshot: [g['id'] for pg in snapshot['pages']
            for col in pg['columns'] for pl in col['placements']
            if pl['type']=='word' for g in pl['quadrat']['signs']]
        self.assertEqual(atoms(first),atoms(second))

    def test_default_table_uses_real_writing_space_with_editable_cell_heights(self):
        from mdwnfr.tables import table
        for surface in ('A4','A3','A2'):
            for direction in ('ltr','rtl'):
                with self.subTest(surface=surface,direction=direction):
                    doc=new_document('Readable blank table',direction=direction,
                                     surface=surface,font_size_pt=10)
                    obj=table(2,2)
                    doc['items']=[obj]
                    layout=layout_document(doc)
                    slots=[p for page in layout['pages'] for column in page['columns']
                           if column['kind']=='table' for p in column['placements']]
                    self.assertEqual(len(slots),1)
                    placement=slots[0]
                    geo=placement['table']
                    glyph_width=layout['column_width_mm']
                    self.assertGreaterEqual(geo['width_mm'],glyph_width*10,
                        'New 2-column tables must not be tiny unreadable boxes')
                    self.assertGreaterEqual(geo['row_heights'][0],glyph_width*2.5)
                    self.assertEqual(geo['columns'],2)
                    self.assertEqual(geo['rows'],2)
                    self.assertEqual(len(geo['cells']),4)
                    for cell in geo['cells']:
                        self.assertGreaterEqual(cell['height'],glyph_width*2.5)
                        self.assertGreaterEqual(cell['width'],glyph_width*2)
                        self.assertGreaterEqual(cell['x'],0)
                        self.assertLessEqual(cell['x']+cell['width'],
                                             geo['width_mm']+.0001)
                        self.assertLessEqual(cell['y']+cell['height'],
                                             geo['height']+.0001)
                    compact,_=incremental_layout_document(doc,compact=True)
                    self.assertEqual(expand_compact_layout(compact,
                        {obj['id']:obj}),layout)

    def test_table_explicit_width_is_retained_and_cell_text_remains_inside(self):
        from mdwnfr.tables import table
        from mdwnfr.document import transaction
        doc=new_document('User-defined table size',direction='ltr',
                         surface='A4',font_size_pt=10)
        obj=table(2,2,width_mm=60)
        obj['rows'][0][0]['items']=[word(['𓅓','𓏏']),word(['𓈖','𓇋'])]
        doc['items']=[obj]
        layout=layout_document(doc)
        fragment=next(p['table'] for page in layout['pages']
                      for c in page['columns'] if c['kind']=='table'
                      for p in c['placements'])
        self.assertGreaterEqual(fragment['width_mm'],60)
        self.assertLess(fragment['width_mm'],70)
        word_count=0
        for cell in fragment['cells']:
            for item in cell['words']:
                word_count+=1
                self.assertGreaterEqual(item['x'],0)
                self.assertGreaterEqual(item['y'],0)
                self.assertLessEqual(item['x']+item['quadrat']['width'],
                                     cell['width']+.00001)
                self.assertLessEqual(item['y']+item['height'],
                                     cell['height']+.00001)
        self.assertEqual(word_count,2)
        edit=transaction(doc,{'op':'set_table_cell','id':obj['id'],
            'row':1,'column':1,'mode':'text','words':[['𓅓','𓏏']]})
        self.assertEqual(len(edit['items'][0]['rows'][1][1]['items']),1)
        self.assertEqual(edit['items'][0]['id'],obj['id'])

    def test_paginated_table_continuations_get_fresh_obstacle_fields(self):
        from mdwnfr.tables import table
        doc=new_document('Tall table',font_size_pt=16)
        frame=table(rows=24,columns=1)
        for row in frame['rows']:
            row[0]['items']=[word(['𓅓']) for _ in range(3)]
        doc['items']=[frame]+[word(['𓈖']) for _ in range(24)]
        result=layout_document(doc)
        fragments=[(page['index'],pl['id']) for page in result['pages']
            for col in page['columns'] if col['kind']=='table'
            for pl in col['placements']]
        self.assertGreater(len(fragments),1)
        self.assertTrue(all(ident==frame['id'] for _,ident in fragments))
        self.assertEqual(len(set(page for page,_ in fragments)),len(fragments))
        self.assertEqual(words_in_layout(result),
            [o['id'] for o in doc['items'] if o['type']=='word'])

    def test_object_does_not_force_blank_preceding_column(self):
        """After word 776, object 777 may float beside the same text column.

        Later words must use its legally available lower space rather than
        starting a new column just because an object was inserted.
        """
        for direction in ('ltr','rtl'):
            for surface in ('A3','A4'):
                with self.subTest(direction=direction,surface=surface):
                    doc=new_document('No reserved image channel',
                        direction=direction,surface=surface,font_size_pt=10)
                    before=[word(['𓏺']) for _ in range(6)]
                    bird=clipart('horus-falcon-raster',60,'normal')
                    bird['y_align']=.25
                    following=[word(['𓏺']) for _ in range(180)]
                    doc['items']=[*before,bird,*following]
                    result=layout_document(doc)
                    byid={pl['id']:pl for pg in result['pages']
                        for col in pg['columns'] for pl in col['placements']}
                    final_before=byid[before[-1]['id']]
                    first_after=byid[following[0]['id']]
                    self.assertAlmostEqual(first_after['x'],final_before['x'],
                        places=4,msg='Image may not close its preceding text lane')
                    self.assertGreater(first_after['y'],final_before['y'],
                        'Following text must resume after earlier words')
                    self.assertEqual(words_in_layout(result),
                        [item['id'] for item in doc['items'] if item['type']=='word'])
                    self.assertEqual(ids_in_layout(result).count(bird['id']),1)

    def test_contour_reclaims_all_available_top_and_bottom_slots(self):
        """A float must never reserve entire columns above or below the ink."""
        for direction in ('rtl','ltr'):
            for before_count in (6,150,320):
                with self.subTest(direction=direction,before_count=before_count):
                    doc=new_document('Dense Horus flow',direction=direction,
                                     surface='A3',font_size_pt=10)
                    bird=clipart('horus-falcon-raster',60,'normal')
                    bird['y_align']=.25
                    before=[word(['𓅓','𓏏','𓈖']) for _ in range(before_count)]
                    after=[word(['𓅓','𓏏','𓈖']) for _ in range(720)]
                    doc['items']=[*before,bird,*after]
                    page=layout_document(doc)['pages'][0]
                    image=next(p for c in page['columns'] if c['kind']=='clipart'
                               for p in c['placements'])
                    w=layout_document(doc)['column_width_mm']
                    bottom=page['height']-18
                    near=[c for c in page['columns'] if c['kind']=='words'
                          and c['placements'] and c['x']<image['x']+image['width_mm']
                          and c['x']+w>image['x']]
                    self.assertGreaterEqual(len(near),3)
                    lower=[c for c in near if any(
                        p['y']>image['y']+image['height']+w/4
                        for p in c['placements'])]
                    self.assertGreaterEqual(len(lower),2,
                         'Dense following words must reclaim more than one column below Horus')
                    upper=[c for c in near if any(
                        p['y']+p['height']<image['y']-w/4
                        for p in c['placements'])]
                    self.assertGreaterEqual(len(upper),2,
                         'Available top sectors above the silhouette must receive quadrats')
                    self.assertEqual(words_in_layout(layout_document(doc)),
                                     [p['id'] for p in before+after])

    def test_papyrus_artwork_without_words_still_extends_canvas(self):
        doc=new_document('Only an image',surface='papyrus')
        bird=clipart('horus-falcon-raster',60,'normal')
        doc['items']=[bird]
        result=layout_document(doc)
        page=result['pages'][0]
        art=next(p for col in page['columns'] if col['kind']=='clipart'
                 for p in col['placements'])
        self.assertGreater(page['width'],art['width_mm']+result['margins_mm']['left'])
        self.assertLessEqual(art['x']+art['width_mm'],
                             page['width']-result['margins_mm']['right']+.01)
        self.assertEqual(len(page['columns']),1)
        self.assertEqual(page['columns'][0]['span'],0)

    def test_object_at_page_boundary_remains_with_continuation(self):
        # The object must not be appended to the previous full page after
        # a page change, just because an overlay consumes no flow columns.
        doc=new_document('Float across page transition',surface='A4',font_size_pt=10)
        first=[word(['𓅓','𓏏','𓈖']) for _ in range(400)]
        bird=clipart('horus-falcon-raster',120,'normal')
        last=[word(['𓏺']) for _ in range(100)]
        doc['items']=[*first,bird,*last]
        result=layout_document(doc)
        location={p['id']:page['index'] for page in result['pages']
                  for col in page['columns'] for p in col['placements']}
        self.assertLessEqual(location[first[-1]['id']],location[bird['id']])
        self.assertLessEqual(location[bird['id']],location[last[0]['id']])
        for page in result['pages']:
            for col in page['columns']:
                if col['kind']!='clipart':continue
                placement=col['placements'][0]
                self.assertGreaterEqual(placement['x'],0)
                self.assertLessEqual(placement['x']+placement['width_mm'],page['width']+.01)

    def test_image_does_not_reserve_empty_text_columns(self):
        doc=new_document('No slot reservation',direction='rtl',surface='A3')
        bird=clipart('horus-falcon-raster',60,'normal')
        bird['y_align']=.25
        doc['items']=[word(['𓅓','𓏏']) for _ in range(6)]+[bird]+[
            word(['𓅓','𓏏']) for _ in range(900)]
        result=layout_document(doc)
        page=next(page for page in result['pages']
             if any(col['kind']=='clipart' for col in page['columns']))
        self.assertFalse([col for col in page['columns']
            if col['kind']=='words' and not col['placements']],
            'A partial-height floating silhouette must not reserve blank columns')
        art=next(col for col in page['columns'] if col['kind']=='clipart')
        self.assertEqual(art['span'],0)

    def test_dense_short_words_use_image_columns_below_visible_ink(self):
        from mdwnfr.layout import object_clearance_mm
        for direction in ('ltr','rtl'):
            doc=new_document('Horus empty channel',direction=direction,font_size_pt=10)
            bird=clipart('horus-falcon-raster',60,'normal')
            bird['y_align']=.15
            doc['items']=[bird]+[word(['𓏺']) for _ in range(360)]
            result=layout_document(doc)
            art=next(pl for page in result['pages'] for col in page['columns']
                if col['kind']=='clipart' for pl in col['placements'])
            width=result['column_width_mm']
            below=[pl for page in result['pages'] for col in page['columns']
                if col['kind']=='words' for pl in col['placements']
                if pl['x'] < art['x']+art['width_mm']
                and pl['x']+width > art['x']
                and pl['y'] >= art['y']+art['height']+object_clearance_mm(width)-.001]
            self.assertTrue(below, 'Text must reclaim clear space below bird')

if __name__=='__main__':
    unittest.main()

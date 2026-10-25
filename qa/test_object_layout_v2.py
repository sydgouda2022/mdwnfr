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

    def test_paginated_table_continuations_get_fresh_obstacle_fields(self):
        from mdwnfr.tables import table
        doc=new_document('Tall table',font_size_pt=16)
        frame=table(rows=24,columns=1)
        for row in frame['rows']:
            row[0]['items']=[word(['𓅓']) for _ in range(3)]
        doc['items']=[frame,word(['𓈖']) for _ in range(24)]
        result=layout_document(doc)
        fragments=[(page['index'],pl['id']) for page in result['pages']
            for col in page['columns'] if col['kind']=='table'
            for pl in col['placements']]
        self.assertGreater(len(fragments),1)
        self.assertTrue(all(ident==frame['id'] for _,ident in fragments))
        self.assertEqual(len(set(page for page,_ in fragments)),len(fragments))
        self.assertEqual(words_in_layout(result),
            [o['id'] for o in doc['items'] if o['type']=='word'])

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

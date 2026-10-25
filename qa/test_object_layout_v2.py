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
    def make_doc(self,direction='rtl',surface='a3'):
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
                edited['surface']='a4'
                edited['revision']+=1
                a4=layout_document(edited)
                self.assertEqual([i['id'] for i in edited['items']],
                                 [i['id'] for i in doc['items'][30:-40]])
                self.assertEqual(words_in_layout(a4),
                    [i['id'] for i in edited['items'] if i['type']=='word'])
                self.assertEqual(ids_in_layout(a4).count(ident),1)
                self.assertNotEqual(a3['column_width_mm'],a4['column_width_mm'])

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

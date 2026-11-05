"""Verify that input, Python quadrat preview, editing and document identity agree."""
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'core'))
from mdwnfr.api import handle_json
from mdwnfr.document import new_document, transaction, assert_document, DocumentError
from copy import deepcopy
from mdwnfr.quadrat import compose, glyph_profiles
from mdwnfr.layout import layout_document
from mdwnfr.layout_sync import summarize_layout

class QuadratWorkflowTests(unittest.TestCase):
    def test_native_geometry_retains_sign_order(self):
        for spelling in [['𓅓','𓏏'],['𓅓','𓏏','𓈖'],['𓅓','𓏏','𓈖','𓂋','𓊪']]:
            shape=compose(spelling,20).payload()
            self.assertEqual(shape,compose(spelling,20).payload())
            self.assertEqual([x['sign'] for x in shape['signs']],spelling)
            self.assertGreater(shape['height'],0)
            for glyph in shape['signs']:
                self.assertGreater(glyph['width'],0)
                self.assertGreater(glyph['height'],0)
                self.assertGreaterEqual(glyph['x'],0)
                self.assertGreaterEqual(glyph['y'],0)
                self.assertLessEqual(glyph['x']+glyph['width'],20.00001)
                self.assertLessEqual(glyph['y']+glyph['height'],shape['height']+0.00001)

    def test_two_wide_signs_can_stack_vertically(self):
        profiles=glyph_profiles()
        wide=[s for s,p in profiles.items() if p['quadrat_class']=='wide']
        self.assertGreaterEqual(len(wide),2)
        shape=compose(wide[:2],20).payload()
        self.assertEqual(shape['rows'],[[0,1]])
        first,second=shape['signs']
        self.assertLess(first['y']+first['height'],second['y']+1e-7)
        self.assertAlmostEqual(first['x']+first['width']/2,10,places=5)
        self.assertAlmostEqual(second['x']+second['width']/2,10,places=5)

    def test_three_and_four_small_signs_use_compact_two_by_two_patterns(self):
        small=[s for s,p in glyph_profiles().items()
               if p['quadrat_class']=='small']
        self.assertGreaterEqual(len(small),4)
        for count in (3,4):
            with self.subTest(count=count):
                shape=compose(small[:count],20).payload()
                self.assertEqual(shape['rows'],[list(range(count))])
                boxes=shape['signs']
                self.assertGreater(max(b['y'] for b in boxes),
                                   min(b['y'] for b in boxes))
                self.assertTrue(all(b['x']>=0 and b['x']+b['width']<=20.00001
                                    for b in boxes))
                self.assertTrue(all(b['y']>=0 and
                                    b['y']+b['height']<=shape['height']+1e-5
                                    for b in boxes))
                for a_index,a in enumerate(boxes):
                    for b in boxes[a_index+1:]:
                        x_overlap=min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x'])
                        y_overlap=min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y'])
                        if x_overlap>0:
                            vertical_gap=max(b['y']-(a['y']+a['height']),
                                             a['y']-(b['y']+b['height']))
                            self.assertGreaterEqual(vertical_gap,0.999)
                        elif y_overlap>0:
                            horizontal_gap=max(b['x']-(a['x']+a['width']),
                                               a['x']-(b['x']+b['width']))
                            self.assertGreaterEqual(horizontal_gap,0.999)

    def test_navigation_preview_is_bounded_and_grounded_in_layout(self):
        doc=new_document('Geometry-driven pages')
        for idx in range(10):
            doc=transaction(doc,{'op':'insert_word','index':idx,
                'signs':['𓅓','𓏏']})
        full=layout_document(doc)
        summary=summarize_layout(full)
        self.assertEqual(len(summary['pages']),len(full['pages']))
        for page in summary['pages']:
            self.assertLessEqual(len(page['preview_columns']),64)
            self.assertTrue(all(0<=bar['x']<=1 and 0<=bar['y']<=1
                and 0<bar['w']<=1 and 0<bar['h']<=1
                for bar in page['preview_columns']))

    def test_malformed_imported_word_style_is_rejected(self):
        doc=transaction(new_document(),{'op':'insert_word','signs':['𓅓']})
        for field,value in [('color','#zzzzzz'),('color','red'),('bold','false'),
                            ('lexicon_ref',123)]:
            invalid=deepcopy(doc)
            invalid['items'][0][field]=value
            with self.subTest(field=field,value=value):
                with self.assertRaises(DocumentError):
                    assert_document(invalid)
        blank=deepcopy(doc);blank['items'][0]['id']=''
        with self.assertRaises(DocumentError):assert_document(blank)

    def test_nested_word_format_survives_text_replacement(self):
        original=transaction(new_document(),{'op':'insert_cartouche','words':[['𓅓']]})
        owner=deepcopy(original['items'][0]);owner['items'][0]['bold']=True
        owner['items'][0]['color']='#ac2533'
        owner['items'][0]['lexicon_ref']='tla:old'
        decorated=transaction(original,{'op':'replace_cartouche','id':owner['id'],'object':owner})
        changed=transaction(decorated,{'op':'set_cartouche_words','id':owner['id'],
                                      'words':[['𓈖']]})
        self.assertTrue(changed['items'][0]['items'][0]['bold'])
        self.assertEqual(changed['items'][0]['items'][0]['color'],'#ac2533')
        self.assertIsNone(changed['items'][0]['items'][0]['lexicon_ref'])

        original=transaction(new_document(),{'op':'insert_table','rows':2,'columns':2})
        owner=original['items'][0]
        filled=transaction(original,{'op':'set_table_cell','id':owner['id'],
                                    'row':0,'column':0,'words':[['𓅓']]})
        replacement=deepcopy(filled['items'][0])
        replacement['rows'][0][0]['items'][0]['bold']=True
        replacement['rows'][0][0]['items'][0]['color']='#ac2533'
        replacement['rows'][0][0]['items'][0]['lexicon_ref']='tla:old'
        decorated=transaction(filled,{'op':'replace_table','id':owner['id'],
                                      'object':replacement})
        changed=transaction(decorated,{'op':'set_table_cell','id':owner['id'],
                                      'row':0,'column':0,'words':[['𓈖']]})
        nested=changed['items'][0]['rows'][0][0]['items'][0]
        self.assertTrue(nested['bold'])
        self.assertEqual(nested['color'],'#ac2533')
        self.assertIsNone(nested['lexicon_ref'])

    def test_word_replacement_preserves_one_object_identity(self):
        doc=new_document('Keyboard flow test')
        first=transaction(doc,{'op':'insert_word','index':0,
            'signs':['𓅓','𓏏'],'lexicon_ref':'tla:1'})
        self.assertEqual(len(first['items']),1)
        ident=first['items'][0]['id']
        next_doc=transaction(first,{'op':'replace_signs','id':ident,
            'signs':['𓅓','𓈖'],'lexicon_ref':'tla:2'})
        self.assertEqual(len(next_doc['items']),1)
        self.assertEqual(next_doc['items'][0]['id'],ident)
        self.assertEqual(next_doc['items'][0]['signs'],['𓅓','𓈖'])
        self.assertEqual(next_doc['items'][0]['lexicon_ref'],'tla:2')
        self.assertEqual(first['items'][0]['signs'],['𓅓','𓏏'])


    def test_tall_narrow_and_low_broad_signs_stack_in_both_orders(self):
        profiles=glyph_profiles()
        tall=next(s for s,p in profiles.items()
                  if p['quadrat_class']=='tall')
        wide=next(s for s,p in profiles.items()
                  if p['quadrat_class']=='wide')
        for spelling in ([tall,wide],[wide,tall]):
            with self.subTest(spelling=spelling):
                shape=compose(list(spelling),20).payload()
                self.assertEqual(shape['rows'],[[0,1]])
                first,second=shape['signs']
                self.assertLess(first['y']+first['height'],second['y']+1e-7)
                self.assertAlmostEqual(first['x']+first['width']/2,10,places=5)
                self.assertAlmostEqual(second['x']+second['width']/2,10,places=5)
                for glyph in shape['signs']:
                    bounds=__import__('mdwnfr.quadrat',fromlist=['glyph_geometry']).glyph_geometry()[glyph['sign']]
                    ratio=(bounds[2]-bounds[0])/(bounds[3]-bounds[1])
                    self.assertAlmostEqual(glyph['width']/glyph['height'],ratio,places=5)
                    self.assertGreaterEqual(glyph['x'],0)
                    self.assertLessEqual(glyph['x']+glyph['width'],20.00001)
                    self.assertGreaterEqual(glyph['y'],0)
                    self.assertLessEqual(glyph['y']+glyph['height'],shape['height']+1e-5)

if __name__=='__main__':
    unittest.main()

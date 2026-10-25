"""Verify that input, Python quadrat preview, editing and document identity agree."""
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'core'))
from mdwnfr.api import handle_json
from mdwnfr.document import new_document, transaction
from mdwnfr.quadrat import compose

class QuadratWorkflowTests(unittest.TestCase):
    def test_native_geometry_matches_rpc_without_reordering(self):
        for spelling in [['𓅓','𓏏'],['𓅓','𓏏','𓈖'],['𓅓','𓏏','𓈖','𓂋','𓊪']]:
            response=json.loads(handle_json(json.dumps({
                'method':'compose','signs':spelling,'width':20
            },ensure_ascii=False)))
            self.assertTrue(response['ok'],response)
            shape=response['quadrat']
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

if __name__=='__main__':
    unittest.main()

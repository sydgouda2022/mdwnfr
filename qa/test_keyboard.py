"""The document/geometry core is lexicon-free; predictions belong to the separate API."""
import json, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'core'))
from mdwnfr.api import handle_json
from mdwnfr.document import new_document, transaction, DocumentError, validate_signs
from mdwnfr.quadrat import compose

class KeyboardBoundaryTests(unittest.TestCase):
    def test_document_retains_native_signs_and_reference(self):
        doc=new_document('Independent keyboard boundary')
        updated=transaction(doc,{'op':'insert_word','index':0,'signs':['𓅓','𓏏'],
                                 'lexicon_ref':'tla:lemma:1'})
        self.assertEqual(updated['items'][0]['signs'],['𓅓','𓏏'])
        self.assertEqual(updated['items'][0]['lexicon_ref'],'tla:lemma:1')
        self.assertTrue(compose(updated['items'][0]['signs'],20).payload())
    def test_no_shadow_python_dictionary_rpc(self):
        result=json.loads(handle_json(json.dumps({'method':'suggest','prefix':['𓅓']})))
        self.assertFalse(result['ok'])
        self.assertIn('Unknown RPC',result['error'])
    def test_renderable_signs_only(self):
        self.assertEqual(validate_signs(['𓅓']),['𓅓'])
        with self.assertRaises(DocumentError):validate_signs(['𖏠'])
    def test_document_is_a_separate_editable_entity(self):
        result=json.loads(handle_json(json.dumps({'method':'new','name':'Independent document'})))
        self.assertTrue(result['ok'])
        self.assertEqual(result['document']['revision'],0)

if __name__=='__main__': unittest.main()

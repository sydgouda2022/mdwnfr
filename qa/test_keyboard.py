"""Exercise real freshly built 41k MdwNfr word input and quadrat flow."""
from pathlib import Path
import hashlib,json,sys,time,unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'core'))
from mdwnfr.api import handle_json
from mdwnfr.document import new_document, transaction
from mdwnfr.lexicon import Lexicon,bundled_lexicon
from mdwnfr.quadrat import compose

class KeyboardCurrentTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.catalog=bundled_lexicon()
 def test_full_pinned_dictionary_loaded_by_python(self):
  info=json.loads(handle_json(json.dumps({'method':'lexicon_info'})))
  self.assertTrue(info['ok'])
  self.assertGreaterEqual(info['lexicon']['spelling_records'],40000)
  self.assertGreaterEqual(info['lexicon']['unique_native_surfaces'],40000)
  self.assertGreaterEqual(info['lexicon']['lexemes'],3100)
  self.assertFalse(info['lexicon']['complete'])
  core=(ROOT/'core/mdwnfr/data/lexicon.json').read_bytes()
  browser=(ROOT/'web/lexicon/lexicon.json').read_bytes()
  self.assertEqual(hashlib.sha256(core).hexdigest(),hashlib.sha256(browser).hexdigest())
  manifest=json.loads((ROOT/'web/lexicon/manifest.json').read_text())
  self.assertEqual(manifest['sha256'],hashlib.sha256(core).hexdigest())
  self.assertEqual(manifest['spelling_records'],len(self.catalog.entries))
 def test_exact_native_word_input_preserved(self):
  entry=next(e for e in self.catalog.entries
             if e.get('source')=='RAMSES-WORD-MODEL-2023' and 1<len(e['signs'])<8)
  word=entry['signs']
  out=self.catalog.candidates(list(word),limit=8)
  self.assertEqual(out['suggestions'][0]['signs'],list(word))
  self.assertEqual(out['suggestions'][0]['source'],'user')
  self.assertTrue(out['exact_attested'])
  self.assertFalse(any(''.join(x['signs'])==word for x in out['suggestions'][1:]))
 def test_ramses_model_references_are_explicitly_unlinked(self):
  rtc=[x for x in self.catalog.entries if x.get('source')=='RAMSES-WORD-MODEL-2023']
  self.assertGreaterEqual(len(rtc),30000)
  self.assertTrue(all(e.get('lexical_identity_verified') is False for e in rtc[:100]))
  self.assertTrue(all(e['ref'].startswith('ramses:') for e in rtc[:100]))
 def test_predicted_source_tiers_prefix_first_and_learning(self):
  idx=Lexicon({'format':'mdwnfr-predict-v1','metadata':{},'entries':[
   {'signs':'𓅓𓏏','ref':'tla:1','source':'TLA-LE19','attestations':8},
   {'signs':'𓅓𓈖','ref':'ramses:2','source':'RAMSES-WORD-MODEL-2023',
    'attestations':20,'lexical_identity_verified':False},
   {'signs':'𓏏𓅓','ref':'tla:3','source':'TLA-LE19'}]})
  r=idx.candidates(['𓅓'],limit=10)
  self.assertEqual(r['suggestions'][0]['source'],'user')
  self.assertEqual(r['suggestions'][1]['source_tier'],'lemma_linked')
  self.assertEqual(r['suggestions'][2]['source_tier'],'ramses_corpus')
  self.assertFalse(r['suggestions'][2]['lexical_identity_verified'])
  self.assertFalse(any(v['signs']==['𓏏','𓅓'] for v in r['suggestions'][1:]))
  fav=idx.candidates(['𓅓'],document_choices={'𓅓𓈖':200})
  self.assertEqual(fav['suggestions'][1]['source_tier'],'ramses_corpus')
  p=idx.candidates(['𓅓'],limit=2)
  q=idx.candidates(['𓅓'],offset=2,limit=4)
  self.assertEqual(len(p['suggestions'])+len(q['suggestions']),r['total'])
 def test_selected_ramses_word_preserves_signs_and_quadrat(self):
  entry=next(e for e in self.catalog.entries if
             e.get('source')=='RAMSES-WORD-MODEL-2023' and 1<len(e['signs'])<8)
  doc=new_document('MdwNfr source-aware keyboard')
  inserted=transaction(doc,{'op':'insert_word','index':0,'signs':list(entry['signs']),
                            'lexicon_ref':entry['ref']})
  self.assertEqual(len(inserted['items']),1)
  self.assertEqual(inserted['items'][0]['type'],'word')
  self.assertEqual(inserted['items'][0]['signs'],list(entry['signs']))
  self.assertEqual(inserted['items'][0]['lexicon_ref'],entry['ref'])
  self.assertTrue(compose(list(entry['signs']),20.0).payload())
 def test_rpc_rejects_transliteration(self):
  result=json.loads(handle_json(json.dumps({'method':'suggest','prefix':['nfr']})))
  self.assertFalse(result['ok'])
  self.assertTrue('hieroglyph' in result['error'].lower() or 'unicode codepoint' in result['error'].lower())
 def test_prediction_response_has_source_provenance(self):
  result=json.loads(handle_json(json.dumps({'method':'suggest','prefix':['𓅓'],'limit':8})))
  self.assertTrue(result['ok'])
  self.assertEqual(result['suggestions'][0]['source'],'user')
  self.assertEqual(result['dictionary_spelling_records'],len(self.catalog.entries))
  self.assertTrue(any(x.get('lexicon_ref') for x in result['suggestions'][1:]))
 def test_prefix_search_regression_bound(self):
  self.catalog.candidates(['𓅓'],limit=8)
  start=time.monotonic()
  for _ in range(3):self.catalog.candidates(['𓅓','𓏏'],limit=8)
  self.assertLess(time.monotonic()-start,6.0)

if __name__=='__main__':unittest.main()

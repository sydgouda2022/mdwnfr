"""MdwNfr document and headless-keyboard integration contract tests.

Prediction ranking belongs exclusively to the independent keyboard library.
This Python editor validates, retains, and lays out Unicode spellings; it
neither loads a second lexicon nor implements competing predictions.
"""
from pathlib import Path
import hashlib
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'core'))
from mdwnfr.api import handle_json
from mdwnfr.document import DocumentError, new_document, transaction, validate_signs
from mdwnfr.quadrat import compose, glyph_geometry


class KeyboardConsumerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (ROOT / 'web/lexicon/lexicon.json').read_bytes()
        cls.catalog = json.loads(cls.raw)
        cls.manifest = json.loads((ROOT / 'web/lexicon/manifest.json').read_text())
        cls.lock = json.loads((ROOT / 'keyboard-lock.json').read_text())

    def test_single_pinned_browser_lexicon(self):
        expected = self.lock['dependencies']['hieroglyphic-keyboard']['lexicon_sha256']
        self.assertEqual(self.manifest['sha256'], expected)
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), expected)
        self.assertGreaterEqual(len(self.catalog['entries']), 40000)
        self.assertEqual(self.manifest['spelling_records'], len(self.catalog['entries']))
        self.assertFalse(self.catalog['metadata']['complete'])

    def test_ramses_provenance_is_not_fabricated(self):
        rows = [x for x in self.catalog['entries'] if x.get('source') == 'RAMSES-WORD-MODEL-2023']
        self.assertGreaterEqual(len(rows), 30000)
        self.assertTrue(all(x.get('lexical_identity_verified') is False for x in rows[:100]))

    def test_document_retains_native_unicode_and_source_reference(self):
        entry = next(x for x in self.catalog['entries']
                     if x.get('source') == 'RAMSES-WORD-MODEL-2023'
                     and 1 < len(x['signs']) < 8)
        signs = list(entry['signs'])
        doc = new_document('Keyboard consumer')
        updated = transaction(doc, {'op':'insert_word', 'index':0, 'signs':signs,
                                    'lexicon_ref':entry['ref']})
        self.assertEqual(updated['items'][0]['signs'], signs)
        self.assertEqual(updated['items'][0]['lexicon_ref'], entry['ref'])
        self.assertTrue(compose(signs, 20.0).payload()['signs'])

    def test_python_does_not_duplicate_the_keyboard_api(self):
        for method in ('suggest', 'lexicon_info'):
            result = json.loads(handle_json(json.dumps({'method':method})))
            self.assertFalse(result['ok'])
            self.assertIn('Unknown RPC', result['error'])

    def test_reject_transliteration_and_unsupported_unicode(self):
        for sign in ('nfr', chr(0x13460)):
            with self.subTest(sign=sign):
                with self.assertRaises(DocumentError):
                    validate_signs([sign])

    def test_supported_font_outlines_can_be_composed(self):
        outlines = glyph_geometry()
        self.assertEqual(len(outlines), 1072)
        for sign in ('𓅓', '𓇋', '𓏏'):
            self.assertIn(sign, outlines)
            self.assertEqual(validate_signs([sign]), [sign])


if __name__ == '__main__':
    unittest.main()

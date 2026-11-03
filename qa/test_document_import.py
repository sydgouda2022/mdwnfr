import unittest
from mdwnfr.api import handle
from mdwnfr.document import new_document, word

class ImportDocumentTests(unittest.TestCase):
    def test_import_is_validated_and_uses_new_document_id(self):
        original=new_document("Travel Journal")
        original["items"]=[word(["𓅓","𓏏"])]
        imported=handle({"method":"import_document","document":original})["document"]
        self.assertNotEqual(imported["id"],original["id"])
        self.assertEqual(imported["revision"],0)
        self.assertEqual(imported["items"],original["items"])
        self.assertIn("(imported)",imported["name"])

    def test_import_rejects_old_or_missing_schema(self):
        doc=new_document()
        doc.pop("margins_mm")
        with self.assertRaises(ValueError):
            handle({"method":"import_document","document":doc})
        doc=new_document()
        doc["schema"]=0
        with self.assertRaises(ValueError):
            handle({"method":"import_document","document":doc})

if __name__=="__main__":
    unittest.main()

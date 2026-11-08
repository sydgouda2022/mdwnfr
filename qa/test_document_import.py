import unittest
from mdwnfr.api import handle
from mdwnfr.document import new_document, word, validate_word_record, transaction

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

    def test_overlay_groups_use_adjacent_persistent_symbol_ids(self):
        item=word(["𓂝","𓎛"])
        doc=new_document()
        doc["items"]=[item]
        updated=transaction(doc,{"op":"set_word_overlays","id":item["id"],
            "overlays":[{"symbols":item["symbol_ids"],"front":item["symbol_ids"][1]}]})
        self.assertEqual(updated["items"][0]["overlays"][0]["front"],item["symbol_ids"][1])
        validate_word_record(updated["items"][0])

    def test_disjoint_overlay_groups_survive_document_import(self):
        item=word(["𓂝","𓎛","𓂝","𓎛"])
        doc=new_document(direction="ltr")
        doc["items"]=[item]
        edited=transaction(doc,{"op":"set_word_overlays","id":item["id"],
            "overlays":[
                {"symbols":item["symbol_ids"][0:2],"front":item["symbol_ids"][1]},
                {"symbols":item["symbol_ids"][2:4],"front":item["symbol_ids"][2]},
            ]})
        imported=handle({"method":"import_document","document":edited})["document"]
        restored=imported["items"][0]
        self.assertEqual(imported["direction"],"ltr")
        self.assertEqual(restored["symbol_ids"],item["symbol_ids"])
        self.assertEqual(restored["overlays"],edited["items"][0]["overlays"])
        validate_word_record(restored)

    def test_overlay_groups_reject_nonadjacent_symbols(self):
        item=word(["𓂝","𓎛","𓀀"])
        doc=new_document()
        doc["items"]=[item]
        with self.assertRaises(ValueError):
            transaction(doc,{"op":"set_word_overlays","id":item["id"],
                "overlays":[{"symbols":[item["symbol_ids"][0],item["symbol_ids"][2]],
                             "front":item["symbol_ids"][0]}]})

if __name__=="__main__":
    unittest.main()

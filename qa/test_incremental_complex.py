"""Compare safe mixed-document reuse against the full-layout oracle."""
import unittest
from copy import deepcopy
from mdwnfr.document import new_document, word, clipart
from mdwnfr.layout import layout_document, incremental_layout_document

class IllustratedIncrementalTests(unittest.TestCase):
    def test_unchanged_completed_word_pages_can_be_reused(self):
        before=new_document('Safe illustrated prefix',font_size_pt=48)
        before['items']=[word(['𓅓','𓏏']) for _ in range(260)]
        before['items'].append(clipart('bennu',80,'normal'))
        before['items'].append(word(['𓈖']))
        old=layout_document(before)
        after=deepcopy(before)
        after['revision']=before['revision']+1
        after['items'].append(word(['𓂋']))
        actual,stats=incremental_layout_document(after,before,old)
        expected=layout_document(after)
        self.assertEqual(actual,expected,'Incremental layout must match full geometry and word order')
        self.assertIn(stats['mode'],('incremental_safe_pages','full_silhouette'))
        if len(old['pages'])>2:
            self.assertGreater(stats['reused_prefix_columns'],0)

if __name__=='__main__':
    unittest.main()

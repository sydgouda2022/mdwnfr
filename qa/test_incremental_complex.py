"""Object-layout source order is stable, including illustrated reflow."""
import unittest
from copy import deepcopy
from mdwnfr.document import new_document, word, clipart
from mdwnfr.layout import layout_document, incremental_layout_document

class IllustratedReflowTests(unittest.TestCase):
    def test_modified_stream_is_recomputed_consistently(self):
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
        self.assertEqual(actual,expected,'Revisioned object layout must match full geometry and word order')
        self.assertEqual(stats['mode'],'object_stream')
        self.assertEqual([i['id'] for i in after['items']], [i['id'] for i in before['items']]
                         + [after['items'][-1]['id']])

if __name__=='__main__':
    unittest.main()

"""Regression coverage for atomic table changes and applied border styling."""
import unittest
from copy import deepcopy
from mdwnfr.document import new_document, transaction
from mdwnfr.tables import table
from mdwnfr.layout import layout_document


class AtomicTableSpecification(unittest.TestCase):
    def setUp(self):
        self.doc=new_document('table spec atomic',direction='rtl',surface='A3')
        self.table=table(2,2)
        self.doc['items']=[self.table]

    def test_atomic_structure_preserves_overlapping_cells_and_nested_words(self):
        before=[[cell['id'] for cell in row] for row in self.table['rows']]
        doc=transaction(self.doc,{'op':'set_table_cell','id':self.table['id'],
            'row':1,'column':1,'mode':'text','words':[['𓇋','𓅓']]})
        existing=doc['items'][0]['rows'][1][1]['items'][0]['id']
        action={'op':'set_table_spec','id':self.table['id'],'rows':3,'columns':4,
            'style':{'border_style':'dashed','border_color':'#217acc',
                     'border_width_mm':1.0,'cell_padding_mm':2}}
        doc=transaction(doc,action)
        t=doc['items'][0]
        self.assertEqual((len(t['rows']),len(t['rows'][0])),(3,4))
        for row in range(2):
            for column in range(2):
                self.assertEqual(t['rows'][row][column]['id'],before[row][column])
        self.assertEqual(t['rows'][1][1]['items'][0]['id'],existing)
        self.assertEqual(t['style'],action['style'])
        self.assertEqual(len({cell['id'] for row in t['rows'] for cell in row}),12)

        geometry=next(p['table'] for page in layout_document(doc)['pages']
            for column in page['columns'] if column['kind']=='table'
            for p in column['placements'])
        self.assertEqual(geometry['border_style'],'dashed')
        self.assertEqual(geometry['border_color'],'#217acc')
        self.assertEqual(geometry['border_width_mm'],1)
        self.assertEqual(geometry['cell_padding_mm'],2)

    def test_shrinking_preserves_surviving_cell_ids(self):
        grown=transaction(self.doc,{'op':'set_table_spec','id':self.table['id'],
            'rows':4,'columns':5})
        survivor=grown['items'][0]['rows'][0][0]['id']
        shrunk=transaction(grown,{'op':'set_table_spec','id':self.table['id'],
            'rows':1,'columns':1})
        self.assertEqual(shrunk['items'][0]['rows'][0][0]['id'],survivor)

    def test_invalid_spec_does_not_change_document(self):
        baseline=deepcopy(self.doc)
        for rows,cols in [(0,2),(2,13),(25,2),(2,1.5),('3',2)]:
            with self.subTest(rows=rows,cols=cols):
                with self.assertRaises(ValueError):
                    transaction(self.doc,{'op':'set_table_spec',
                        'id':self.table['id'],'rows':rows,'columns':cols})
                self.assertEqual(self.doc,baseline)
        with self.assertRaises(ValueError):
            transaction(self.doc,{'op':'set_table_spec','id':self.table['id'],
                'rows':3,'columns':4,'style':{'border_color':'javascript:bad'}})
        self.assertEqual(self.doc,baseline)


if __name__=='__main__':
    unittest.main()

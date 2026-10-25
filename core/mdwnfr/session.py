"""Persistent document session; the browser only mirrors server-authorized changes.

The Python worker owns the current document and history. The public protocol
returns *deltas* rather than full documents after each edit; this matters for
100k+ word documents, where repeatedly transferring all items is wasteful.
"""
from __future__ import annotations
from .document import assert_document, transaction, RevisionConflict, validated_margins
from .history import recorded_transaction

HISTORY_LIMIT = 200

class DocumentSession:
    def __init__(self):
        self.document = None
        self.undo = []
        self.redo = []

    def open(self, document):
        assert_document(document)
        self.document = document
        self.undo.clear(); self.redo.clear()
        return self._receipt(None)

    def _receipt(self, change):
        d = self.document
        return {'document_id':d['id'], 'revision':d['revision'], 'change':change,
                'undo_available':bool(self.undo), 'redo_available':bool(self.redo)}

    def edit(self, action):
        if self.document is None:
            raise ValueError('Open a document before editing')
        base = action.get('base_revision', self.document['revision'])
        if base != self.document['revision']:
            raise RevisionConflict(f"Expected revision {base}; current {self.document['revision']}")
        before = self.document
        record = recorded_transaction(before, action)
        after = record['document']
        # Commit only after the entire transaction has passed validation.
        change = self._difference(before, after, action)
        self.document = after
        self.undo.append({'undo': record['undo'], 'redo': record['redo']})
        if len(self.undo) > HISTORY_LIMIT:
            self.undo.pop(0)
        self.redo.clear()
        return self._receipt(change)

    def history(self, direction):
        if direction not in ('undo','redo'):
            raise ValueError('Invalid history direction')
        stack = self.undo if direction=='undo' else self.redo
        if not stack:
            raise ValueError('No history operation is available')
        before = self.document
        entry = stack[-1]
        after = transaction(before,entry[direction])
        change = self._difference(before,after,entry[direction])
        stack.pop()
        (self.redo if direction=='undo' else self.undo).append(entry)
        self.document = after
        return self._receipt(change)

    @staticmethod
    def _difference(before, after, action):
        op = action['op']
        if op == 'set_document':
            props={key:after[key]
                   for key in ('name','direction','surface','font_size_pt','papyrus_height_mm')
                   if before[key] != after[key]}
            if validated_margins(before) != validated_margins(after):
                props['margins_mm'] = validated_margins(after)
            return {'kind':'properties','properties':props}
        if op == 'set_styles':
            by_id = {item['id']: (i,item) for i,item in enumerate(after['items'])}
            return {'kind':'update','updates':[
                {'index':by_id[ch['id']][0],'object':by_id[ch['id']][1]} for ch in action['styles']]}
        if op in ('replace_signs','set_word_style','set_clipart','set_image',
                  'set_table_cell','table_insert_row','table_delete_row',
                  'table_insert_column','table_delete_column','set_table_width','replace_table',
                  'set_cartouche_orientation','set_cartouche_words','replace_cartouche',
                  'set_nested_position'):
            index = next(i for i,item in enumerate(after['items']) if item['id']==action['id'])
            return {'kind':'update','updates':[{'index':index,'object':after['items'][index]}]}
        if op in ('relocate_clipart','relocate_image','relocate_nested'):
            src = next(i for i,item in enumerate(before['items']) if item['id']==action['id'])
            dest = next(i for i,item in enumerate(after['items']) if item['id']==action['id'])
            return {'kind':'relocate','from_index':src,'to_index':dest,
                    'object_id':action['id'],'object':after['items'][dest]}
        if op == 'move':
            prior = next(i for i,item in enumerate(before['items']) if item['id']==action['id'])
            dest = next(i for i,item in enumerate(after['items']) if item['id']==action['id'])
            return {'kind':'move','from_index':prior,'to_index':dest,'object_id':action['id']}
        if op in ('splice','insert_word','insert_existing','insert_clipart','insert_image','insert_table','insert_cartouche','delete'):
            if op == 'splice':
                index,count = action['index'],action['delete_count']
                added = len(action.get('objects',[]))
            elif op in ('insert_word','insert_existing','insert_clipart','insert_image','insert_table','insert_cartouche'):
                index,count,added = action.get('index',len(before['items'])),0,1
            else:
                index=next(i for i,item in enumerate(before['items']) if item['id']==action['id'])
                count,added=1,0
            return {'kind':'splice','index':index,'delete_count':count,
                    'objects':after['items'][index:index+added]}
        raise ValueError('No delta encoder for '+op)

"""Reversible document-command patches, independent of presentation/layout.

History entries contain only the affected object's data (or changed document
properties); there are no full-document snapshots for ordinary edits. The
browser keeps session stacks, while Python alone validates and applies edits.
"""
from __future__ import annotations
from copy import deepcopy
from .document import transaction, validated_margins

DOCUMENT_PROPERTIES = ('name', 'direction', 'surface', 'font_size_pt', 'papyrus_height_mm', 'margins_mm')


def recorded_transaction(document: dict, action: dict) -> dict:
    """Return an atomic committed document and stable reversible commands.

    Redo of an insertion restores the same object ID rather than generating
    a new one. Replay actions intentionally omit base_revision; transaction()
    checks against the actual current revision at replay time.
    """
    op = action.get('op')
    before = document['items']
    new = transaction(document, action)
    after = new['items']
    if op == 'splice':
        index = action['index']
        # Object records are copy-on-write in transaction(). Keep references to
        # untouched immutable versions instead of deep-copying 100,000 records
        # into the undo and redo stacks. Replay itself copies on insertion.
        removed = before[index:index + action['delete_count']]
        inserted = after[index:index + len(action.get('objects', []))]
        undo = {'op':'splice','index':index,'delete_count':len(inserted),
                'objects':removed,'fresh_ids':False}
        redo = {'op':'splice','index':index,'delete_count':len(removed),
                'objects':inserted,'fresh_ids':False}
    elif op == 'set_styles':
        ids = {change['id'] for change in action['styles']}
        original = {item['id']:item for item in before if item['id'] in ids}
        final = {item['id']:item for item in after if item['id'] in ids}
        undo = {'op':'set_styles','styles':[{'id':ident,'color':original[ident]['color'],
                                          'bold':original[ident]['bold']} for ident in sorted(ids)]}
        redo = {'op':'set_styles','styles':[{'id':ident,'color':final[ident]['color'],
                                          'bold':final[ident]['bold']} for ident in sorted(ids)]}
    elif op in ('insert_word', 'insert_existing', 'insert_clipart', 'insert_image','insert_table','insert_cartouche'):
        index = action.get('index', len(before))
        obj = deepcopy(after[index])
        undo = {'op':'delete', 'id':obj['id']}
        redo = {'op':'insert_existing', 'index':index, 'object':obj}
    elif op == 'delete':
        index = next(i for i,item in enumerate(before) if item['id'] == action['id'])
        obj = deepcopy(before[index])
        undo = {'op':'insert_existing','index':index,'object':obj}
        redo = {'op':'delete','id':obj['id']}
    elif op == 'move':
        prior = next(i for i,item in enumerate(before) if item['id'] == action['id'])
        undo = {'op':'move','id':action['id'],'index':prior}
        redo = {'op':'move','id':action['id'],'index':action['index']}
    elif op == 'replace_signs':
        old = next(item for item in before if item['id'] == action['id'])
        updated = next(item for item in after if item['id'] == action['id'])
        undo = {'op':'replace_signs','id':action['id'],'signs':deepcopy(old['signs']),
                'lexicon_ref':old.get('lexicon_ref')}
        redo = {'op':'replace_signs','id':action['id'],'signs':deepcopy(updated['signs']),
                'lexicon_ref':updated.get('lexicon_ref')}
    elif op == 'set_word_style':
        old = next(item for item in before if item['id'] == action['id'])
        updated = next(item for item in after if item['id'] == action['id'])
        undo = {'op':'set_word_style','id':action['id'],'color':old['color'],'bold':old['bold']}
        redo = {'op':'set_word_style','id':action['id'],'color':updated['color'],'bold':updated['bold']}
    elif op == 'set_nested_position':
        old = next(item for item in before if item['id']==action['id'])
        updated = next(item for item in after if item['id']==action['id'])
        undo={'op':op,'id':action['id'],'x_align':old.get('x_align',0.0),
              'y_align':old.get('y_align',0.0),'x_offset_mm':old.get('x_offset_mm',0.0)}
        redo={'op':op,'id':action['id'],'x_align':updated.get('x_align',0.0),
              'y_align':updated.get('y_align',0.0),'x_offset_mm':updated.get('x_offset_mm',0.0)}
    elif op == 'relocate_nested':
        prior=next(i for i,item in enumerate(before) if item['id']==action['id'])
        dest=next(i for i,item in enumerate(after) if item['id']==action['id'])
        old=before[prior]; updated=after[dest]
        undo={'op':op,'id':action['id'],'index':prior,
              'x_align':old.get('x_align',0.0),'y_align':old.get('y_align',0.0),
              'x_offset_mm':old.get('x_offset_mm',0.0)}
        redo={'op':op,'id':action['id'],'index':dest,
              'x_align':updated.get('x_align',0.0),'y_align':updated.get('y_align',0.0),
              'x_offset_mm':updated.get('x_offset_mm',0.0)}
    elif op in ('set_clipart','set_image'):
        old = next(item for item in before if item['id'] == action['id'])
        updated = next(item for item in after if item['id'] == action['id'])
        undo = {'op':op, 'id':old['id'], 'width_mm':old['width_mm'], 'flip':old['flip'],
                'x_align':old.get('x_align',0.5), 'y_align':old.get('y_align',0.5),
                'x_offset_mm':old.get('x_offset_mm',0.0)}
        redo = {'op':op, 'id':updated['id'], 'width_mm':updated['width_mm'], 'flip':updated['flip'],
                'x_align':updated.get('x_align',0.5), 'y_align':updated.get('y_align',0.5),
                'x_offset_mm':updated.get('x_offset_mm',0.0)}
    elif op in ('relocate_clipart','relocate_image'):
        prior = next(i for i,obj in enumerate(before) if obj['id']==action['id'])
        dest = next(i for i,obj in enumerate(after) if obj['id']==action['id'])
        original, updated = before[prior], after[dest]
        undo = {'op':op,'id':action['id'],'index':prior,
                'x_align':original.get('x_align',0.5),'y_align':original.get('y_align',0.5),
                'x_offset_mm':original.get('x_offset_mm',0.0)}
        redo = {'op':op,'id':action['id'],'index':dest,
                'x_align':updated.get('x_align',0.5),'y_align':updated.get('y_align',0.5),
                'x_offset_mm':updated.get('x_offset_mm',0.0)}
    elif op in ('set_table_cell','table_insert_row','table_delete_row',
                'table_insert_column','table_delete_column','set_table_width','replace_table'):
        old = next(item for item in before if item['id']==action['id'])
        updated = next(item for item in after if item['id']==action['id'])
        undo={'op':'replace_table','id':old['id'],'object':old}
        redo={'op':'replace_table','id':updated['id'],'object':updated}
    elif op in ('set_cartouche_orientation','set_cartouche_words','replace_cartouche'):
        old=next(item for item in before if item['id']==action['id'])
        updated=next(item for item in after if item['id']==action['id'])
        undo={'op':'replace_cartouche','id':old['id'],'object':deepcopy(old)}
        redo={'op':'replace_cartouche','id':updated['id'],'object':deepcopy(updated)}
    elif op == 'set_document':
        keys = [key for key in DOCUMENT_PROPERTIES if key in action]
        undo = {'op':'set_document',**{key:(validated_margins(document) if key == 'margins_mm' else document[key]) for key in keys}}
        redo = {'op':'set_document',**{key:new[key] for key in keys}}
    else:
        raise AssertionError('The document transaction accepted a command without a history inverse')
    return {'document':new,'undo':undo,'redo':redo}

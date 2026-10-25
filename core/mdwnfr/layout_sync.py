"""Revisioned document mirror owned by the Python layout worker.

The editing worker alone creates document transactions. This module *replays*
its canonical deltas into a shadow stream for layout; it cannot make user edits
or generate object identities. A full document is transferred only at open or
when recovering a missing revision. One batch produces one coherent snapshot.
"""
from __future__ import annotations
from .document import assert_document, DocumentError, MAX_ATOMIC_OBJECTS
from .layout import LayoutSession, expand_compact_page, expand_compact_layout


def summarize_layout(snapshot: dict) -> dict:
    """Small, read-only navigation projection; never copies sign/word geometry."""
    pages = []
    next_index = 0
    for page in snapshot["pages"]:
        # Continuation fragments share their original table ID; they are one
        # logical document object even though multiple pages display them.
        count = sum(len(column["placements"]) for column in page["columns"]
                    if not (column.get('kind')=='table' and
                            column.get('table_fragment_index',0)>0))
        word_count = sum(len(column["placements"]) for column in page["columns"]
                         if column.get('kind','words') == 'words')
        summary = {"index": page["index"], "width": page["width"],
                   "height": page["height"], "column_count": len(page["columns"]),
                   "word_count": word_count, "object_count": count-word_count,
                   "start_index": next_index, "end_index": next_index + count}
        if snapshot['surface'] == 'papyrus':
            spans = [column.get('span', 1) for column in page['columns']]
            if any(span != 1 for span in spans):
                # This is only compact slot metadata, not detailed geometry.
                # The browser uses it to choose bounded viewport column ranges.
                summary['column_spans'] = spans
        pages.append(summary)
        next_index += count
    return {"document_id": snapshot["document_id"],
            "revision": snapshot["revision"], "surface": snapshot["surface"],
            "direction": snapshot["direction"],
            "column_width_mm": snapshot["column_width_mm"],
            "warnings": snapshot["warnings"], "pages": pages}


PROPERTY_KEYS = frozenset(('name', 'direction', 'surface', 'font_size_pt', 'papyrus_height_mm', 'margins_mm'))


class LayoutRevisionConflict(DocumentError):
    """The caller must reopen layout from a current authoritative snapshot."""


def _int(value):
    return type(value) is int


def _apply_delta_in_place(document: dict, change: dict, revision: int) -> None:
    """Validate and replay one canonical patch into an isolated working copy."""
    if not _int(revision) or revision != document['revision'] + 1:
        raise LayoutRevisionConflict('Noncontiguous layout revision')
    if not isinstance(change, dict):
        raise DocumentError('Missing canonical layout delta')
    kind = change.get('kind')
    if kind == 'properties':
        props = change.get('properties')
        if not isinstance(props, dict) or not set(props).issubset(PROPERTY_KEYS):
            raise DocumentError('Invalid layout property delta')
        document.update(props)
    else:
        items = document['items']
        if kind == 'splice':
            index, count, objects = change.get('index'), change.get('delete_count'), change.get('objects')
            if (not _int(index) or not _int(count) or index < 0 or count < 0
                    or index + count > len(items) or not isinstance(objects, list)
                    or len(objects) > MAX_ATOMIC_OBJECTS):
                raise DocumentError('Invalid layout splice delta')
            items[index:index+count] = objects
        elif kind == 'update':
            edits = change.get('updates')
            if not isinstance(edits, list) or not edits:
                raise DocumentError('Invalid layout update delta')
            seen = set()
            for edit in edits:
                if not isinstance(edit, dict):
                    raise DocumentError('Invalid layout update')
                index, obj = edit.get('index'), edit.get('object')
                if (not _int(index) or not 0 <= index < len(items)
                        or not isinstance(obj, dict) or items[index]['id'] != obj.get('id')
                        or index in seen):
                    raise DocumentError('Layout word identity mismatch')
                seen.add(index)
                items[index] = obj
        elif kind == 'relocate':
            src, dest, ident = change.get('from_index'), change.get('to_index'), change.get('object_id')
            obj = change.get('object')
            if (not _int(src) or not _int(dest) or not 0 <= src < len(items)
                    or not 0 <= dest < len(items) or items[src]['id'] != ident
                    or not isinstance(obj, dict) or obj.get('id') != ident or obj.get('type') not in ('clipart','image','table','cartouche')):
                raise DocumentError('Invalid graphical-object relocation delta')
            items.pop(src)
            items.insert(dest,obj)
        elif kind == 'move':
            src, dest, ident = change.get('from_index'), change.get('to_index'), change.get('object_id')
            if (not _int(src) or not _int(dest) or not 0 <= src < len(items)
                    or not 0 <= dest < len(items) or items[src]['id'] != ident):
                raise DocumentError('Layout move identity mismatch')
            obj = items.pop(src)
            items.insert(dest, obj)
        else:
            raise DocumentError('Unsupported canonical layout delta')
    document['revision'] = revision


def apply_canonical_delta(document: dict, change: dict, revision: int) -> dict:
    """Replay one delta immutably, preserving all permanent object IDs."""
    candidate = document.copy()
    candidate['items'] = document['items'].copy()
    _apply_delta_in_place(candidate, change, revision)
    assert_document(candidate)
    return candidate


class LayoutDocumentSession:
    """One document/layout snapshot per worker; strict revision-gap recovery."""
    def __init__(self):
        self.document = None
        self.layout_session = LayoutSession(compact=True)
        self._items_by_id = {}

    def open(self, document: dict, metrics: dict | None = None,
             summary_only: bool = False) -> dict:
        assert_document(document)
        # A new layout cache prevents another document's geometry being reused.
        next_session = LayoutSession(compact=True)
        snapshot, stats = next_session.calculate(document, metrics)
        self.document = document
        self.layout_session = next_session
        self._items_by_id = {obj["id"]: obj for obj in document["items"]}
        return {'document_id': document['id'], 'revision':document['revision'],
                'layout': summarize_layout(snapshot) if summary_only else
                expand_compact_layout(snapshot, self._items_by_id, metrics),
                'layout_stats':stats, 'sync_mode':'full_open'}

    def sync(self, document_id: str, base_revision: int, changes: list,
             metrics: dict | None = None, summary_only: bool = False) -> dict:
        current = self.document
        if current is None or current['id'] != document_id:
            raise LayoutRevisionConflict('Layout document mismatch; full reopen required')
        if not _int(base_revision) or base_revision != current['revision']:
            raise LayoutRevisionConflict('Layout revision gap; full reopen required')
        if not isinstance(changes, list) or len(changes) > 10000:
            raise DocumentError('Invalid layout delta batch')
        # Copy the stream only ONCE per batch, even if hundreds of edits are
        # coalesced while an expensive background layout is still running.
        candidate = current.copy()
        candidate['items'] = current['items'].copy()
        for patch in changes:
            if not isinstance(patch, dict) or patch.get('document_id') != document_id:
                raise LayoutRevisionConflict('Foreign document delta')
            if patch.get('base_revision') != candidate['revision']:
                raise LayoutRevisionConflict('Layout delta chain is not contiguous')
            _apply_delta_in_place(candidate, patch.get('change'), patch.get('revision'))
        assert_document(candidate)
        # Layout failure must not advance the mirrored session or revision.
        layout, stats = self.layout_session.calculate(candidate, metrics)
        self.document = candidate
        self._items_by_id = {obj["id"]: obj for obj in candidate["items"]}
        return {'document_id':document_id, 'revision':candidate['revision'],
                'layout':summarize_layout(layout) if summary_only else
                expand_compact_layout(layout, self._items_by_id, metrics),
                'layout_stats':stats,
                'sync_mode':'deltas' if changes else 'refresh', 'applied_deltas':len(changes)}

    def columns(self, document_id: str, revision: int, index: int,
                start: int, limit: int) -> dict:
        """Bounded page-column window for long papyrus and other large pages.

        This materializes ONLY the requested subset of retained column seeds.
        The invisible columns remain compact; no hidden full-page expansion.
        """
        doc = self.document
        snapshot = self.layout_session._layout
        if (doc is None or snapshot is None or doc['id'] != document_id
                or doc['revision'] != revision or snapshot['revision'] != revision):
            raise LayoutRevisionConflict('Column detail revision mismatch; refresh layout')
        if type(index) is not int or not 0 <= index < len(snapshot['pages']):
            raise DocumentError('Invalid page index')
        page = snapshot['pages'][index]
        count = len(page['columns'])
        if (type(start) is not int or type(limit) is not int or start < 0
                or start > count or not 1 <= limit <= 256):
            raise DocumentError('Invalid bounded column window')
        stop = min(count, start + limit)
        cols = page['columns'][start:stop]
        # Divider boundaries belong to the *completed* layout; never infer
        # them from the requested subset or reflow missing columns.
        if cols:
            left = min(c['x'] for c in cols)
            right = max(c['x'] + c['width'] for c in cols)
            dividers = [d for d in page['dividers'] if left-1e-8 <= d['x'] <= right+1e-8]
        else:
            dividers = []
        subpage = {'index': page['index'], 'width': page['width'],
                   'height': page['height'], 'columns': cols,
                   'dividers': dividers}
        return {'document_id': document_id, 'revision': revision, 'start': start,
                'end': stop, 'total_columns': count,
                'page': expand_compact_page(subpage, self._items_by_id,
                                            self.layout_session._metrics, width=snapshot['column_width_mm'],
                                            direction=doc['direction'],
                                            margins_mm=snapshot.get('margins_mm'),surface=snapshot.get('surface'))}

    def page(self, document_id: str, revision: int, index: int) -> dict:
        """Page geometry from the SAME committed snapshot; never retypeset."""
        doc = self.document
        snapshot = self.layout_session._layout
        if (doc is None or snapshot is None or doc["id"] != document_id
                or doc["revision"] != revision or snapshot["revision"] != revision):
            raise LayoutRevisionConflict("Page detail revision mismatch; refresh layout")
        if type(index) is not int or not 0 <= index < len(snapshot["pages"]):
            raise DocumentError("Invalid page index")
        return {"document_id": document_id, "revision": revision,
                "page": expand_compact_page(snapshot["pages"][index], self._items_by_id,
                                            self.layout_session._metrics, width=snapshot['column_width_mm'],
                                            direction=doc['direction'],
                                            margins_mm=snapshot.get('margins_mm'),surface=snapshot.get('surface'))}

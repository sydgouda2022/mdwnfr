"""JSON RPC boundary shared by native tests and browser Pyodide bridge."""
from __future__ import annotations
import json
from copy import deepcopy
from .document import new_document, transaction, assert_document, fresh_id
from .layout import LayoutSession
from .session import DocumentSession
from .layout_sync import LayoutDocumentSession


_layout_session = LayoutSession()
_document_session = DocumentSession()
_layout_document_session = LayoutDocumentSession()

def _discard_legacy_overlays(document: dict) -> None:
    """Drop obsolete overlap metadata when importing older saved documents."""
    def clean(items):
        for item in items:
            if item.get("type")=="word":
                item.pop("overlays",None)
            elif item.get("type")=="cartouche":
                clean(item.get("items",[]))
    clean(document.get("items",[]))


def handle(request: dict) -> dict:
    name=request.get("method")
    if name=="session_open":
        return _document_session.open(request["document"])
    if name=="session_edit":
        return _document_session.edit(request["action"])
    if name=="session_history":
        return _document_session.history(request["direction"])
    if name=="new":
        return {"document":new_document(request.get("name","Untitled"))}
    if name=="import_document":
        # Strict current-schema import: reuse the canonical document validator.
        incoming=request["document"]
        assert_document(incoming)
        restored=deepcopy(incoming)
        _discard_legacy_overlays(restored)
        restored["id"]=fresh_id()
        restored["revision"]=0
        restored["name"]=(incoming["name"][:109]+" (imported)")[:120]
        assert_document(restored)
        return {"document":restored}
    if name=="transact":
        return {"document":transaction(request["document"],request["action"])}
    if name=="layout_open":
        return _layout_document_session.open(request["document"], request.get("metrics"),
                                             request.get("summary_only", False))
    if name=="layout_sync":
        return _layout_document_session.sync(request["document_id"], request["base_revision"],
                                             request["changes"], request.get("metrics"),
                                             request.get("summary_only", False))
    if name=="layout_columns":
        return _layout_document_session.columns(request["document_id"],
            request["revision"], request["index"], request["start"], request["limit"])
    if name=="layout_page":
        return _layout_document_session.page(request["document_id"],
                                             request["revision"], request["index"])
    if name=="layout":
        layout, stats = _layout_session.calculate(request["document"], request.get("metrics"))
        return {"layout": layout, "layout_stats": stats}
    raise ValueError(f"Unknown RPC: {name}")


def handle_json(payload: str) -> str:
    try:
        return json.dumps({"ok":True,**handle(json.loads(payload))},ensure_ascii=False)
    except (KeyError, TypeError, ValueError) as exc:
        return json.dumps({"ok":False,"error":str(exc),"type":type(exc).__name__},ensure_ascii=False)

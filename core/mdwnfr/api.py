"""JSON RPC boundary shared by native tests and browser Pyodide bridge."""
from __future__ import annotations
import json
from .document import new_document, transaction, assert_document
from .layout import LayoutSession
from .lexicon import suggest, bundled_lexicon
from .quadrat import compose
from .history import recorded_transaction
from .session import DocumentSession
from .layout_sync import LayoutDocumentSession


_layout_session = LayoutSession()
_document_session = DocumentSession()
_layout_document_session = LayoutDocumentSession()

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
    if name=="transact":
        return {"document":transaction(request["document"],request["action"])}
    if name=="transact_recorded":
        return recorded_transaction(request["document"],request["action"])
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
    if name=="lexicon_info":
        return {"lexicon":bundled_lexicon().metadata}
    if name=="suggest":
        if "entries" in request:
            return {"suggestions":suggest(request["prefix"],request["entries"],
                                           request.get("global_choices"),request.get("document_choices"))}
        return bundled_lexicon().candidates(request["prefix"],
            personal_entries=request.get("personal_entries"),
            global_choices=request.get("global_choices"),
            document_choices=request.get("document_choices"),
            offset=request.get("offset",0),limit=request.get("limit",20))
    if name=="compose":
        return {"quadrat":compose(request["signs"],request["width"],request.get("metrics")).payload()}
    if name=="validate":
        assert_document(request["document"])
        return {"valid":True}
    raise ValueError(f"Unknown RPC: {name}")


def handle_json(payload: str) -> str:
    try:
        return json.dumps({"ok":True,**handle(json.loads(payload))},ensure_ascii=False)
    except (KeyError, TypeError, ValueError) as exc:
        return json.dumps({"ok":False,"error":str(exc),"type":type(exc).__name__},ensure_ascii=False)

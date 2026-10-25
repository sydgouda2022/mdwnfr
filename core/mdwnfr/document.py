"""Persistent *logical* document model and revisioned transactions.

No pages, columns, or pixel positions are stored here. Hieroglyphic Unicode
signs are copied into the document; no word requires a live dictionary entry.
"""
from __future__ import annotations
from typing import Any
from copy import deepcopy
from uuid import uuid4
from functools import lru_cache
from pathlib import Path
import json, math, re, base64, hashlib
from .tables import table, validate_table, cell_at, cell, MAX_ROWS, MAX_COLS, TableError
from .cartouches import validate_cartouche, MAX_CARTOUCHE_WORDS

SURFACES = {"A4": (297.0, 210.0), "A3": (420.0, 297.0), "A2": (594.0, 420.0)}
SUPPORTED = {"word", "table", "cartouche", "image", "clipart"}
# One clipboard operation may contain 100,000 complete words. The limit bounds
# accidental/untrusted payloads; it does not fragment a paste into 100k edits.
MAX_ATOMIC_OBJECTS = 150_000
DEFAULT_MARGINS_MM = {'top': 18.0, 'bottom': 18.0, 'left': 18.0, 'right': 18.0}

def validated_margins(doc: dict) -> dict[str, float]:
    """Four independent physical writing-frame borders. Old files use 18 mm.

    These are document properties, not coordinates on any rendered page.
    """
    raw = doc.get('margins_mm', DEFAULT_MARGINS_MM)
    if not isinstance(raw, dict) or set(raw) != set(DEFAULT_MARGINS_MM):
        raise DocumentError('All four page margins are required')
    margins = {}
    for edge in DEFAULT_MARGINS_MM:
        val = raw[edge]
        if type(val) not in (int, float) or not math.isfinite(val) or not 0 <= val <= 80:
            raise DocumentError('Invalid page margin: ' + edge)
        margins[edge] = float(val)
    if doc.get('surface') == 'papyrus':
        # A papyrus has no fixed far edge. Its physical length is the occupied
        # text width + two IDENTICAL end margins, so no page-width fitting or
        # independently adjusted trailing margin is meaningful. A legacy
        # papyrus with asymmetric margins is viewed with its original LEFT
        # margin on all sides; no saved source data is mutated by this getter.
        m = margins['left']
        margins = {edge: m for edge in DEFAULT_MARGINS_MM}
    height = (float(doc.get('papyrus_height_mm', 300)) if doc.get('surface') == 'papyrus'
              else SURFACES.get(doc.get('surface'), (0, 0))[1])
    if height - margins['top'] - margins['bottom'] <= 0:
        raise DocumentError('Margins leave no writable page height')
    if doc.get('surface') != 'papyrus':
        width = SURFACES.get(doc.get('surface'), (0, 0))[0]
        if width - margins['left'] - margins['right'] <= 0:
            raise DocumentError('Margins leave no writable page width')
    return margins

class DocumentError(ValueError):
    pass

class RevisionConflict(DocumentError):
    pass


@lru_cache(maxsize=1)
def artwork_catalog() -> dict:
    """Installed clip-art catalogue used directly by this engine."""
    path = Path(__file__).parent / 'data' / 'artwork_catalog.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('format') != 'mdwnfr-artwork-v1' or data.get('count') != len(data.get('artworks', [])):
        raise DocumentError('Invalid installed clip-art catalog')
    return {item['id']: item for item in data['artworks']}


def clipart(artwork_id: str, width_mm: float | None = None,
            flip: str = 'auto') -> dict:
    asset = artwork_catalog().get(artwork_id)
    if asset is None:
        raise DocumentError('Unknown clip-art identifier')
    if flip not in ('auto', 'normal', 'mirror'):
        raise DocumentError('Invalid clip-art flip mode')
    width = float(asset['default_width_mm'] if width_mm is None else width_mm)
    if not math.isfinite(width) or not 6 <= width <= 300:
        raise DocumentError('Clip-art width must be 6–300 mm')
    return {'id':fresh_id(), 'type':'clipart', 'artwork_id':artwork_id,
            'width_mm':width, 'flip':flip,
            'x_align':0.5, 'y_align':0.5, 'x_offset_mm':0.0}


def validate_clipart(item: dict) -> None:
    if item.get('artwork_id') not in artwork_catalog():
        raise DocumentError('Document references missing clip art')
    width = item.get('width_mm')
    if type(width) not in (int, float) or not math.isfinite(width) or not 6 <= width <= 300:
        raise DocumentError('Invalid clip-art width')
    if item.get('flip') not in ('auto', 'normal', 'mirror'):
        raise DocumentError('Invalid clip-art flip mode')
    for prop in ('x_align', 'y_align'):
        value = item.get(prop, 0.5)  # Pre-0.1.16 documents open centered.
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
            raise DocumentError('Invalid clip-art alignment: '+prop)
    xoff = item.get('x_offset_mm', 0.0)  # Older documents retain the original band alignment.
    if type(xoff) not in (int, float) or not math.isfinite(xoff) or not -2000 <= xoff <= 2000:
        raise DocumentError('Invalid clip-art horizontal offset')



# Portable user images are stored directly inside the document. An import is
# normalized to PNG by the browser; no OS path, blob URL, or remote resource is
# retained. Bound the byte count to prevent accidental multi-gigabyte saves.
MAX_IMAGE_BYTES = 8 * 1024 * 1024

def image(data_url: str, pixel_width: int, pixel_height: int, bands: list,
          width_mm: float = 65.0, name: str = 'Imported image', mask: str | None = None) -> dict:
    obj = {'id':fresh_id(), 'type':'image', 'data_url':data_url,
           'pixel_width':pixel_width, 'pixel_height':pixel_height,
           'bands':bands, 'mask':mask, 'name':name,
           'width_mm':width_mm, 'flip':'auto',
           'x_align':0.5,'y_align':0.5,'x_offset_mm':0.0}
    validate_image(obj)
    return obj

def validate_image(obj: dict) -> None:
    name=obj.get('name')
    if not isinstance(name,str) or not (1 <= len(name) <= 120) or any(ord(c)<32 for c in name):
        raise DocumentError('Invalid imported-image label')
    w,h=obj.get('pixel_width'),obj.get('pixel_height')
    if type(w) is not int or type(h) is not int or not (1<=w<=4096 and 1<=h<=4096 and w*h<=5_000_000):
        raise DocumentError('Invalid imported-image dimensions')
    data=obj.get('data_url')
    if not isinstance(data,str) or not data.startswith('data:image/png;base64,') or len(data)>11_200_000:
        raise DocumentError('User images must contain bounded embedded PNG data')
    encoded=data[len('data:image/png;base64,'):]
    try:
        binary=base64.b64decode(encoded,validate=True)
    except (ValueError,base64.binascii.Error):
        raise DocumentError('Invalid image encoding') from None
    if len(binary)>MAX_IMAGE_BYTES or len(binary)<24 or binary[:8]!=b'\x89PNG\r\n\x1a\n':
        raise DocumentError('Invalid image PNG data')
    if (int.from_bytes(binary[16:20],'big'),int.from_bytes(binary[20:24],'big'))!=(w,h):
        raise DocumentError('Image PNG dimensions disagree with object')
    bands=obj.get('bands')
    if not isinstance(bands,list) or len(bands)!=128:
        raise DocumentError('User image needs a 128-row opacity profile')
    for band in bands:
        if band is not None and (not isinstance(band,list) or len(band)!=2 or
             any(type(x) is not int for x in band) or not 0<=band[0]<band[1]<=10000):
            raise DocumentError('Invalid user-image silhouette band')
    # One canonical image format: 2D alpha mask is required.
    from .silhouette import validate_mask
    if not validate_mask(obj.get('mask')):
        raise DocumentError('Invalid imported image 2D silhouette mask')
    # All page placement values share the same semantics as existing artwork.
    width=obj.get('width_mm')
    if type(width) not in (int,float) or not math.isfinite(width) or not 6<=width<=300:
        raise DocumentError('Invalid image width')
    if obj.get('flip') not in ('auto','normal','mirror'):
        raise DocumentError('Invalid image orientation')
    for prop in ('x_align','y_align'):
        value=obj.get(prop,0.5)
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1:
            raise DocumentError('Invalid image alignment')
    offset=obj.get('x_offset_mm',0.0)
    if type(offset) not in (int,float) or not math.isfinite(offset) or not -2000<=offset<=2000:
        raise DocumentError('Invalid image horizontal float')


def fresh_id() -> str:
    return uuid4().hex


def validate_signs(signs: Any) -> list[str]:
    if not isinstance(signs, list) or not signs:
        raise DocumentError("A complete word requires one or more signs")
    if len(signs) > 256:
        raise DocumentError("Word exceeds the 256-sign safety limit")
    for sign in signs:
        if not isinstance(sign, str) or len(sign) != 1:
            raise DocumentError("Every sign must be exactly one Unicode codepoint")
        cp = ord(sign)
        if not (0x13000 <= cp <= 0x1342F or 0x13460 <= cp <= 0x143FF):
            raise DocumentError("Use Egyptian hieroglyph Unicode signs, not transliteration")
    return signs.copy()


def valid_name(name: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise DocumentError("Document name cannot be empty")
    clean = name.strip()
    if len(clean) > 120 or any(ord(c) < 32 for c in clean):
        raise DocumentError("Document name exceeds limits or contains control characters")
    return clean


def new_document(name: str = "Untitled", direction: str = "rtl",
                 surface: str = "A4", font_size_pt: float = 10.0) -> dict:
    if direction not in ("ltr", "rtl") or surface not in (*SURFACES, "papyrus"):
        raise DocumentError("Unsupported writing direction or writing surface")
    if not 6 <= float(font_size_pt) <= 72:
        raise DocumentError("Font size must be 6–72 pt")
    return {
        "schema": 1, "id": fresh_id(), "revision": 0, "name": valid_name(name),
        "direction": direction, "surface": surface, "font_size_pt": float(font_size_pt),
        "papyrus_height_mm": 300.0, "margins_mm": DEFAULT_MARGINS_MM.copy(), "items": []
    }


def word(signs: list[str], color: str = "#192433", bold: bool = False,
         lexicon_ref: str | None = None) -> dict:
    return {
        "id": fresh_id(), "type": "word", "signs": validate_signs(signs),
        "color": color, "bold": bool(bold), "lexicon_ref": lexicon_ref
    }


def validate_nested_position(obj: dict) -> None:
    """Layout preferences only; document objects never contain page coordinates.

    0 is the legacy top/leading alignment. A relative alignment is stable when
    the paper size or global typography changes.
    """
    offset = obj.get('x_offset_mm', 0.0)
    if type(offset) not in (int, float) or not math.isfinite(offset) or not -2000 <= offset <= 2000:
        raise DocumentError('Nested-object horizontal float must be −2000–2000 mm')
    for name in ('x_align', 'y_align'):
        value = obj.get(name, 0.0)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
            raise DocumentError('Invalid nested-object alignment: ' + name)


def cartouche(orientation: str = 'vertical', words: list[list[str]] | None = None) -> dict:
    if orientation not in ('vertical','horizontal'):
        raise DocumentError('Invalid cartouche orientation')
    words=words or []
    if len(words)>MAX_CARTOUCHE_WORDS:
        raise DocumentError('Too many cartouche words')
    obj={'id':fresh_id(),'type':'cartouche','orientation':orientation,
         'items':[word(validate_signs(s)) for s in words],
         'x_align':0.0,'y_align':0.0,'x_offset_mm':0.0}
    validate_cartouche(obj)
    validate_nested_position(obj)
    return obj


def validate_cartouche_word(item: dict) -> None:
    if item.get('type')!='word':raise DocumentError('Cartouches accept whole words only')
    validate_signs(item.get('signs'))


def assert_document(doc: dict) -> None:
    if doc.get("schema") != 1 or doc.get("direction") not in ("rtl", "ltr"):
        raise DocumentError("Invalid document schema")
    valid_name(doc.get("name"))
    validated_margins(doc)
    ids: set[str] = set()
    def check_stream(items: list) -> None:
        if not isinstance(items, list):
            raise DocumentError("Document stream must be an array")
        for obj in items:
            if not isinstance(obj, dict) or obj.get("type") not in SUPPORTED:
                raise DocumentError("Unknown document object")
            oid = obj.get("id")
            if not isinstance(oid, str) or oid in ids:
                raise DocumentError("Document objects need unique persistent IDs")
            ids.add(oid)
            if obj["type"] == "word":
                validate_signs(obj.get("signs"))
            elif obj["type"] == "clipart":
                validate_clipart(obj)
            elif obj["type"] == "image":
                validate_image(obj)
            elif obj["type"] == "cartouche":
                validate_cartouche(obj, validate_cartouche_word)
                validate_nested_position(obj)
                check_stream(obj['items'])
            elif obj["type"] == "table":
                validate_table(obj, check_stream)
                validate_nested_position(obj)
                for row in obj['rows']:
                    for entry in row:
                        if entry['id'] in ids:
                            raise DocumentError('Duplicate table cell identifier')
                        ids.add(entry['id'])
    check_stream(doc.get("items"))


def _locate(items: list[dict], obj_id: str) -> int:
    return next((i for i, item in enumerate(items) if item["id"] == obj_id), -1)


def _copy_object_with_new_ids(obj: dict) -> dict:
    """Duplicate a clipboard object and any nested content without reusing identities."""
    item = deepcopy(obj)
    def replace_ids(value: Any) -> None:
        if isinstance(value, list):
            for child in value: replace_ids(child)
        elif isinstance(value, dict):
            if value.get("type") in SUPPORTED or value.get('mode') in ('text','formula'):
                value["id"] = fresh_id()
            for child in value.values(): replace_ids(child)
    replace_ids(item)
    return item


def transaction(document: dict, action: dict) -> dict:
    """Apply one atomic edit to an isolated copy; never mutate the input.

    The caller provides base_revision to prevent stale UI transactions. Items
    retain stable IDs when edited/moved; their numeric indices may change.
    """
    assert_document(document)
    base = action.get("base_revision", document["revision"])
    if base != document["revision"]:
        raise RevisionConflict(f"Expected revision {base}; current {document['revision']}")
    op = action.get("op")
    result = document.copy()
    items = document["items"].copy()
    result["items"] = items
    if op == "splice":
        # A single atomic replacement of a contiguous logical selection.
        # Clipboard imports get fresh IDs; history replay restores exact IDs.
        index = action.get("index")
        delete_count = action.get("delete_count")
        replacements = action.get("objects", [])
        if (not isinstance(index, int) or not isinstance(delete_count, int)
                or index < 0 or delete_count < 0 or index + delete_count > len(items)
                or not isinstance(replacements, list) or len(replacements) > MAX_ATOMIC_OBJECTS):
            raise DocumentError("Invalid range replacement")
        prepared = [_copy_object_with_new_ids(obj) if action.get("fresh_ids", True)
                    else deepcopy(obj) for obj in replacements]
        items[index:index + delete_count] = prepared
    elif op == "set_styles":
        changes = action.get("styles")
        if not isinstance(changes, list) or not changes:
            raise DocumentError("Expected nonempty style changes")
        by_id = {}
        for change in changes:
            if not isinstance(change, dict) or change.get("id") in by_id:
                raise DocumentError("Invalid style change")
            by_id[change.get("id")] = change
        existing = {item["id"]: i for i, item in enumerate(items) if item["type"] == "word"}
        if any(ident not in existing for ident in by_id):
            raise DocumentError("Style selection contains a missing word")
        for ident, change in by_id.items():
            idx = existing[ident]
            updated = items[idx].copy()
            if "color" in change:
                value = change["color"]
                if not isinstance(value, str) or not (value.startswith("#") and len(value) in (4, 7)):
                    raise DocumentError("Invalid color")
                updated["color"] = value
            if "bold" in change:
                updated["bold"] = bool(change["bold"])
            items[idx] = updated
    elif op == "insert_existing":
        index = action.get("index", len(items))
        if not isinstance(index, int) or not 0 <= index <= len(items):
            raise DocumentError("Invalid insertion index")
        obj = deepcopy(action.get("object"))
        if not isinstance(obj, dict) or obj.get("type") not in SUPPORTED:
            raise DocumentError("Invalid existing document object")
        if any(item.get("id") == obj.get("id") for item in items):
            raise DocumentError("Duplicate document object ID")
        items.insert(index, obj)
    elif op == 'insert_image':
        index = action.get('index', len(items))
        if type(index) is not int or not 0<=index<=len(items):
            raise DocumentError('Invalid imported-image insertion index')
        items.insert(index, image(action['data_url'],action['pixel_width'],
            action['pixel_height'],action['bands'],action.get('width_mm',65.0),
            action.get('name','Imported image'),action.get('mask')))
    elif op == 'replace_table':
        idx=_locate(items,action.get('id',''))
        obj=deepcopy(action.get('object'))
        if idx<0 or items[idx]['type']!='table' or not isinstance(obj,dict) or obj.get('id')!=action.get('id') or obj.get('type')!='table':
            raise DocumentError('Invalid table replacement')
        validate_table(obj)
        items[idx]=obj
    elif op == 'insert_cartouche':
        index=action.get('index',len(items))
        if type(index) is not int or not 0<=index<=len(items):
            raise DocumentError('Invalid cartouche insertion index')
        items.insert(index,cartouche(action.get('orientation','vertical'),action.get('words',[])))
    elif op == 'replace_cartouche':
        idx=_locate(items,action.get('id',''))
        obj=deepcopy(action.get('object'))
        if idx<0 or items[idx]['type']!='cartouche' or not isinstance(obj,dict) or obj.get('id')!=action.get('id'):
            raise DocumentError('Invalid cartouche replacement')
        validate_cartouche(obj,validate_cartouche_word)
        items[idx]=obj
    elif op in ('set_cartouche_orientation','set_cartouche_words'):
        idx=_locate(items,action.get('id',''))
        if idx<0 or items[idx]['type']!='cartouche':
            raise DocumentError('Selected cartouche not found')
        obj=deepcopy(items[idx])
        if op=='set_cartouche_orientation':
            obj['orientation']=action.get('orientation')
        else:
            requested=action.get('words')
            if not isinstance(requested,list) or len(requested)>MAX_CARTOUCHE_WORDS:
                raise DocumentError('Invalid cartouche word list')
            previous=obj['items']
            obj['items']=[{**word(validate_signs(signs)),
                'id': previous[j]['id'] if j<len(previous) else fresh_id()}
                for j,signs in enumerate(requested)]
        validate_cartouche(obj,validate_cartouche_word)
        items[idx]=obj
    elif op == 'insert_table':
        index = action.get('index',len(items))
        if type(index) is not int or not 0<=index<=len(items):
            raise DocumentError('Invalid table insertion index')
        items.insert(index,table(action.get('rows',2),action.get('columns',2)))
    elif op in ('set_table_cell','table_insert_row','table_delete_row',
                'table_insert_column','table_delete_column','set_table_width'):
        idx=_locate(items,action.get('id',''))
        if idx<0 or items[idx]['type']!='table':
            raise DocumentError('Selected table not found')
        obj=deepcopy(items[idx])
        rows=obj['rows']
        if op=='set_table_cell':
            r,c=action.get('row'),action.get('column')
            previous=cell_at(obj,r,c)
            mode=action.get('mode','text')
            if mode=='text':
                signs=action.get('words',[])
                if not isinstance(signs,list) or len(signs)>128:
                    raise DocumentError('Invalid table cell words')
                prepared=[]
                for i,entry in enumerate(signs):
                    glyphs=validate_signs(entry)
                    # Keep an existing word ID when replacing the same cell slot.
                    before=previous.get('items',[])
                    ident=before[i]['id'] if i<len(before) else fresh_id()
                    prepared.append({**word(glyphs),'id':ident})
                rows[r][c]={'id':previous['id'],'mode':'text','items':prepared}
            elif mode=='formula':
                rows[r][c]={'id':previous['id'],'mode':'formula','formula':action.get('formula')}
            else:raise DocumentError('Unsupported table cell mode')
        elif op=='set_table_width':
            obj['width_mm']=action.get('width_mm')
        elif op in ('table_insert_row','table_delete_row'):
            pos=action.get('index')
            if type(pos) is not int or pos<0 or pos>len(rows):raise DocumentError('Invalid table row')
            if op=='table_insert_row':
                if len(rows)>=MAX_ROWS:raise DocumentError('Table row limit reached')
                rows.insert(pos,[cell() for _ in rows[0]])
            else:
                if len(rows)<=1 or pos>=len(rows):raise DocumentError('Cannot remove final table row')
                rows.pop(pos)
        else:
            pos=action.get('index');columns=len(rows[0])
            if type(pos) is not int or pos<0 or pos>columns:raise DocumentError('Invalid table column')
            if op=='table_insert_column':
                if columns>=MAX_COLS:raise DocumentError('Table column limit reached')
                for row in rows:row.insert(pos,cell())
            else:
                if columns<=1 or pos>=columns:raise DocumentError('Cannot remove final table column')
                for row in rows:row.pop(pos)
        validate_table(obj)
        items[idx]=obj
    elif op in ('set_nested_position', 'relocate_nested'):
        idx=_locate(items, action.get('id',''))
        if idx<0 or items[idx]['type'] not in ('table','cartouche'):
            raise DocumentError('Only tables and cartouches have nested positioning')
        changed=items[idx].copy()
        for name in ('x_align','y_align','x_offset_mm'):
            if name in action:changed[name]=action[name]
        validate_nested_position(changed)
        if op=='relocate_nested':
            target=action.get('index',idx)
            if type(target) is not int or not 0<=target<len(items):
                raise DocumentError('Invalid nested-object destination')
            items.pop(idx);items.insert(target,changed)
        else:
            items[idx]=changed
    elif op == 'insert_clipart':
        index = action.get('index', len(items))
        if type(index) is not int or not 0 <= index <= len(items):
            raise DocumentError('Invalid insertion index')
        items.insert(index, clipart(action['artwork_id'], action.get('width_mm'), action.get('flip','auto')))
    elif op in ('set_clipart','set_image'):
        idx = _locate(items, action.get('id', ''))
        if idx < 0 or items[idx]['type'] != ('image' if op=='set_image' else 'clipart'):
            raise DocumentError('Selected artwork type mismatch')
        updated = items[idx].copy()
        if 'width_mm' in action:
            updated['width_mm'] = action['width_mm']
        if 'flip' in action:
            updated['flip'] = action['flip']
        for prop in ('x_align','y_align','x_offset_mm'):
            if prop in action:
                updated[prop] = action[prop]
        (validate_image if op=='set_image' else validate_clipart)(updated)
        items[idx] = updated
    elif op in ('relocate_clipart','relocate_image'):
        idx = _locate(items, action.get('id', ''))
        if idx < 0 or items[idx]['type'] != ('image' if op=='relocate_image' else 'clipart'):
            raise DocumentError('Selected artwork type mismatch')
        target = action.get('index', idx)
        if type(target) is not int or not 0 <= target < len(items):
            raise DocumentError('Invalid destination index')
        updated = items[idx].copy()
        for prop in ('x_align','y_align','x_offset_mm'):
            if prop in action:
                updated[prop] = action[prop]
        (validate_image if op=='relocate_image' else validate_clipart)(updated)
        items.pop(idx)
        items.insert(target, updated)
    elif op == "insert_word":
        index = action.get("index", len(items))
        if not isinstance(index, int) or not 0 <= index <= len(items):
            raise DocumentError("Invalid insertion index")
        items.insert(index, word(action["signs"], action.get("color", "#192433"),
                                 action.get("bold", False), action.get("lexicon_ref")))
    elif op in ("replace_signs", "set_word_style", "delete", "move"):
        idx = _locate(items, action.get("id", ""))
        if idx < 0:
            raise DocumentError("Document object not found")
        if op in ("replace_signs", "set_word_style"):
            items[idx] = items[idx].copy()
        if op == "replace_signs":
            if items[idx]["type"] != "word":
                raise DocumentError("Only word spellings can be replaced")
            items[idx]["signs"] = validate_signs(action["signs"])
            items[idx]["lexicon_ref"] = action.get("lexicon_ref")
        elif op == "set_word_style":
            if items[idx]["type"] != "word":
                raise DocumentError("Selected object is not a word")
            if "color" in action:
                value = action["color"]
                if not isinstance(value, str) or not (value.startswith("#") and len(value) in (4, 7)):
                    raise DocumentError("Invalid color")
                items[idx]["color"] = value
            if "bold" in action:
                items[idx]["bold"] = bool(action["bold"])
        elif op == "delete":
            del items[idx]
        else:
            index = action.get("index")
            if not isinstance(index, int) or not 0 <= index < len(items):
                raise DocumentError("Invalid move target")
            obj = items.pop(idx)
            items.insert(index, obj)
    elif op == "set_document":
        allowed = ("name", "direction", "font_size_pt", "surface", "papyrus_height_mm", "margins_mm")
        for key in allowed:
            if key in action:
                result[key] = action[key]
        result["name"] = valid_name(result["name"])
        if result["direction"] not in ("ltr", "rtl"):
            raise DocumentError("Invalid direction")
        if result["surface"] not in (*SURFACES, "papyrus"):
            raise DocumentError("Invalid surface")
        if not 6 <= float(result["font_size_pt"]) <= 72:
            raise DocumentError("Font size must be 6–72 pt")
        if not 80 <= float(result["papyrus_height_mm"]) <= 2000:
            raise DocumentError("Papyrus height outside allowed range")
        if result['surface'] == 'papyrus':
            # Canonicalize every edited/surface-switched papyrus. Pre-existing
            # asymmetric documents still open; validation reads them using
            # the same effective symmetric margins without silent mutation.
            result['margins_mm'] = validated_margins(result)
    else:
        raise DocumentError(f"Unknown command: {op}")
    result["revision"] += 1
    assert_document(result)
    return result

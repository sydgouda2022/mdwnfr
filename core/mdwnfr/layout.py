"""MdwNfr object-sequence compositor.

Documents retain stable ordered IDs; pages and columns are ephemeral layout.
Every object contributes measured geometry and silhouette clearance. The
renderer consumes only projected layout data and never decides text wrapping.
"""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
from math import ceil
from .document import SURFACES, assert_document, DocumentError, artwork_catalog, validated_margins, symbol_ids_for_word
from .quadrat import compose, expand_internal, expand_after_word, expand_to_ink_bottom, _shape_ratio
from .silhouette import free_sectors, free_word_starts, solid_object_mask, cartouche_object_mask, silhouettes_collide
from .tables import typeset_table, paginate_table, TableError
from .cartouches import typeset_cartouche, CartoucheError
from .typography import divider_stroke_mm

MARGIN_MM = 18.0
PT_TO_MM = 25.4 / 72.0
LAYOUT_PARAMETERS = ('id', 'direction', 'surface', 'font_size_pt', 'papyrus_height_mm', 'margins_mm')


def object_clearance_mm(column_width: float) -> float:
    """One quarter of the current column width between objects and visible ink.

    The same physical distance applies to normal text, floated text, tables,
    cartouches, raster images, and decorative dividers. It is not a percent of
    object width or a static screen-pixel padding.
    """
    return column_width / 4.0


def proportional_extra(heights: list[float], remainder: float) -> list[float]:
    """One universal allocation law for page and object-bounded text sectors.

    Each *quadrat box*, not its visible glyph, receives an increment weighted
    by its ORIGINAL height. Any between-word gap is already reserved before
    calling this function and stays constant.
    """
    total = sum(heights)
    if remainder <= 0 or total <= 0:
        return [0.0] * len(heights)
    return [remainder * height / total for height in heights]


def fixed_page_column_grid(usable_width:float,nominal_width:float)->tuple[int,float]:
    """Share the sub-column horizontal remainder equally across fixed-paper slots.

    Do not apply this to papyrus, whose page width grows with its contents.
    """
    if usable_width<nominal_width or nominal_width<=0:
        raise DocumentError('Font too large for selected paper width')
    count=max(1,int((usable_width+1e-9)//nominal_width))
    return count,usable_width/count


def column_width_mm(font_size_pt: float) -> float:
    return float(font_size_pt) * PT_TO_MM * 2.0


def _art_x(column_x: float, column_width: float, image_width: float,
           owner: dict, direction: str, offset_override: float | None = None) -> float:
    """Page-local position, derived from the logical anchor and facing direction.

    A positive offset lets the object float *forward* in reading order across
    arbitrarily many adjacent slots. It does not store a page coordinate.
    Pre-0.1.17 art uses the old within-band x_align exactly.
    """
    column_x = round(column_x, 5)
    requested = (owner.get('x_offset_mm', 0.0) if offset_override is None
                 else offset_override)
    if requested < 0:
        # Artwork floats backwards from the beginning of its normal band.
        # The compositor has already cleared all affected predecessor slots.
        return round(column_x - abs(requested) if direction == 'ltr'
                     else column_x + column_width - image_width + abs(requested), 5)
    lead = min(requested, max(0.0,column_width-image_width))
    if lead > 0:
        return round(column_x + (column_width - image_width - lead
                       if direction == 'rtl' else lead), 5)
    return round(column_x + (column_width-image_width)*owner.get('x_align',0.0 if owner.get('type') in ('table','cartouche') else 0.5), 5)


def _physical_auto_flip(owner: dict, physical_x: float, page_w: float,
                        direction: str, papyrus: bool = False) -> str:
    """Resolve visual facing ONCE in the Python layout, not in the renderer.

    This same result is used for 2D mask intersection and painted artwork.
    Papyrus has no fixed right edge; its center follows document direction.
    """
    if owner['flip']!='auto':return owner['flip']
    if owner['type']=='image':natural='left'
    else:natural=artwork_catalog()[owner['artwork_id']]['native_facing']
    if natural=='neutral':return 'normal'
    if papyrus:inward='left' if direction=='rtl' else 'right'
    else:
        inward=('right' if physical_x<page_w/3 else
                'left' if physical_x>page_w*2/3 else
                ('left' if direction=='rtl' else 'right'))
    return 'normal' if natural==inward else 'mirror'


def _logical_auto_flip(owner:dict, logical_x:float, image_w:float,
                       page_w:float, margins:dict, direction:str, papyrus:bool) -> str:
    physical_x=(margins['left']+logical_x if direction=='ltr' else
                page_w-margins['right']-logical_x-image_w)
    return _physical_auto_flip(owner,physical_x,page_w,direction,papyrus)


@lru_cache(maxsize=32768)
def _cached_quadrat(spelling: tuple[str, ...], width: float,
                    ratios: tuple[float, ...]):
    # Using normalized outline ratios in the key means a font metric change
    # cannot reuse stale sign geometry. Quadrat is an immutable dataclass.
    return compose(list(spelling), width, dict(zip(spelling, ratios)))


def _pack_pages(doc: dict, columns: list[dict], width: float, page_width: float,
                page_height: float, page_capacity: int | None,
                compact: bool = False, nested_masks: dict | None = None) -> list[dict]:
    margins = validated_margins(doc)
    # Text columns alone consume writing slots. Floating objects are
    # zero-span overlays with independent silhouettes and clearance. Their
    # anchors may extend across several slots without reserving any of them.
    page_chunks: list[list[dict]] = []
    if page_capacity is None:
        page_chunks = [columns]
    else:
        chunk: list[dict] = []
        occupied = 0
        for seed in columns:
            span = seed.get('span', 1)
            if chunk and (seed.get('break_before') or occupied + span > page_capacity):
                page_chunks.append(chunk)
                chunk, occupied = [], 0
            chunk.append(seed)
            occupied += span
        if chunk:
            page_chunks.append(chunk)
    if not page_chunks:
        page_chunks = [[]]
    pages: list[dict] = []
    clipart_by_id={o['id']:o for o in doc['items'] if o['type'] in ('clipart','image')}
    nested_by_id={o['id']:o for o in doc['items'] if o['type'] in ('table','cartouche')}
    nested_masks=nested_masks or {}
    for chunk in page_chunks:
        occupied = sum(seed.get('span', 1) for seed in chunk)
        # Nontext overlays have zero flow span, but can extend the papyrus
        # writing surface even when the document contains no text columns.
        cursor = 0
        page_extent = occupied
        for seed in chunk:
            page_extent = max(page_extent,
                cursor+seed.get('slot_offset',0)+seed.get('slot_width',seed.get('span',1)))
            cursor += seed.get('span',1)
        page_w = (margins['left']+margins['right']+page_extent*width
                  if page_capacity is None else page_width)
        positioned: list[dict] = []
        slot = 0
        for ci, seed in enumerate(chunk):
            span = seed.get('span', 1)
            used_slots = seed.get('slot_width', span)
            effective_slot = slot + seed.get('slot_offset', 0)
            col_width = used_slots * width
            x = (page_w-margins['right']-(effective_slot+used_slots)*width if doc['direction'] == 'rtl'
                 else margins['left']+effective_slot*width)
            placements = seed['placements'] if compact else []
            if not compact:
                for placement in seed['placements']:
                    if placement['type'] in ('table','cartouche'):
                        owner=nested_by_id[placement['id']]
                        ox=_art_x(x,col_width,placement['width_mm'],owner,
                                  doc['direction'],seed.get('float_offset'))
                        placements.append({**placement,'x':ox})
                    elif placement['type'] in ('clipart','image'):
                        owner=clipart_by_id[placement['id']]
                        px=_art_x(x,col_width,placement['width_mm'],owner,
                                  doc['direction'],seed.get('float_offset'))
                        placements.append({**placement,'x':px,
                           'resolved_flip':_physical_auto_flip(owner,px,page_w,
                              doc['direction'],page_capacity is None)})
                    else:
                        placements.append({**placement,'x':round(x,5)})
            positioned.append({'placements':placements,
                               'text_top':seed['text_top'], 'text_bottom':seed['text_bottom'],
                               **({'text_runs':seed['text_runs']} if 'text_runs' in seed else {}),
                               'kind':seed.get('kind','words'), 'span':span,
                               **({'ink_bottom_aligned':True} if seed.get('ink_bottom_aligned') else {}),
                               **({'terminal_gap_removed':True} if seed.get('terminal_gap_removed') else {}),
                               **({'word_boundary_justify':True} if seed.get('word_boundary_justify') else {}),
                               **({'table_fragment_index':seed['table_fragment_index']} if 'table_fragment_index' in seed else {}),
                               'x':round(x,5), 'width':col_width,'index':ci,
                               **({'slot_offset':seed['slot_offset'],'slot_width':used_slots}
                                  if 'slot_offset' in seed else {}),
                               **({'float_offset':seed['float_offset']}
                                  if 'float_offset' in seed else {})})
            slot += span
        # Lines are derived decoration, never inputs to text geometry.
        # They stop a quarter-column before a visible artwork contour
        # and resume in the next unobstructed vertical sector.
        artworks=[]
        for col in positioned:
            if col['kind']=='clipart' and col['placements']:
                art=col['placements'][0]
                if isinstance(art,dict): artworks.append({**art, 'flip':art['resolved_flip'], 'bands':clipart_by_id[art['id']].get('bands'), 'mask':clipart_by_id[art['id']].get('mask')})
                else:
                    ident, ay, ah, aw=art
                    obj=clipart_by_id[ident]
                    artworks.append({'id':ident,'artwork_id':obj.get('artwork_id'), 'bands':obj.get('bands'),'mask':obj.get('mask'),
                      'flip':_physical_auto_flip(obj,_art_x(col['x'],col['width'],aw,obj,doc['direction'],col.get('float_offset')),page_w,doc['direction'],page_capacity is None),'y':ay,'height':ah,
                      'width_mm':aw,'x':_art_x(col['x'],col['width'],aw,obj,doc['direction'],
                                               col.get('float_offset'))})
            elif col['kind'] in ('table','cartouche') and col['placements']:
                pos=col['placements'][0]
                if isinstance(pos,dict):
                    artworks.append({'id':pos['id'],'mask':nested_masks.get(pos['id']),
                      'width_mm':pos['width_mm'],'height':pos['height'],
                      'x':pos['x'],'y':pos['y'],'flip':'normal'})
                else:
                    ident,oy,oh,ow=pos
                    owner=nested_by_id[ident]
                    artworks.append({'id':ident,'mask':nested_masks.get(ident),
                      'width_mm':ow,'height':oh,
                      'x':_art_x(col['x'],col['width'],ow,owner,doc['direction'],col.get('float_offset')),
                      'y':oy,'flip':'normal'})
        dividers=[]
        # A physical column can contain several silhouette-free sectors.
        # Match neighboring slots, not consecutive seeds: upper/lower sectors
        # are interleaved in reading order and need independent line segments.
        word_slots = {}
        for col in positioned:
            if col['kind']!='words' or not col['placements']:continue
            index=round((col['x']-margins['left'])/width)
            # A contour column may cross a bird/table silhouette: its upper
            # and lower ink runs must not be joined by a divider through air.
            word_slots.setdefault(index,[]).extend(col.get('text_runs',
                [(col['text_top'],col['text_bottom'])]))
        # Shared typography metric, proportional to the universal font size.
        divider_thickness = divider_stroke_mm(doc['font_size_pt'])
        for index in sorted(word_slots):
            if index+1 not in word_slots:continue
            x=margins['left']+(index+1)*width
            overlaps=sorted((max(a,c),min(b,d))
                for a,b in word_slots[index] for c,d in word_slots[index+1]
                if min(b,d)>max(a,c)+1e-8)
            spans=[]
            for top,bottom in overlaps:
                if spans and top<=spans[-1][1]+1e-8:
                    spans[-1]=(spans[-1][0],max(spans[-1][1],bottom))
                else:spans.append((top,bottom))
            for art in artworks:
                remaining=[]
                for top,bottom in spans:
                    clear=free_sectors(art.get('artwork_id'), bands=art.get('bands'), mask=art.get('mask'), image_width=art['width_mm'],
                         image_height=art['height'],x_offset=art['x'],
                         slot_left=x-divider_thickness/2,slot_right=x+divider_thickness/2,
                         top=top,bottom=bottom,clearance=object_clearance_mm(width),
                         flip=art['flip'],image_top=art['y'])
                    remaining.extend(clear)
                spans=remaining
                if not spans:break
            for top,bottom in spans:
                if bottom>top+1e-6:
                    dividers.append({'x':round(x,5),'y1':round(top,5),
                                     'y2':round(bottom,5),
                                     'thickness_mm':divider_thickness})
        pages.append({'index':len(pages),'width':page_w,
                      'height':page_height,'columns':positioned,'dividers':dividers})
    return pages


def _quadrat_object_payload(item: dict, quad) -> dict:
    """Project persistent symbol IDs into a quadrat without moving its glyphs."""
    payload=quad.payload()
    for atom, uid in zip(payload['signs'],symbol_ids_for_word(item)):
        atom['id']=uid
    return payload


def _layout(doc: dict, glyph_metrics: dict | None,
            previous: tuple[dict, dict, dict | None] | None,
            compact: bool = False) -> tuple[dict, dict]:
    """Object-sequence compositor.

    Persistent document objects know nothing about pages or columns. A single
    placement cursor traverses the ordered stream. Every non-word object adds
    one silhouette to the current page; every quadrat is fitted against the
    same silhouette set. Column and page membership are derived projections,
    never properties of document objects.
    """
    assert_document(doc)
    metrics = glyph_metrics or {}
    surface = doc['surface']
    papyrus = surface == 'papyrus'
    margins = validated_margins(doc)
    width = column_width_mm(doc['font_size_pt'])
    if papyrus:
        page_width, page_height, capacity = 0.0, float(doc['papyrus_height_mm']), None
    else:
        page_width, page_height = SURFACES[surface]
        usable_width = page_width - margins['left'] - margins['right']
        capacity, width = fixed_page_column_grid(usable_width, width)
    top = margins['top']
    bottom = page_height - margins['bottom']
    usable_height = bottom - top
    if usable_height <= 0:
        raise DocumentError('No writing region remains inside the margins')

    stats = dict(mode='object_stream', reused_prefix_columns=0,
                 reused_suffix_columns=0, computed_columns=0,
                 composed_quadrats=0, start_index=0)
    if previous is not None:
        before, old, old_metrics = previous
        if (doc['id'] == before.get('id')
                and all(doc.get(key) == before.get(key) for key in LAYOUT_PARAMETERS)
                and doc['items'] == before.get('items')
                and metrics == (old_metrics or {})
                and old.get('document_id') == doc['id']):
            result = deepcopy(old)
            result['revision'] = doc['revision']
            stats['mode'] = 'unchanged'
            stats['reused_prefix_columns'] = sum(len(p['columns']) for p in old['pages'])
            stats['start_index'] = len(doc['items'])
            return result, stats

    # One object stream, one spatial cursor, one obstacle registry.
    columns = []
    nested_masks = {}
    obstacles = []
    word_ink = []
    slot = 0
    pending = []             # (object, quadrat, y) in one reading-order lane
    lane_start = top
    lane_cursor = top
    overlay = None            # [base_slot, object_span, current_slot_index]
    warnings = []

    @lru_cache(maxsize=8192)
    def quadrat_for(signs):
        ratios = tuple(_shape_ratio(sign, metrics) for sign in signs)
        before = _cached_quadrat.cache_info().misses
        shape = _cached_quadrat(signs, width, ratios)
        stats['composed_quadrats'] += _cached_quadrat.cache_info().misses - before
        return shape

    def clear_page():
        nonlocal slot, obstacles, word_ink
        slot = 0
        obstacles = []
        word_ink = []

    def finish_lane(overflow=False):
        """Commit one reading column; only WORD columns advance the cursor."""
        nonlocal pending, slot, lane_cursor
        if not pending:
            return
        # A silhouette does not invalidate justification in unrelated lanes.
        left=slot*width
        clearance=object_clearance_mm(width)
        near=any(ob[5]-clearance<left+width and ob[5]+ob[3]+clearance>left
                 for ob in obstacles)
        adjustable = not near and overflow and len(pending)>1
        last_gap=pending[-1][1].flexible_gaps[-1]
        natural=sum(q.height for _,q,_ in pending)
        extra=max(0.,bottom-lane_start-natural) if adjustable else 0.
        shares=([((extra+last_gap)/(len(pending)-1))]*(len(pending)-1)+[-last_gap]
                if adjustable else [0.]*(len(pending)-1)+[-last_gap])
        cursor=lane_start
        placements=[]
        runs=[]
        for i,(item,q,origin) in enumerate(pending):
            if adjustable:
                origin=cursor
            shift=shares[i] if adjustable else (-last_gap if i==len(pending)-1 else 0.)
            if compact:
                placements.append((item['id'],round(origin,5),
                                   round(q.height+shift,5),shift))
            else:
                shape=(expand_to_ink_bottom(q,shift) if i==len(pending)-1
                       else expand_after_word(q,shift) if adjustable else q)
                placements.append({'id':item['id'],'type':'word',
                    'signs':item['signs'],'color':item.get('color','#192433'),
                    'bold':item.get('bold',False),'y':round(origin,5),
                    'height':round(shape.height,5),
                    'quadrat':_quadrat_object_payload(item,shape)})
            if i==0 or origin>pending[i-1][2]+pending[i-1][1].height+1e-4:
                runs.append([origin+min(g.y for g in q.signs),
                             origin+max(g.y+g.height for g in q.signs)])
            else:
                runs[-1][1]=origin+max(g.y+g.height for g in q.signs)
            for glyph in q.signs:
                word_ink.append((left+glyph.x,origin+glyph.y,glyph.width,glyph.height))
            cursor=origin+q.height+(shares[i] if adjustable else 0.)

        columns.append({'placements':placements,'kind':'words','span':1,
            'text_top':round(placements[0][1] if compact else placements[0]['y'],5),
            'text_bottom':round(runs[-1][1],5),
            'text_runs':[(round(a,5),round(b,5)) for a,b in runs],
            'terminal_gap_removed':True,
            **({'word_boundary_justify':True,'ink_bottom_aligned':True}
                if adjustable else {})})
        stats['computed_columns']+=1
        pending=[]
        lane_cursor=top
        slot+=1

    def advance_lane(overflow=False):
        nonlocal lane_start,lane_cursor
        finish_lane(overflow)
        if capacity is not None and slot>=capacity:
            clear_page()
        lane_start=top
        lane_cursor=top

    def word_origins(shape,item):
        """Intersect actual glyph-ink regions with ALL placed object silhouettes."""
        lane_x=slot*width
        clearance=object_clearance_mm(width)
        nearby=[ob for ob in obstacles
                if ob[5]-clearance<lane_x+width and ob[5]+ob[3]+clearance>lane_x]
        return free_word_starts(shape,column_left=lane_x,
            top=top,bottom=bottom,clearance=clearance,obstacles=nearby,
            ink_expansion=max((g.font_size for g in shape.signs),default=0)*.006
                          if item.get('bold',False) else 0)

    def insert_word(item):
        nonlocal lane_cursor,slot
        shape=quadrat_for(tuple(item['signs']))
        if shape.height>usable_height+1e-8:
            raise DocumentError('Quadrat exceeds writing height; reduce font size')
        while True:
            if capacity is not None and slot>=capacity:
                clear_page()
            permitted=word_origins(shape,item)
            chosen=next((max(a,lane_cursor) for a,b in permitted
                         if max(a,lane_cursor)<=min(b,bottom-shape.height)+1e-7),None)
            if chosen is not None:
                pending.append((item,shape,round(chosen,5)))
                lane_cursor=round(chosen+shape.height,5)
                return
            if pending:
                advance_lane(overflow=True)
            else:
                # A genuinely unavailable complete column: scan the next one.
                columns.append({'placements':[],'kind':'words','span':1,
                                'text_top':top,'text_bottom':top})
                stats['computed_columns']+=1
                slot+=1
                if capacity is not None and slot>=capacity:
                    clear_page()

    def measure(item):
        kind = item['type']
        if kind in ('clipart','image'):
            asset = artwork_catalog()[item['artwork_id']] if kind=='clipart' else None
            iw = float(item['width_mm'])
            ih = iw*(asset['default_height_mm']/asset['default_width_mm']
                     if asset else item['pixel_height']/item['pixel_width'])
            maximum = capacity*width if capacity is not None else iw
            scale = min(1.0,maximum/iw,usable_height/ih)
            iw *= scale
            ih *= scale
            return [(iw,ih,{'mask':item.get('mask'), 'bands':item.get('bands')},None)]
        if kind=='cartouche':
            try:
                geometry = typeset_cartouche(item,width,
                    capacity*width if capacity is not None else max(width*48,1000),
                    usable_height,metrics,doc['direction'])
            except CartoucheError as error:
                raise DocumentError(str(error)) from error
            iw,ih = geometry['width_mm'],geometry['height']
            mask = cartouche_object_mask(iw,ih,geometry['orientation'],
                                         geometry['terminal_end'],geometry['stroke_mm'])
            return [(iw,ih,{'mask':mask},geometry)]
        if kind=='table':
            ncols = len(item['rows'][0])
            desired = item.get('width_mm') or ncols*max(width*1.6,13.0)
            maximum = capacity*width if capacity is not None else desired
            iw = max(ncols*6,min(desired,maximum))
            iw = ceil((iw-1e-8)/width)*width
            try:
                geo = typeset_table(item,width,iw,None,metrics,doc['direction'])
                fragments = paginate_table(geo,usable_height)
            except TableError as error:
                raise DocumentError(str(error)) from error
            return [(frag['width_mm'],frag['height'],
                     {'mask':solid_object_mask()},frag) for frag in fragments]
        raise DocumentError('Unsupported object: '+kind)

    def place_object(item):
        """Place one obstacle without consuming a single reading column.

        The object is anchored at/after the current reading slot. Its visible
        silhouette, never an enclosing group of reserved columns, restricts
        subsequent quadrat origins. Already placed glyphs constrain the anchor.
        """
        nonlocal slot,lane_cursor,lane_start
        fragments=measure(item)
        for fragment_index,(iw,ih,profile,geometry) in enumerate(fragments):
            page_break=bool(fragment_index)
            if fragment_index:
                # A table continuation starts on a genuinely new page.
                finish_lane()
                if capacity is not None and slot<capacity:
                    columns.append({'placements':[],'kind':'words','span':capacity-slot,
                                    'text_top':top,'text_bottom':top})
                clear_page()
                lane_start=top
                lane_cursor=top

            wanted_y=top+(usable_height-ih)*(item.get('y_align',.5)
                                               if len(fragments)==1 else 0.)
            requested=float(item.get('x_offset_mm',0.)) if len(fragments)==1 else 0.
            if requested>0 and capacity is not None:
                requested=min(requested,max(0.,capacity*width-iw))
            span=max(1,ceil((iw+max(0.,requested)-1e-8)/width))
            if capacity is not None and span>capacity:
                raise DocumentError('Object exceeds the selected writing width')

            def choose_anchor():
                # Skip only ANCHOR CANDIDATES, not readable text columns.
                # Moving an object in x does not force word flow to skip x.
                scan=range(slot,(capacity-span+1) if capacity is not None
                           else slot+max(span,32)+ceil(abs(requested)/width)+2)
                preceding=word_ink[:]
                for source,quadr,_y in pending:
                    for glyph in quadr.signs:
                        preceding.append((slot*width+glyph.x,_y+glyph.y,
                                          glyph.width,glyph.height))
                for candidate in scan:
                    free_band=span*width-iw
                    align=item.get('x_align',0. if item['type'] in ('table','cartouche') else .5)
                    delta=(-abs(requested) if requested<0
                           else min(requested,max(0.,free_band)) if requested>0
                           else free_band*((1-align) if doc['direction']=='rtl' else align))
                    x=candidate*width+delta
                    if x < -1e-7 or (capacity is not None and x+iw>capacity*width+1e-7):
                        continue
                    facing=(_logical_auto_flip(item,x,iw,page_width,margins,
                                               doc['direction'],papyrus)
                            if item['type'] in ('clipart','image') else
                            ('mirror' if doc['direction']=='rtl' else 'normal'))
                    if doc['direction']=='rtl' and item['type'] in ('clipart','image'):
                        facing='normal' if facing=='mirror' else 'mirror'
                    new=(item.get('artwork_id'),profile.get('bands'),profile.get('mask'),
                         iw,ih,x,facing,wanted_y)
                    clearance=object_clearance_mm(width)
                    clashes_word=any(not any(a<=y+1e-6 and b>=y+h-1e-6
                        for a,b in free_sectors(item.get('artwork_id'),
                            bands=profile.get('bands'),mask=profile.get('mask'),
                            image_width=iw,image_height=ih,x_offset=x,
                            slot_left=px,slot_right=px+pw,top=y,bottom=y+h,
                            clearance=clearance,flip=facing,image_top=wanted_y))
                        for px,y,pw,h in preceding if px<x+iw+clearance and px+pw>x-clearance)
                    if clashes_word:continue
                    if any(silhouettes_collide(
                            {'x':px,'y':py,'width':pw,'height':ph,'mask':mask,
                             'flip':flip,'artwork_id':aid},
                            {'x':x,'y':wanted_y,'width':iw,'height':ih,
                             'mask':profile.get('mask'),'flip':facing,
                             'artwork_id':item.get('artwork_id')},
                            clearance)
                            for aid,_,mask,pw,ph,px,flip,py in obstacles):
                        continue
                    return candidate,x,new
                return None

            placement_plan=choose_anchor()
            if placement_plan is None and capacity is not None:
                page_break=True
                # The image cannot legally fit on this page. Only in this
                # genuine overflow case is the remaining page terminated.
                finish_lane()
                if slot<capacity:
                    columns.append({'placements':[],'kind':'words','span':capacity-slot,
                                    'text_top':top,'text_bottom':top})
                clear_page()
                lane_start=top
                lane_cursor=top
                placement_plan=choose_anchor()
            if placement_plan is None:
                raise DocumentError('Object has no collision-free anchor')
            anchor,x,new_obstacle=placement_plan
            if compact:
                placement=(item['id'],round(wanted_y,5),round(ih,5),round(iw,5))
            else:
                placement={'id':item['id'],'type':item['type'],
                           'y':round(wanted_y,5),'height':round(ih,5),
                           'width_mm':round(iw,5)}
                if item['type'] in ('clipart','image'):
                    px=(margins['left']+x if doc['direction']=='ltr'
                        else page_width-margins['right']-x-iw if not papyrus else x)
                    placement.update(artwork_id=item.get('artwork_id'),flip=item['flip'],
                        resolved_flip=_physical_auto_flip(item,px,page_width,
                                                           doc['direction'],papyrus))
                else:placement[item['type']]=geometry
            if item['type'] in ('table','cartouche'):
                nested_masks[item['id']]=profile['mask']
            # span=0 is intentional: an obstacle is painted on top of the
            # available-space map, never inserted as N empty text columns.
            seed={'placements':[placement],'text_top':round(wanted_y,5),
                  'text_bottom':round(wanted_y+ih,5),'span':0,
                  'slot_offset':anchor-slot,'slot_width':span,
                  'kind':'clipart' if item['type'] in ('clipart','image') else item['type'],
                  'float_offset':requested}
            if page_break:seed['break_before']=True
            if fragment_index:
                seed['table_fragment_index']=fragment_index
            elif item['type']=='table':seed['table_fragment_index']=0
            columns.append(seed)
            stats['computed_columns']+=1
            obstacles.append(new_obstacle)
            # Keep pending quadrats, current slot and their natural y cursor.
            # Their column can continue once the object occupies its contour.

    for item in doc['items']:
        if item['type']=='word':
            insert_word(item)
        else:
            place_object(item)
    finish_lane()
    pages = _pack_pages(doc,columns,width,page_width,page_height,capacity,compact,nested_masks)
    result = {'document_id':doc['id'],'revision':doc['revision'],
              'font_size_pt':doc['font_size_pt'],'direction':doc['direction'],
              'column_width_mm':width,'surface':surface,
              'margins_mm':margins,'pages':pages,'warnings':warnings}
    return result,stats


def layout_document(doc: dict, glyph_metrics: dict | None = None) -> dict:
    """Full deterministic layout, also used as the parity oracle for tests."""
    return _layout(doc, glyph_metrics, None)[0]


def incremental_layout_document(doc: dict, previous_document: dict | None = None,
                                previous_layout: dict | None = None,
                                glyph_metrics: dict | None = None,
                                previous_metrics: dict | None = None,
                                compact: bool = False) -> tuple[dict, dict]:
    """Recompose object positions from IDs and sequence, never page anchors.

    The previous snapshot may be reused only when the geometry inputs are
    identical. Compact mode projects tuple placements for visible-page
    expansion, without a second compositor.
    """
    previous = ((previous_document, previous_layout, previous_metrics)
                if previous_document is not None and previous_layout is not None else None)
    return _layout(doc, glyph_metrics, previous, compact)


class LayoutSession:
    """Bounded, per-worker snapshot owner, not a second layout engine.

    The sole active document is retained in the layout worker; switching files
    invalidates it. Caller-supplied revision/ticket ensures stale views cannot
    be committed on screen. Only accepted latest revisions update this cache.
    """
    def __init__(self, compact: bool = False):
        self.compact = compact
        self._document = None
        self._layout = None
        self._metrics = None

    def calculate(self, document: dict, metrics: dict | None = None) -> tuple[dict, dict]:
        metrics = metrics or {}
        prior = (self._document, self._layout, self._metrics) if self._document else (None, None, None)
        if self._document is not None and document['revision'] < self._document['revision']:
            # Old job: generate a correct result, but never poison newer state.
            return incremental_layout_document(document, *prior[:2], metrics, prior[2], compact=self.compact)
        result, stats = incremental_layout_document(document, *prior[:2], metrics, prior[2], compact=self.compact)
        self._document, self._layout, self._metrics = document, result, metrics
        return result, stats


def expand_compact_page(page: dict, document_by_id: dict[str, dict],
                        glyph_metrics: dict | None = None,
                        width: float | None = None, direction: str = 'rtl',
                        margins_mm: dict | None = None, surface: str | None = None) -> dict:
    """Materialize an exact visible page from compact, read-only column records.

    This is a projection, NOT a second typesetting algorithm: quadrat
    positioning and obstacle clearance were already solved by _layout.
    Only visible page requests call this function. It never mutates the cache.
    """
    glyph_metrics = glyph_metrics or {}
    margins_mm = margins_mm or {'top': MARGIN_MM, 'bottom': MARGIN_MM}
    detailed_columns = []
    for column in page['columns']:
        column_width = column['width'] if width is None else width
        placements = []
        for entry_index,(ident,y,height,extra) in enumerate(column['placements']):
            obj = document_by_id[ident]
            if obj['type']=='cartouche':
                geo=typeset_cartouche(obj, width if width is not None else column['width']/max(1,column['span']),
                    column['width'],page['height']-margins_mm['top']-margins_mm['bottom'],
                    glyph_metrics,direction)
                placements.append({'id':ident,'type':'cartouche','x':_art_x(column['x'],column['width'],extra,obj,direction,column.get('float_offset')),
                    'y':y,'height':height,'width_mm':extra,'cartouche':geo})
                continue
            if obj['type']=='table':
                sign_width=width if width is not None else column['width']/max(1,column['span'])
                geometry=typeset_table(obj,sign_width,
                    max(1,round(extra/sign_width))*sign_width,None,glyph_metrics,direction)
                fragments=paginate_table(geometry,page['height']-margins_mm['top']-margins_mm['bottom'])
                fi=column.get('table_fragment_index',0)
                if fi>=len(fragments):raise DocumentError('Outdated table fragment revision')
                placements.append({'id':ident,'type':'table','x':_art_x(column['x'],column['width'],extra,obj,direction,column.get('float_offset')),
                    'y':y,'height':height,'width_mm':extra,'table':fragments[fi]})
                continue
            if obj['type'] in ('clipart','image'):
                image_w = extra  # exact width saved by the authoritative compositor
                px=_art_x(column['x'], column['width'],image_w,
                             obj, direction, column.get('float_offset'))
                placements.append({'id':ident, 'type':obj['type'],
                                   'artwork_id':obj.get('artwork_id'), 'flip':obj['flip'],
                                   'resolved_flip':_physical_auto_flip(obj,px,page['width'],direction,
                                      surface=='papyrus'),
                                   'width_mm':round(image_w,5),
                                   'y':y, 'height':height,'x':px})
                continue
            signs = obj['signs']
            spelling = tuple(signs)
            ratios = tuple(_shape_ratio(sign, glyph_metrics) for sign in spelling)
            source=_cached_quadrat(spelling,column_width,ratios)
            last_ink=(column.get('terminal_gap_removed')
                      and entry_index==len(column['placements'])-1)
            quadrat=(expand_to_ink_bottom(source,extra) if last_ink
                     else expand_after_word(source,extra)
                     if column.get('word_boundary_justify')
                     else expand_internal(source,extra))
            placements.append({'id': ident, 'type': 'word', 'signs': signs,
                               'color': obj.get('color', '#192433'),
                               'bold': obj.get('bold', False),
                               'y': y, 'height': height,
                                'quadrat': _quadrat_object_payload(obj,quadrat),
                               'x': column['x']})
        detailed_columns.append({**column, 'placements': placements})
    return {**page, 'columns': detailed_columns}


def expand_compact_layout(snapshot: dict, document_by_id: dict[str, dict],
                          glyph_metrics: dict | None = None) -> dict:
    """For testing / explicit full-geometry callers only; never retain in worker."""
    return {**snapshot, 'pages': [expand_compact_page(page, document_by_id, glyph_metrics,
                                      width=snapshot['column_width_mm'],
                                      direction=snapshot['direction'],
                                      margins_mm=snapshot.get('margins_mm'),surface=snapshot.get('surface'))
                                  for page in snapshot['pages']]}

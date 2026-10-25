"""One authoritative 2D alpha-collision engine for artwork and imported images.

A rasterized 256x256 silhouette is evaluated against the ENTIRE column width,
with physical clearance applied to both axes. The browser never calculates text
sectors. Historical saved images containing only 128 envelope bands are still
readable; new imports and all bundled art use actual two-dimensional masks.
"""
from __future__ import annotations

import base64
import binascii
from functools import lru_cache
from pathlib import Path
import json
from math import ceil, floor

SIZE=256


def validate_mask(mask: str) -> bool:
    """Validate bounded canonical 256x256 occupancy bitmap serialization."""
    if not isinstance(mask,str) or len(mask)!=10924:
        return False
    try:
        raw=base64.b64decode(mask,validate=True)
    except (binascii.Error,ValueError):
        return False
    return len(raw)==8192 and base64.b64encode(raw).decode('ascii')==mask and any(raw)


@lru_cache(maxsize=1)
def _profiles():
    from .document import artwork_catalog, DocumentError
    data=json.loads((Path(__file__).parent/'data/artwork_silhouettes.json').read_text('utf-8'))
    if data.get('format')!='mdwnfr-silhouette-v2' or data.get('rows')!=SIZE or data.get('columns')!=SIZE:
        raise DocumentError('Invalid two-dimensional silhouette library')
    catalog=artwork_catalog()
    if set(data['entries'])!=set(catalog):
        raise DocumentError('Silhouette library does not match clip-art catalog')
    for k,v in data['entries'].items():
        if v['sha256']!=catalog[k]['sha256'] or not validate_mask(v.get('mask')):
            raise DocumentError('Outdated or corrupt 2D artwork silhouette: '+k)
    return data['entries']


@lru_cache(maxsize=512)
def _mask_rows(encoded:str) -> tuple[int,...]:
    if not validate_mask(encoded):
        raise ValueError('Invalid image silhouette bitmap')
    raw=base64.b64decode(encoded)
    return tuple(int.from_bytes(raw[row*32:(row+1)*32],'big') for row in range(SIZE))


def _free_from_blocks(blocked,top,bottom):
    if not blocked:return [(top,bottom)]
    blocked.sort()
    merged=[]
    for a,b in blocked:
        if merged and a <= merged[-1][1]+1e-8:
            merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
        else: merged.append((a,b))
    free=[]; cursor=top
    for a,b in merged:
        if a>cursor+1e-8:free.append((cursor,a))
        cursor=max(cursor,b)
    if cursor<bottom-1e-8:free.append((cursor,bottom))
    return free


@lru_cache(maxsize=1)
def solid_object_mask() -> str:
    """Filled rectangular object footprint, using the same 2D obstacle format."""
    return base64.b64encode(bytes([255])*8192).decode('ascii')


@lru_cache(maxsize=256)
def cartouche_object_mask(width_mm: float, height_mm: float, orientation: str,
                         terminal_end: str, stroke_mm: float) -> str:
    """Rasterize the solid footprint of the Egyptian rope-loop enclosure.

    The interior is occupied because it contains nested signs. The semicircular
    cap and terminal/tie are retained, leaving genuinely free corner sectors.
    Geometry is derived only from the cartouche compositor's measured outline.
    """
    if width_mm <= 0 or height_mm <= 0 or orientation not in ('vertical','horizontal'):
        raise ValueError('Invalid cartouche mask dimensions')
    from math import hypot
    size=SIZE; rows=[]
    for j in range(size):
        y=(j+.5)/size*height_mm; bits=0
        for k in range(size):
            x=(k+.5)/size*width_mm
            if orientation=='vertical':
                # Terminal occupies the bottom of the rectangular mask. The
                # curved loop occupies the remaining main rectangle.
                terminal=max(stroke_mm*2.6, width_mm*.12)
                loop_h=max(width_mm, height_mm-terminal)
                r=min(width_mm/2, loop_h/2)
                if y<=loop_h:
                    if y<r: inside=(x-width_mm/2)**2+(y-r)**2<=r*r
                    elif y>loop_h-r: inside=(x-width_mm/2)**2+(y-(loop_h-r))**2<=r*r
                    else: inside=True
                else:
                    inside=(y<=loop_h+terminal and stroke_mm <= x <= width_mm-stroke_mm)
            else:
                terminal=max(stroke_mm*2.6,height_mm*.12)
                tie_left=terminal_end=='left'
                loop_x0=terminal if tie_left else 0.0
                loop_x1=width_mm if tie_left else width_mm-terminal
                r=min(height_mm/2,(loop_x1-loop_x0)/2)
                if loop_x0<=x<=loop_x1:
                    if x<loop_x0+r: inside=(x-(loop_x0+r))**2+(y-height_mm/2)**2<=r*r
                    elif x>loop_x1-r: inside=(x-(loop_x1-r))**2+(y-height_mm/2)**2<=r*r
                    else:inside=True
                else:inside= (0<=x<loop_x0 or loop_x1<x<=width_mm) and stroke_mm<=y<=height_mm-stroke_mm
            if inside:bits|=1<<(size-1-k)
        rows.append(bits.to_bytes(32,'big'))
    return base64.b64encode(b''.join(rows)).decode('ascii')


def free_sectors(artwork_id, *, image_width, image_height, x_offset,
                 slot_left, slot_right, top, bottom, clearance, flip='normal',
                 image_top=None, bands=None, mask=None):
    """Exact raster-silhouette free vertical intervals in a word-sized column.

    Occupied pixels are not collapsed to horizontal envelopes. Each 2D row is
    queried against the real x footprint of this column (plus its clearance).
    The occupied y intervals are expanded by clearance, then unioned; no word
    sign can touch any occupied pixel in its column. Flip reflects actual bits.
    """
    if image_top is None:image_top=top
    if image_width<=0 or image_height<=0 or bottom<=top:return [(top,bottom)]
    if mask is None and artwork_id is not None:
        mask=_profiles()[artwork_id]['mask']
    blocked=[]
    if mask is not None:
        rows=_mask_rows(mask)
        # Packed columns are rounded to 5 decimals of a millimeter. Treat
        # genuinely touching clearance boundaries as free, rather than
        # exposing a phantom occupied pixel due to that rounding. The epsilon
        # is below the published geometric precision and is not a new margin.
        epsilon=2e-5
        x0=max(0,min(SIZE,floor((slot_left-clearance-x_offset+epsilon)/image_width*SIZE)))
        x1=max(0,min(SIZE,ceil((slot_right+clearance-x_offset-epsilon)/image_width*SIZE)))
        if x1<=x0:return [(top,bottom)]
        def intersects(row,lo,hi):
            return bool((row >> (SIZE-hi)) & ((1 << (hi-lo))-1))
        for j,occupied in enumerate(rows):
            if not occupied:continue
            overlaps=(intersects(occupied,x0,x1) if flip!='mirror' else
                      intersects(occupied,SIZE-x1,SIZE-x0))
            if flip=='auto':overlaps=overlaps or intersects(occupied,SIZE-x1,SIZE-x0)
            if not overlaps:continue
            lo=max(top,image_top+image_height*j/SIZE-clearance)
            hi=min(bottom,image_top+image_height*(j+1)/SIZE+clearance)
            if hi>lo:blocked.append((lo,hi))
        return _free_from_blocks(blocked,top,bottom)
    # Legacy imported documents: row-envelope fallback, until reopened and
    # migrated by the browser from the authoritative embedded PNG bytes.
    if bands is None:
        return [(top,bottom)]
    n=len(bands)
    for j,b in enumerate(bands):
        if b is None:continue
        lo,hi=b[0]/10000,b[1]/10000
        orientations=((lo,hi),(1-hi,1-lo)) if flip=='auto' else (
                     ((1-hi,1-lo),) if flip=='mirror' else ((lo,hi),))
        if not any(x_offset+r*image_width+clearance>slot_left+1e-8 and
                   x_offset+l*image_width-clearance<slot_right-1e-8
                   for l,r in orientations):continue
        a=max(top,image_top+image_height*j/n-clearance)
        b=min(bottom,image_top+image_height*(j+1)/n+clearance)
        if b>a:blocked.append((a,b))
    return _free_from_blocks(blocked,top,bottom)


def free_word_starts(quadrat, *, column_left, top, bottom, clearance,
                     obstacles, ink_expansion=0.0):
    """Allowed word origins, testing each visible glyph against 2D artwork.

    A column's empty side bearings and a word's inter-row spaces are not ink.
    They must not turn a tapered contour or the space between legs into an
    opaque word-sized rectangle. Keep glyph geometry intact and intersect
    the legal vertical origins of every glyph. Obstacles use reading-axis
    coordinates, including the already resolved mask reflection.
    """
    ink_bottom=max(g.y+g.height for g in quadrat.signs)
    starts=[(top,bottom-ink_bottom-ink_expansion)]
    if starts[0][1]<top:return []
    for glyph in quadrat.signs:
        for aid,bands,mask,iw,ih,ix,flip,iy in obstacles:
            free=free_sectors(aid,bands=bands,mask=mask,
                image_width=iw,image_height=ih,x_offset=ix,
                slot_left=column_left+glyph.x,
                slot_right=column_left+glyph.x+glyph.width,
                top=top+glyph.y,bottom=bottom,
                clearance=clearance+ink_expansion,flip=flip,image_top=iy)
            allowed=[(a-glyph.y,b-glyph.y-glyph.height)
                     for a,b in free if b-a>=glyph.height-1e-8]
            starts=[(max(a,c),min(b,d)) for a,b in starts for c,d in allowed
                    if min(b,d)>=max(a,c)-1e-8]
            if not starts:return []
    return sorted(starts)


@lru_cache(maxsize=512)
def _mask_row_runs(encoded: str) -> tuple[tuple[tuple[int, int], ...], ...]:
    """Exact contiguous occupied x-pixel intervals in each 2D mask row.

    Runs, rather than a row's first/last opaque pixel, are essential: a
    wing/body gap remains transparent even when both shapes share a row.
    """
    rows = _mask_rows(encoded)
    answer = []
    for bits in rows:
        spans = []
        previous = -1
        for x in range(SIZE):
            occupied = bool(bits & (1 << (SIZE - 1 - x)))
            if occupied and previous == -1:
                previous = x
            elif not occupied and previous != -1:
                spans.append((previous, x))
                previous = -1
        if previous != -1:
            spans.append((previous, SIZE))
        answer.append(tuple(spans))
    return tuple(answer)


def silhouettes_collide(first: dict, second: dict, clearance: float) -> bool:
    """Check the *two occupied 2D silhouettes*, not their bounding boxes.

    Inputs use the same reading-axis coordinates as the compositor's collision
    planner. For each occupied pixel interval, test all occupied rows of the
    other silhouette within the prescribed clearance. Clearance is measured
    between the outer edges of occupied pixel cells; this conservative raster
    approximation never treats transparent holes as solid rectangles.

    A missing/legacy mask falls back to rectangular clearance rather than
    allowing unchecked overlaps. Mirroring is applied to pixels, not to the
    rectangular envelope. Objects are not moved or resized by this function.
    """
    if clearance < 0:
        raise ValueError('Clearance must not be negative')
    ax, ay, aw, ah = (float(first[k]) for k in ('x', 'y', 'width', 'height'))
    bx, by, bw, bh = (float(second[k]) for k in ('x', 'y', 'width', 'height'))
    if min(aw, ah, bw, bh) <= 0:
        return False
    # Fast bounding-box rejection uses the *same* clearance criterion.
    if (ax + aw + clearance <= bx or bx + bw + clearance <= ax or
            ay + ah + clearance <= by or by + bh + clearance <= ay):
        return False
    mask_a = first.get('mask')
    mask_b = second.get('mask')
    if mask_a is None and first.get('artwork_id'):
        mask_a = _profiles()[first['artwork_id']]['mask']
    if mask_b is None and second.get('artwork_id'):
        mask_b = _profiles()[second['artwork_id']]['mask']
    if not mask_a or not mask_b:
        return True  # Legacy band-only records: safe conservative fallback.
    runs_a = _mask_row_runs(mask_a)
    runs_b = _mask_row_runs(mask_b)
    step_a, step_b = ah / SIZE, bh / SIZE
    mirror_a = first.get('flip') == 'mirror'
    mirror_b = second.get('flip') == 'mirror'
    for ia, horizontal_a in enumerate(runs_a):
        if not horizontal_a:
            continue
        alo = ay + ia * step_a
        ahi = alo + step_a
        # Candidate B rows whose pixel cells lie within the expanded Y band.
        start = max(0, int(floor((alo - clearance - by) / step_b)))
        stop = min(SIZE, int(ceil((ahi + clearance - by) / step_b)))
        if stop <= start:
            continue
        for ib in range(start, stop):
            if not runs_b[ib]:
                continue
            blo = by + ib * step_b
            bhi = blo + step_b
            if ahi + clearance <= blo or bhi + clearance <= alo:
                continue
            for al, ar in horizontal_a:
                if mirror_a:
                    al, ar = SIZE - ar, SIZE - al
                left_a = ax + al * aw / SIZE
                right_a = ax + ar * aw / SIZE
                for bl, br in runs_b[ib]:
                    if mirror_b:
                        bl, br = SIZE - br, SIZE - bl
                    left_b = bx + bl * bw / SIZE
                    right_b = bx + br * bw / SIZE
                    if left_a < right_b + clearance and left_b < right_a + clearance:
                        return True
    return False

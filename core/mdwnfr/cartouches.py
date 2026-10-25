"""One indivisible nested stream for vertical/horizontal royal cartouches.

The Python engine owns word composition, dimensions and enclosure geometry.
The page renderer is intentionally passive: it draws the supplied SVG path.
"""
from __future__ import annotations

from math import ceil, isfinite
from .quadrat import compose

MAX_CARTOUCHE_WORDS = 48

class CartoucheError(ValueError):
    pass


def validate_cartouche(obj: dict, check_word=None) -> None:
    if obj.get('type') != 'cartouche' or obj.get('orientation') not in ('vertical','horizontal'):
        raise CartoucheError('Invalid cartouche orientation')
    items = obj.get('items')
    if not isinstance(items, list) or len(items)>MAX_CARTOUCHE_WORDS:
        raise CartoucheError('Cartouche must contain no more than 48 words')
    for item in items:
        if not isinstance(item,dict) or item.get('type')!='word':
            raise CartoucheError('Cartouches contain only whole hieroglyphic words')
        if check_word: check_word(item)


def typeset_cartouche(obj: dict, sign_width: float, available_width: float,
                      available_height: float, metrics: dict | None = None,
                      direction: str = 'rtl') -> dict:
    """Compose once, auto-fit as one object, never stretch or split signs.

    A cartouche larger than the page's usable region is rejected explicitly.
    The enclosure has an outline and end-bar, derived from the final size;
    its geometry is expressed in millimetres relative to the object origin.
    """
    validate_cartouche(obj)
    if min(sign_width,available_width,available_height)<=0 or not all(map(isfinite,[sign_width,available_width,available_height])):
        raise CartoucheError('Invalid cartouche writing frame')
    horizontal=obj['orientation']=='horizontal'
    words=obj['items']
    # Padded clear area between signs and the enclosing oval.
    pad_cross=.22*sign_width
    # Curve radius must be clear of signs: the loop is not a UI pill.
    pad_long=.85*sign_width
    gap=.15*sign_width
    if horizontal:
        word_width=sign_width*.90
        quadrats=[compose(w['signs'],word_width,metrics) for w in words]
        natural_w=sum(q.width for q in quadrats)+gap*max(0,len(quadrats)-1)
        natural_h=max((q.height for q in quadrats),default=sign_width*.75)
        # Horizontal loop ends have semicircular crowns. At either end the
        # signs must clear the entire cap radius plus a sign-size inset.
        pad_long=max(pad_long,(natural_h+2*pad_cross)*.5+.12*sign_width)
        required_w=natural_w+2*pad_long+.28*sign_width
        required_h=natural_h+2*pad_cross
    else:
        word_width=sign_width*.78
        quadrats=[compose(w['signs'],word_width,metrics) for w in words]
        natural_w=max((q.width for q in quadrats),default=word_width)
        natural_h=sum(q.height for q in quadrats)+gap*max(0,len(quadrats)-1)
        if not words:natural_h=sign_width*.75
        pad_long=max(pad_long,(natural_w+2*pad_cross)*.5+.12*sign_width)
        required_w=natural_w+2*pad_cross
        required_h=natural_h+2*pad_long+.28*sign_width
    scale=min(1.0,available_width/required_w,available_height/required_h)
    if scale<.40:
        raise CartoucheError('Cartouche cannot fit this writing surface without becoming illegible')
    # Composition is solved at the final sign width, so the shape ratios remain
    # exact rather than scaling a stale glyph layout in the page renderer.
    content_width=round(word_width*scale,8)
    quadrats=[compose(w['signs'],content_width,metrics) for w in words]
    pad_cross*=scale;pad_long*=scale;gap*=scale
    if horizontal:
        inner_w=sum(q.width for q in quadrats)+gap*max(0,len(quadrats)-1)
        inner_h=max((q.height for q in quadrats),default=sign_width*.75*scale)
        cw=inner_w+2*pad_long;ch=inner_h+2*pad_cross
    else:
        inner_w=max((q.width for q in quadrats),default=content_width)
        inner_h=sum(q.height for q in quadrats)+gap*max(0,len(quadrats)-1)
        if not words:inner_h=sign_width*.75*scale
        cw=inner_w+2*pad_cross;ch=inner_h+2*pad_long
    placements=[]
    if horizontal:
        cursor=pad_long
        arranged=list(reversed(list(zip(words,quadrats)))) if direction=='rtl' else list(zip(words,quadrats))
        for item,q in arranged:
            placements.append({'id':item['id'],'signs':item['signs'],'color':item.get('color','#192433'),
               'bold':item.get('bold',False),'x':round(cursor,5),
               'y':round(pad_cross+(inner_h-q.height)/2,5),'height':round(q.height,5),
               'quadrat':q.payload()})
            cursor+=q.width+gap
    else:
        cursor=pad_long
        for item,q in zip(words,quadrats):
            placements.append({'id':item['id'],'signs':item['signs'],'color':item.get('color','#192433'),
               'bold':item.get('bold',False),'x':round(pad_cross+(inner_w-q.width)/2,5),
               'y':round(cursor,5),'height':round(q.height,5),'quadrat':q.payload()})
            cursor+=q.height+gap
    cw=round(cw,5);ch=round(ch,5)
    # An Egyptian royal name-ring: oval-headed rope loop and a DISTINCT
    # terminal tie. The loop has semicircular ends, not quarter-circle UI
    # corners. A vertical cartouche starts at its curved TOP and ends at its
    # bottom terminal. Horizontal text starts at the curved leading end,
    # with the tie on the trailing end (right for LTR, left for RTL).
    stroke=round(max(.26,.045*sign_width*scale),5)
    terminal_gap=max(.14*sign_width*scale,stroke*.8)
    terminal_space=terminal_gap+stroke*1.8
    if horizontal:
        loop_w=cw;loop_h=ch; r=loop_h/2
        # Reserve outer width for the raised rope/tie; content positions shift
        # only when the RTL terminal is at the left.
        tie_left=direction=='rtl'
        w=loop_w+terminal_space;h=loop_h
        x0=terminal_space if tie_left else 0.0
        x1=x0+loop_w
        path=(f'M {x0+r:.5f} 0 L {x1-r:.5f} 0 '
              f'C {x1-r*.42:.5f} 0 {x1:.5f} {r*.42:.5f} {x1:.5f} {r:.5f} '
              f'C {x1:.5f} {h-r*.42:.5f} {x1-r*.42:.5f} {h:.5f} {x1-r:.5f} {h:.5f} '
              f'L {x0+r:.5f} {h:.5f} '
              f'C {x0+r*.42:.5f} {h:.5f} {x0:.5f} {h-r*.42:.5f} {x0:.5f} {r:.5f} '
              f'C {x0:.5f} {r*.42:.5f} {x0+r*.42:.5f} 0 {x0+r:.5f} 0 Z')
        terminal_x=x0-terminal_gap if tie_left else x1+terminal_gap
        path+=f' M {terminal_x:.5f} {h*.06:.5f} V {h*.94:.5f}'
        if tie_left:
            for placement in placements: placement['x']=round(placement['x']+x0,5)
        ending='left' if tie_left else 'right'
    else:
        loop_w=cw;loop_h=ch;r=loop_w/2
        w=loop_w;h=loop_h+terminal_space
        path=(f'M {r:.5f} 0 '
              f'C {w-r*.42:.5f} 0 {w:.5f} {r*.42:.5f} {w:.5f} {r:.5f} '
              f'V {loop_h-r:.5f} '
              f'C {w:.5f} {loop_h-r*.42:.5f} {w-r*.42:.5f} {loop_h:.5f} {r:.5f} {loop_h:.5f} '
              f'C {r*.42:.5f} {loop_h:.5f} 0 {loop_h-r*.42:.5f} 0 {loop_h-r:.5f} '
              f'V {r:.5f} C 0 {r*.42:.5f} {r*.42:.5f} 0 {r:.5f} 0 Z')
        tie_y=loop_h+terminal_gap
        path+=f' M {w*.06:.5f} {tie_y:.5f} H {w*.94:.5f}'
        ending='bottom'
    cw=round(w,5);ch=round(h,5)
    d=path
    return {'orientation':obj['orientation'],'width_mm':cw,'height':ch,
        'view_box':f'0 0 {cw} {ch}','outline_path':d,
        'stroke_mm':stroke,'terminal_end':ending,
        'words':placements,'scale':round(scale,8)}

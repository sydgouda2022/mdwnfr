"""Deterministic quadrat packing from glyph dimensions and ink geometry.

Each sign is classified by its measured width and height relative to a virtual
quadrat. Composition preserves logical sign order, visible aspect ratios and
actual silhouette clearance. Internal clearance is 5% of column width; the
existing 20% gap between finished rows/words remains independent.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from functools import lru_cache
from pathlib import Path
from typing import Mapping
import json, math

DATA_PATH=Path(__file__).resolve().parent/'data'/'glyph_geometry.json'
CATEGORIES_PATH=Path(__file__).resolve().parent/'data'/'glyph_categories_unicode18.json'
TALL_BELOW_ASPECT=.70
WIDE_ABOVE_ASPECT=1.40
COMPACT_BELOW_EXTENT_EM=.70
QUADRAT_MIN_DIMENSION_EM=.70
QUADRAT_REVIEW_MARGIN_EM=.07
INNER_CLEARANCE_RATIO=.05
GROUP_HEIGHT_RATIO=.75
VERTICAL_GAP_RATIO=.20


@dataclass(frozen=True)
class SignBox:
    sign:str
    x:float
    y:float
    width:float
    height:float
    font_size:float
    text_x:float
    text_y:float
    paint_order:int=0


@dataclass(frozen=True)
class Quadrat:
    width:float
    height:float
    signs:tuple[SignBox,...]
    rows:tuple[tuple[int,...],...]
    flexible_gaps:tuple[float,...]

    def payload(self)->dict:
        return {'width':self.width,'height':self.height,
                'signs':[asdict(s) for s in self.signs],
                'rows':[list(row) for row in self.rows],
                'flexible_gaps':list(self.flexible_gaps)}


@lru_cache(maxsize=1)
def _catalogue()->tuple[dict,dict,dict]:
    source=json.loads(DATA_PATH.read_text(encoding='utf-8'))
    glyphs=source.get('glyphs',{})
    scans=source.get('scanlines',{})
    optics=source.get('optics',{})
    resolution=source.get('resolution')
    if (source.get('format')!='mdwnfr-glyph-ink-v2' or
        len(glyphs)!=1072 or set(scans)!=set(glyphs) or
        set(optics)!=set(glyphs) or resolution!=64):
        raise ValueError('Verified two-dimensional Egyptian glyph silhouettes are missing')
    for sign,bounds in glyphs.items():
        if (len(sign)!=1 or len(bounds)!=4 or
            not all(isinstance(v,(int,float)) and math.isfinite(v) for v in bounds) or
            bounds[2]<=bounds[0] or bounds[3]<=bounds[1]):
            raise ValueError('Invalid Egyptian glyph outline')
        rows=scans[sign]
        if not isinstance(rows,list) or len(rows)!=resolution:
            raise ValueError('Invalid glyph ink scan length')
        valid_rows=0
        for row in rows:
            if row is None:continue
            if (not isinstance(row,list) or len(row)!=2 or
                any(type(v) is not int for v in row) or
                not 0<=row[0]<row[1]<=resolution):
                raise ValueError('Invalid glyph silhouette scan')
            valid_rows+=1
        if not valid_rows:raise ValueError('Empty glyph silhouette')
        factor=optics[sign]
        if (type(factor) not in (int,float) or
            not math.isfinite(factor) or not 1.0<=factor<=1.18):
            raise ValueError('Invalid optical factor for glyph')
    return glyphs,scans,optics


def glyph_geometry()->dict:
    return _catalogue()[0]


def glyph_scanlines()->dict:
    return _catalogue()[1]


def glyph_optical_factors()->dict:
    return _catalogue()[2]


@lru_cache(maxsize=1)
def glyph_categories()->dict:
    """Pinned Unicode 18 kEH_Cat metadata for the installed glyph set."""
    source=json.loads(CATEGORIES_PATH.read_text(encoding='utf-8'))
    categories=source.get('categories',{})
    if (source.get('format')!='mdwnfr-unicode-hieroglyph-categories-v1' or
        source.get('unicode_version')!='18.0.0' or
        source.get('property')!='kEH_Cat' or
        len(categories)!=1072 or set(categories)!=set(glyph_geometry()) or
        any(not isinstance(value,str) or not value for value in categories.values())):
        raise ValueError('Pinned Unicode 18 hieroglyph category metadata is incomplete')
    return categories


def classify_sign_bounds(bounds:tuple[float,...]|list[float])->dict:
    """Classify actual ink bounds at the installed font's common em scale.

    All runtime metadata comes from the already-loaded glyph geometry. The
    generated JSON inventory is for audit, not a second browser dependency.
    """
    left,bottom,right,top=bounds
    width,height=right-left,top-bottom
    if width<=0 or height<=0 or not all(math.isfinite(v) for v in bounds):
        raise ValueError('Invalid hieroglyph ink outline')
    aspect=width/height
    extent=max(width,height)
    shape=('tall' if aspect<TALL_BELOW_ASPECT else
           'wide' if aspect>WIDE_ABOVE_ASPECT else 'squareish')
    size='compact' if extent<COMPACT_BELOW_EXTENT_EM else 'normal'
    # The historical four-way typology is based on both dimensions of a
    # virtual quadrat, not aspect ratio plus the longest side alone.
    broad=width>=QUADRAT_MIN_DIMENSION_EM
    tall=height>=QUADRAT_MIN_DIMENSION_EM
    quadrat_class=('square' if broad and tall else
                   'tall' if tall else
                   'wide' if broad else 'small')
    # Flag signs close to either independent dimension boundary for visual
    # review. Aspect/longest-extent labels remain useful diagnostics only.
    review=(abs(width-QUADRAT_MIN_DIMENSION_EM)<=QUADRAT_REVIEW_MARGIN_EM or
            abs(height-QUADRAT_MIN_DIMENSION_EM)<=QUADRAT_REVIEW_MARGIN_EM)
    return {'width_em':round(width,6),'height_em':round(height,6),
            'shape':shape,'size':size,'quadrat_class':quadrat_class,
            'needs_review':review}


@lru_cache(maxsize=1)
def glyph_profiles()->dict:
    """Classify all 1,072 signs from the same validated geometry as rendering."""
    return {sign:classify_sign_bounds(bounds)
            for sign,bounds in glyph_geometry().items()}


def _silhouette_advance(left:list,right:list,w_left:float,h_left:float,
                        w_right:float,h_right:float,clearance:float)->float:
    """Minimum horizontal advance for visible ink, sampled at matching heights.

    Interlocking transparent glyph contours may reduce rectangular whitespace,
    but the required physical ink clearance is never reduced.
    """
    high=max(h_left,h_right)
    most=None
    for step in range(256):
        y=(step+.5)*high/256
        l_y=y-(high-h_left)/2
        r_y=y-(high-h_right)/2
        if not (0<=l_y<h_left and 0<=r_y<h_right):
            continue
        l=left[min(63,int(l_y/h_left*64))]
        r=right[min(63,int(r_y/h_right*64))]
        if l is None or r is None:
            continue
        facing=l[1]*w_left/64-r[0]*w_right/64
        most=facing if most is None else max(most,facing)
    if most is None:
        return w_left+clearance
    # Raster precision allowance is not a second spacing percentage.
    return max(0.0,min(w_left+clearance,
                       most+clearance+max(w_left,w_right)/64))


def _shape_ratio(sign:str,glyph_metrics:Mapping[str,object]|None=None)->float:
    bounds=glyph_geometry().get(sign)
    if bounds is None:
        raise ValueError('This sign has no outline in the installed hieroglyphic font')
    if glyph_metrics and sign in glyph_metrics:
        source=glyph_metrics[sign]
        if isinstance(source,dict):
            ratio=float(source['width'])/float(source['height'])
        else:
            ratio=float(source)
        if not math.isfinite(ratio) or ratio<=0:
            raise ValueError('Invalid requested glyph ratio')
        return ratio
    return (bounds[2]-bounds[0])/(bounds[3]-bounds[1])


def compose(signs:list[str],column_width:float,
            glyph_metrics:Mapping[str,object]|None=None,
            overlay_pairs:tuple[tuple[int,int,int],...]=())->Quadrat:
    if (not signs or not isinstance(column_width,(int,float)) or
        not math.isfinite(column_width) or column_width<=0):
        raise ValueError('Nonempty signs and positive finite column width required')
    width=float(column_width)
    bounds=glyph_geometry()
    ink_scans=glyph_scanlines()
    optics=glyph_optical_factors()
    profiles=glyph_profiles()
    ratios=[_shape_ratio(s,glyph_metrics) for s in signs]
    natural_heights=[bounds[s][3]-bounds[s][1] for s in signs]
    natural_extents=[max(bounds[s][2]-bounds[s][0],
                         bounds[s][3]-bounds[s][1]) for s in signs]
    boosts=[optics[s] for s in signs]
    gap=width*INNER_CLEARANCE_RATIO
    overlay_map={}
    for first,second,front in overlay_pairs:
        if (type(first) is not int or type(second) is not int or
            type(front) is not int or second!=first+1 or
            first<0 or second>=len(signs) or front not in (-1,first,second) or
            first in overlay_map or second in overlay_map):
            raise ValueError('Invalid explicit overlay group')
        overlay_map[first]=(second,front)

    # Keep the existing optically corrected standalone presentation.
    # Small signs are permitted to stand alone and grow proportionally.
    def single_dimensions(i:int)->tuple[float,float]:
        ratio=ratios[i]
        target=min(3*width/4,max(width/2,ratio*width/4))
        target=min(3*width/4,target*boosts[i])
        h=min(width,target/ratio)
        return ratio*h,h

    # (height, ((sign-index, x, y, width, height), ...)).
    # All returned coordinates are local to the row and preserve glyph ratios.
    @lru_cache(maxsize=None)
    def horizontal(i:int):
        if i+1>=len(signs):
            return None
        first,second=profiles[signs[i]],profiles[signs[i+1]]
        compatible=(first['quadrat_class']=='small' or
                    second['quadrat_class']=='small' or
                    (first['quadrat_class']=='tall' and
                     second['quadrat_class']=='tall'))
        if not compatible:
            return None
        indices=(i,i+1)
        # Set a common font scale using the dominant sign's natural dimensions.
        # The partner retains its relative size rather than being promoted to
        # full reference height merely because it shares the row.
        anchor=max(indices,key=lambda j:(profiles[signs[j]]['size']=='normal',
                                         natural_extents[j]))
        baseline_h=single_dimensions(anchor)[1]
        scale=min(baseline_h/natural_heights[anchor],
                  GROUP_HEIGHT_RATIO*width/max(natural_heights[j] for j in indices))
        original_scale=scale

        def fit(factor:float):
            h1,h2=(natural_heights[j]*factor for j in indices)
            w1,w2=(ratios[j]*h for j,h in zip(indices,(h1,h2)))
            advance=_silhouette_advance(ink_scans[signs[i]],
                                        ink_scans[signs[i+1]],
                                        w1,h1,w2,h2,gap)
            left=min(0.0,advance)
            right=max(w1,advance+w2)
            occupied=right-left
            height=max(h1,h2)
            placements=((i,-left,(height-h1)/2,w1,h1),
                        (i+1,advance-left,(height-h2)/2,w2,h2))
            return occupied,height,placements

        occupied,height,placements=fit(scale)
        if occupied>width+1e-8:
            # Shrink uniformly if only a modest correction is required.
            # Significant reduction is rejected to keep all signs legible.
            scale*=max(0.0,(width-gap)/(occupied-gap))
            if scale<original_scale*.70:
                return None
            occupied,height,placements=fit(scale)
        if occupied>width+1e-7:
            return None
        shift=(width-occupied)/2
        return height,tuple((j,x+shift,y,w,h) for j,x,y,w,h in placements)

    @lru_cache(maxsize=None)
    def vertical_pair(i:int):
        """Stack two low/compact signs in one quadrat, preserving their ratios."""
        if i+1>=len(signs):
            return None
        classes={profiles[signs[j]]['quadrat_class'] for j in (i,i+1)}
        if not classes.issubset({'wide','small'}):
            return None

        def fit(target_height:float):
            available=target_height-gap
            if available<=0:
                return None
            total=natural_heights[i]+natural_heights[i+1]
            heights=(available*natural_heights[i]/total,
                     available*natural_heights[i+1]/total)
            widths=(ratios[i]*heights[0],ratios[i+1]*heights[1])
            widest=max(widths)
            if widest>width:
                return None
            boxes=[]
            for j,h,w,y0 in ((i,heights[0],widths[0],0.0),
                             (i+1,heights[1],widths[1],heights[0]+gap)):
                boxes.append((j,(width-w)/2,y0,w,h))
            return target_height,tuple(boxes)

        target=width*GROUP_HEIGHT_RATIO
        result=fit(target)
        if result is None:
            available=target-gap
            total=natural_heights[i]+natural_heights[i+1]
            widest=max(ratios[i]*available*natural_heights[i]/total,
                       ratios[i+1]*available*natural_heights[i+1]/total)
            target=gap+available*width/widest
            if target<width*.5:
                return None
            result=fit(target)
        return result

    @lru_cache(maxsize=None)
    def overlay_pair(i:int):
        """Centered U+13436 overlay requested explicitly by the document."""
        if i not in overlay_map:
            return None
        second,_front=overlay_map[i]
        indices=(i,second)
        if {profiles[signs[j]]['quadrat_class'] for j in indices}!={'tall','wide'}:
            return None
        natural_widths=tuple(ratios[j]*natural_heights[j] for j in indices)
        composite_width=max(natural_widths)
        composite_height=max(natural_heights[j] for j in indices)
        if composite_width<=0 or composite_height<=0:
            return None
        scale=min(width/composite_width,width*GROUP_HEIGHT_RATIO/composite_height)
        if not math.isfinite(scale) or scale<=0:
            return None
        row_width=composite_width*scale
        row_height=composite_height*scale
        left=(width-row_width)/2
        boxes=[]
        for j,natural_w,natural_h in zip(indices,natural_widths,
                                          (natural_heights[x] for x in indices)):
            w,h=natural_w*scale,natural_h*scale
            boxes.append((j,left+(row_width-w)/2,(row_height-h)/2,w,h))
        return row_height,tuple(boxes)

    @lru_cache(maxsize=None)
    def small_grid(i:int,count:int):
        """Place three or four compact signs in deterministic 2x2 tabulation."""
        if count not in (3,4) or i+count>len(signs):
            return None
        if any(profiles[signs[j]]['quadrat_class']!='small'
               for j in range(i,i+count)):
            return None
        target=width*GROUP_HEIGHT_RATIO
        # Reserve the same 5%-of-column-width clearance between every
        # neighboring cell; outer margins are not counted as internal gaps.
        cell_w=(width-gap)/2
        cell_h=(target-gap)/2
        cells=([(0,0),(1,0),(0.5,1)] if count==3 else
               [(0,0),(1,0),(0,1),(1,1)])
        boxes=[]
        for offset,(column,row) in enumerate(cells):
            j=i+offset
            h=min(cell_h,cell_w/ratios[j])
            w=ratios[j]*h
            cell_x=column*(cell_w+gap) if column in (0,1) else (width-cell_w)/2
            cell_y=row*(cell_h+gap)
            x=cell_x+(cell_w-w)/2
            y=cell_y+(cell_h-h)/2
            boxes.append((j,x,y,w,h))
        return target,tuple(boxes)

    @lru_cache(maxsize=None)
    def tall_stack(i:int):
        if i+2>=len(signs):
            return None
        indices=(i,i+1,i+2)
        # Both reading orders are allowed: tall host first or tall host last.
        first,last=profiles[signs[i]],profiles[signs[i+2]]
        if first['quadrat_class']=='tall':
            host=i
            companions=(i+1,i+2)
        elif last['quadrat_class']=='tall':
            host=i+2
            companions=(i,i+1)
        else:
            return None
        if not all(profiles[signs[j]]['quadrat_class'] in ('small','wide')
                   for j in companions):
            return None
        b,c=companions

        def fit(host_height:float):
            # Exact top/bottom alignment: H_b + G + H_c == H_host.
            available=host_height-gap
            if available<=0:
                return None
            total=natural_heights[b]+natural_heights[c]
            hb=available*natural_heights[b]/total
            hc=available*natural_heights[c]/total
            wh=ratios[host]*host_height
            wb,wc=ratios[b]*hb,ratios[c]*hc
            group_width=max(wb,wc)
            offsets={b:(group_width-wb)/2,c:(group_width-wc)/2}
            comp_y={b:0.0,c:hb+gap}

            # Find the smallest valid group advance using facing silhouettes
            # at *the same y*. The companion glyphs are optically centered
            # inside their shared width; the host stays aligned top-to-bottom.
            most=None
            host_scan=ink_scans[signs[host]]
            for j,(w,h) in ((b,(wb,hb)),(c,(wc,hc))):
                scan=ink_scans[signs[j]]
                y0=comp_y[j]
                for step in range(256):
                    y=(step+.5)*host_height/256
                    if not y0<=y<y0+h:
                        continue
                    host_row=host_scan[min(63,int(y/host_height*64))]
                    comp_row=scan[min(63,int((y-y0)/h*64))]
                    if host_row is None or comp_row is None:
                        continue
                    if host==i:
                        facing=(host_row[1]*wh/64 -
                                (offsets[j]+comp_row[0]*w/64))
                    else:
                        facing=(offsets[j]+comp_row[1]*w/64 -
                                host_row[0]*wh/64)
                    most=facing if most is None else max(most,facing)
            left_group_width=wh if host==i else group_width
            advance=(left_group_width+gap if most is None else
                     max(0.0,min(left_group_width+gap,
                         most+gap+max(wh,group_width)/64)))
            xhost=0.0 if host==i else advance
            xgroup=advance if host==i else 0.0
            boxes=((host,xhost,0.0,wh,host_height),
                   (b,xgroup+offsets[b],0.0,wb,hb),
                   (c,xgroup+offsets[c],comp_y[c],wc,hc))
            occupied=max(x+w for _,x,_,w,_ in boxes)-min(x for _,x,_,_,_ in boxes)
            return occupied,boxes

        desired=width*GROUP_HEIGHT_RATIO
        output=fit(desired)
        if output is None:
            return None
        occupied,boxes=output
        if occupied>width+1e-8:
            # A bounded proportional reduction keeps the whole group intact.
            desired*=max(0.0,(width-gap)/(occupied-gap))
            if desired<width*.5:
                return None
            output=fit(desired)
            if output is None:
                return None
            occupied,boxes=output
        if occupied>width+1e-7:
            return None
        shift=(width-occupied)/2-min(x for _,x,_,_,_ in boxes)
        # Keep results in logical input order, not the physical drawing order.
        ordered=tuple(sorted(((j,x+shift,y,w,h) for j,x,y,w,h in boxes),
                             key=lambda box:box[0]))
        return desired,ordered

    def visible_ink_area(placed):
        area=0.0
        for j,_,_,w,h in placed:
            coverage=sum(row[1]-row[0] for row in ink_scans[signs[j]]
                         if row is not None)/(64*64)
            area+=w*h*coverage
        return area

    @lru_cache(maxsize=None)
    def choose(index:int):
        if index==len(signs):
            return (0,0.0,0.0,(),())
        possibilities=[]
        for length,layout in (
            (1,(single_dimensions(index)[1],
                ((index,(width-single_dimensions(index)[0])/2,0.0,
                  *single_dimensions(index)),))),
            (2,horizontal(index)),
            (2,vertical_pair(index)),
            (2,overlay_pair(index)),
            (3,small_grid(index,3)),
            (4,small_grid(index,4)),
            (3,tall_stack(index))):
            if layout is None:
                continue
            row_height,placed=layout
            nrows,remaining,area,rows,placements=choose(index+length)
            total_area=visible_ink_area(placed)+area
            total_height=row_height*(1+VERTICAL_GAP_RATIO)+remaining
            possibilities.append((nrows+1,total_height,total_area,
                                  ((tuple(range(index,index+length))),)+rows,
                                  ((row_height,placed),)+placements))
        # Prefer a valid shared quadrat over splitting the same ordered signs
        # into separate rows; then minimize column height, then maximize the
        # measured visible ink area. No subjective balance weights are used.
        return min(possibilities,
                   key=lambda result:(result[0],round(result[1],9),
                                      -round(result[2],9),
                                      -len(result[3][0])))

    _,_,_,rows,layouts=choose(0)
    heights=[h for h,_ in layouts]
    gaps=[h*VERTICAL_GAP_RATIO for h in heights]
    placed=[None]*len(signs)
    categories=None
    y=0.0
    for row_indices,(row_height,positions),row_gap in zip(rows,layouts,gaps):
        paint_rank={index:0 for index in row_indices}
        if len(row_indices)==2 and row_indices[0] in overlay_map:
            second,front=overlay_map[row_indices[0]]
            if front==-1:
                if categories is None:categories=glyph_categories()
                front=max(row_indices,key=lambda j:(categories[signs[j]],ord(signs[j])))
            back=second if front==row_indices[0] else row_indices[0]
            paint_rank[back]=0
            paint_rank[front]=1
        for index,x,dy,w,h in positions:
            ink_y=y+dy
            left,bottom,right,top=bounds[signs[index]]
            em=h/(top-bottom)
            placed[index]=SignBox(signs[index],x,ink_y,w,h,em,
                                   x-left*em,ink_y+top*em,paint_rank[index])
        y+=row_height+row_gap
    return Quadrat(width,y,tuple(placed),tuple(rows),tuple(gaps))


def _adjust_row_gaps(quadrat:Quadrat,changes:list[float])->Quadrat:
    """Move ink only by changing inter-row whitespace, never glyph size."""
    gaps=quadrat.flexible_gaps
    if len(changes)!=len(gaps):
        raise ValueError('One spacing correction required per composed row')
    updated=[g+d for g,d in zip(gaps,changes)]
    if any(not math.isfinite(g) or g < -1e-9 for g in updated):
        raise ValueError("A row's whitespace cannot be negative")
    corrected=tuple(max(0.0,g) for g in updated)
    revised=[None]*len(quadrat.signs)
    shift=0.0
    for row_number,indices in enumerate(quadrat.rows):
        for index in indices:
            sign=quadrat.signs[index]
            revised[index]=SignBox(sign.sign,sign.x,sign.y+shift,
                                   sign.width,sign.height,sign.font_size,
                                   sign.text_x,sign.text_y+shift)
        shift+=corrected[row_number]-gaps[row_number]
    return Quadrat(quadrat.width,
                   quadrat.height+sum(corrected)-sum(gaps),
                   tuple(revised),quadrat.rows,corrected)


def expand_internal(quadrat:Quadrat,additional_height:float)->Quadrat:
    """Share extra whitespace equally per glyph, after its row."""
    if additional_height<=0:return quadrat
    total=sum(len(row) for row in quadrat.rows)
    if not total:return quadrat
    share=additional_height/total
    return _adjust_row_gaps(quadrat,[share*len(row) for row in quadrat.rows])


def expand_to_ink_bottom(quadrat:Quadrat,extra:float)->Quadrat:
    """Complete a rigid-paper column with its LAST ink touching the frame edge.

    The final row's natural trailing gap is redistributed among earlier row
    gaps. Paired signs contribute two equal shares to their common gap. This
    is used ONLY for a completed column; an unfinished column keeps normal
    symbol-then-space rhythm. For a single-row final word there is nothing
    internal to expand, but its trailing gap can still be removed while
    previous words receive the extra space.
    """
    if not quadrat.rows:return quadrat
    last_gap=quadrat.flexible_gaps[-1]
    eligible=sum(len(row) for row in quadrat.rows[:-1])
    if not eligible:
        if not math.isclose(extra,-last_gap,rel_tol=0,abs_tol=1e-7):
            raise ValueError('A one-row final word can only remove its trailing gap')
        return _adjust_row_gaps(quadrat,[0.0]*(len(quadrat.rows)-1)+[-last_gap])
    share=(extra+last_gap)/eligible
    if share < -1e-8:raise ValueError('Cannot shrink inner row gaps')
    changes=[max(0.0,share)*len(row) for row in quadrat.rows[:-1]]+[-last_gap]
    return _adjust_row_gaps(quadrat,changes)

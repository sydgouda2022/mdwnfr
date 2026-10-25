"""Silhouette-first, deterministic hieroglyphic column composition.

The document fixes ONE column width. Glyph proportions and bearings come from
the actual outlines of the same verified font served to the browser. The
horizontal gaps around ink silhouettes equal half their visible widths.
Each row contributes exactly ONE following gap of half its tallest visible
sign's height. No extra gap before the first row or at word boundaries.
The full row's height is determined by its tallest sign. No distortion.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from functools import lru_cache
from pathlib import Path
from typing import Mapping
import json, math

DATA_PATH=Path(__file__).resolve().parent/'data'/'glyph_geometry.json'
NARROW_RATIO=.65
PAIR_HEIGHT_PARITY=.60


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


def _silhouette_advance(left:list,right:list,w_left:float,h_left:float,
                        w_right:float,h_right:float)->float:
    """Nearest facing ink edges at the SAME vertical position, not rectangles.

    The quarter-sum-width gap is retained between visible ink contours.
    The rounding allowance bounds raster error. Never move glyphs farther
    apart than the original bounding-box spacing.
    """
    gap=(w_left+w_right)/4
    high=max(h_left,h_right)
    max_facing=None
    for step in range(128):
        y=(step+.5)*high/128
        l_y=y-(high-h_left)/2
        r_y=y-(high-h_right)/2
        if not(0<=l_y<h_left and 0<=r_y<h_right):continue
        l=left[min(63,int(l_y/h_left*64))]
        r=right[min(63,int(r_y/h_right*64))]
        if l is None or r is None:continue
        facing=l[1]*w_left/64-r[0]*w_right/64
        max_facing=facing if max_facing is None else max(max_facing,facing)
    if max_facing is None:
        return w_left+gap
    return min(w_left+gap,max_facing+gap+max(w_left,w_right)/64)


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
            glyph_metrics:Mapping[str,object]|None=None)->Quadrat:
    if (not signs or not isinstance(column_width,(int,float)) or
        not math.isfinite(column_width) or column_width<=0):
        raise ValueError('Nonempty signs and positive finite column width required')
    width=float(column_width)
    bounds=glyph_geometry()
    ink_scans=glyph_scanlines()
    optics=glyph_optical_factors()
    ratios=[_shape_ratio(s,glyph_metrics) for s in signs]
    boosts=[optics[s] for s in signs]

    # Normal single signs occupy C/2 in visible ink width. Exception:
    # flat signs may grow uniformly until H>=C/4, but no more than 3C/4
    # in width. The fixed column pitch is never exceeded. Tall signs
    # keep their natural ratio, with an absolute height limit of C.
    # Paired narrow signs retain their original individual size limit.
    def dimensions(ratio:float,limit:float,boost:float)->tuple[float,float]:
        target=limit
        if limit==width/2:
            base=min(3*width/4,max(width/2,ratio*width/4))
            # Optically delicate glyphs receive a modest uniform enlargement.
            # The hard 75%-column limit and tall-sign height cap still apply.
            target=min(3*width/4,base*boost)
        h=min(width,target/ratio)
        return ratio*h,h

    @lru_cache(maxsize=None)
    def choose(index:int)->tuple[float,tuple[tuple[int,...],...]]:
        if index==len(signs):return 0.0,()
        _,single_h=dimensions(ratios[index],width/2,boosts[index])
        rest,candidate=choose(index+1)
        choices=[(single_h+rest,((index,),)+candidate)]
        if (index+1<len(signs) and ratios[index]<=NARROW_RATIO and
            ratios[index+1]<=NARROW_RATIO):
            h1=dimensions(ratios[index],2*width/7,boosts[index])[1]
            h2=dimensions(ratios[index+1],2*width/7,boosts[index+1])[1]
            if min(h1,h2)/max(h1,h2)>=PAIR_HEIGHT_PARITY:
                rest,candidate=choose(index+2)
                choices.append((max(h1,h2)+rest,((index,index+1),)+candidate))
        return min(choices,key=lambda choice:choice[0])

    rows=choose(0)[1]
    heights=[max(dimensions(ratios[i],width/2 if len(row)==1 else
                            2*width/7,boosts[i])[1] for i in row) for row in rows]
    # One half-height space AFTER each row; never double-count it.
    gaps=[height/2 for height in heights]
    placed=[None]*len(signs)
    y=0.0
    for row_number,row in enumerate(rows):
        row_height=heights[row_number]
        limit=width/2 if len(row)==1 else 2*width/7
        dims=[dimensions(ratios[i],limit,boosts[i]) for i in row]
        if len(row)==1:
            w=dims[0][0]
            # Local left/right clearance is w/2. Distribute additional slack.
            xs=[(width-2*w)/2+w/2]
        else:
            w1,w2=dims[0][0],dims[1][0]
            advance=_silhouette_advance(ink_scans[signs[row[0]]],
                                        ink_scans[signs[row[1]]],
                                        w1,dims[0][1],w2,dims[1][1])
            # Left and right external clearances are half their respective
            # ink widths; unused column slack is distributed symmetrically.
            occupied=w1/2+advance+w2+w2/2
            slack=max(0.0,width-occupied)/2
            xs=[slack+w1/2,slack+w1/2+advance]
        for (w,h),x,index in zip(dims,xs,row):
            ink_y=y+(row_height-h)/2
            left,bottom,right,top=bounds[signs[index]]
            em=h/(top-bottom)
            placed[index]=SignBox(signs[index],x,ink_y,w,h,em,
                                  x-left*em,ink_y+top*em)
        # Include the final row's trailing space so the same gap applies
        # across word boundaries without an additional layout margin.
        y+=row_height+gaps[row_number]

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


def expand_after_word(quadrat:Quadrat,additional_height:float)->Quadrat:
    """Extend ONLY the whitespace after a complete word, never its inner rows.

    All visible sign positions and dimensions stay identical. The extra space
    is a placement tail so the following word starts later in the column.
    """
    if additional_height<0 or not math.isfinite(additional_height):
        raise ValueError('External word space must be finite and nonnegative')
    if additional_height==0:return quadrat
    gaps=quadrat.flexible_gaps
    if not gaps:return quadrat
    return Quadrat(quadrat.width,quadrat.height+additional_height,
                   quadrat.signs,quadrat.rows,
                   gaps[:-1]+(gaps[-1]+additional_height,))


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

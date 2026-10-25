"""Build exact visible-glyph bounds from the one Noto font shipped with MdwNfr."""
from __future__ import annotations
import hashlib,json,sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from PIL import Image, ImageDraw, ImageFont

RESOLUTION=64
RASTER_SIZE=320

def ink_detail_factor(tile):
    """Bounded optical correction from visible raster stroke complexity.

    Fine, sparse contours need slightly more display area than heavy strokes.
    This measures ink rather than unicode category or font advance width.
    """
    data=tile.load()
    filled=[[data[x,y]>=50 for x in range(64)] for y in range(64)]
    coverage=sum(sum(row) for row in filled)/4096
    boundaries=(sum(filled[y][x]!=filled[y][x+1]
                    for y in range(64) for x in range(63))
                +sum(filled[y][x]!=filled[y+1][x]
                     for y in range(63) for x in range(64)))/8064
    detail=max(0.0,min(1.0,(boundaries-0.045)/0.11))
    sparse=max(0.0,min(1.0,(0.28-coverage)/0.20))
    return round(1.0+0.18*detail*(0.35+0.65*sparse),5)


def silhouette_scanlines(font,sign):
    """Ink left/right extent per horizontal scan, normalized to visible glyph."""
    bbox=font.getbbox(sign)
    if bbox is None:raise ValueError('Missing rendered hieroglyph: '+sign)
    canvas=Image.new('L',(max(1,bbox[2]-bbox[0])+8,
                          max(1,bbox[3]-bbox[1])+8),0)
    ImageDraw.Draw(canvas).text((4-bbox[0],4-bbox[1]),sign,font=font,fill=255)
    visible=canvas.getbbox()
    if visible is None:raise ValueError('Empty rendered hieroglyph: '+sign)
    tile=canvas.crop(visible).resize((RESOLUTION,RESOLUTION),Image.Resampling.LANCZOS)
    pixels=tile.load()
    result=[]
    for y in range(RESOLUTION):
        ink=[x for x in range(RESOLUTION) if pixels[x,y]>=32]
        result.append([ink[0],ink[-1]+1] if ink else None)
    if not any(row is not None for row in result):
        raise ValueError('Empty ink scan profile: '+sign)
    return result,ink_detail_factor(tile)


def build(font_path:Path,output:Path)->None:
    data=font_path.read_bytes()
    digest=hashlib.sha256(data).hexdigest()
    if digest!='b792accc6207ca9caa59fc67f53926b6985a99d255dd432d7c68b68a6dfd62f8':
        raise ValueError('Unexpected deployed Egyptian font release')
    font=TTFont(font_path)
    upm=font['head'].unitsPerEm
    cmap=font.getBestCmap()
    outlines=font.getGlyphSet()
    entries={}
    scans={}
    optical={}
    painted_font=ImageFont.truetype(str(font_path),RASTER_SIZE)
    for cp in range(0x13000,0x13430):
        glyph=cmap.get(cp)
        if glyph is None:continue
        pen=BoundsPen(outlines)
        outlines[glyph].draw(pen)
        if not pen.bounds:continue
        x0,y0,x1,y1=pen.bounds
        if x1<=x0 or y1<=y0:continue
        entries[chr(cp)]=[round(x/upm,6) for x in (x0,y0,x1,y1)]
        scans[chr(cp)],optical[chr(cp)]=silhouette_scanlines(painted_font,chr(cp))
    if len(entries)!=1072:
        raise ValueError(f'Expected 1,072 actual hieroglyphic outlines, found {len(entries)}')
    payload={'format':'mdwnfr-glyph-ink-v2','font_sha256':digest,
             'em_units':upm,'resolution':RESOLUTION,
             'glyphs':entries,'scanlines':scans,'optics':optical}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(payload,ensure_ascii=False,
        sort_keys=True,separators=(',',':')),encoding='utf-8')
    print(f'Installed {len(entries)} glyphs with ink outlines, scanlines and optical detail factors')

if __name__=='__main__':
    build(Path(sys.argv[1]),Path(sys.argv[2]))

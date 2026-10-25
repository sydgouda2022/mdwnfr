/** Scale the Python compositor's ink geometry, preserving all SVG text bearings. */
export function fitQuadrat(quadrat,maxWidth=164,maxHeight=86){
 const ok=n=>typeof n==='number'&&Number.isFinite(n);
 if(!quadrat||![quadrat.width,quadrat.height,maxWidth,maxHeight].every(ok)||
    quadrat.width<=0||quadrat.height<=0||maxWidth<=0||maxHeight<=0||
    !Array.isArray(quadrat.signs)||!quadrat.signs.length)
   throw new TypeError('Invalid quadrat preview');
 const scale=Math.min(maxWidth/quadrat.width,maxHeight/quadrat.height);
 const signs=quadrat.signs.map(g=>{
  if(!g||typeof g.sign!=='string'||!g.sign||
     ![g.x,g.y,g.width,g.height,g.font_size,g.text_x,g.text_y].every(ok)||
     g.x<0||g.y<0||g.width<=0||g.height<=0||g.font_size<=0||
     g.x+g.width>quadrat.width+1e-5||g.y+g.height>quadrat.height+1e-5)
    throw new TypeError('Invalid visible-glyph geometry');
  return {sign:g.sign,x:g.x*scale,y:g.y*scale,
    width:g.width*scale,height:g.height*scale,
    font_size:g.font_size*scale,text_x:g.text_x*scale,text_y:g.text_y*scale};
 });
 return {width:quadrat.width*scale,height:quadrat.height*scale,signs};
}

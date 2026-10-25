import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1024,height:768}});
try {
 await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
 const diagnostics=await page.evaluate(async()=>{
  await document.fonts.load('100px "MdwNfr Hieroglyphs"');
  await document.fonts.ready;
  const source=await fetch('/core/mdwnfr/data/glyph_geometry.json').then(r=>r.json());
  if(source.format!=='mdwnfr-glyph-ink-v2')throw new Error('Not the installed silhouette font');
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d');
  ctx.font='100px "MdwNfr Hieroglyphs"';
  const bad=[],samples=[],threshold=2.0;
  for(const [sign,[left,bottom,right,top]] of Object.entries(source.glyphs)){
   const m=ctx.measureText(sign);
   const measured={left:-m.actualBoundingBoxLeft,
     right:m.actualBoundingBoxRight,
     top:m.actualBoundingBoxAscent,
     bottom:-m.actualBoundingBoxDescent};
   const target={left:left*100,right:right*100,top:top*100,bottom:bottom*100};
   const diffs={left:measured.left-target.left,
    right:measured.right-target.right,top:measured.top-target.top,
    bottom:measured.bottom-target.bottom};
   const error=Math.max(...Object.values(diffs).map(Math.abs));
   if(error>threshold)bad.push({sign,code:sign.codePointAt(0).toString(16),
     error,diffs,measured,target});
   if('𓅓𓇋𓈖𓏏𓏺'.includes(sign))samples.push({sign,error,diffs});
  }
  bad.sort((a,b)=>b.error-a.error);
  return {count:Object.keys(source.glyphs).length,bad:bad.length,
   maxError:bad[0]?.error??0,worst:bad.slice(0,12),samples};
 });
 console.log('Actual browser ink geometry:',JSON.stringify(diagnostics));
 assert.equal(diagnostics.count,1072);
 assert.equal(diagnostics.bad,0,'Canvas ink bounds deviate from the Python font outline; vertical spacing cannot match');
} finally {
 await browser.close();
}

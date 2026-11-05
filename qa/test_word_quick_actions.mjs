import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

for(const [label,engine,width,height] of [
 ['webkit-compact-iphone',webkit,375,667],
 ['chromium-iphone',chromium,390,844],
 ['webkit-ipad',webkit,1024,768]
]){
 const browser=await engine.launch({headless:true,
  args:engine===chromium?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({
  viewport:{width,height},isMobile:true,hasTouch:true,
  deviceScaleFactor:2,serviceWorkers:'block'
 });
 const page=await context.newPage();
 page.setDefaultTimeout(45000);
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
   null,{timeout:180000});
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible'});
  await page.evaluate(()=>{
   const dt=new DataTransfer();dt.setData('text/plain','𓂝𓎛 𓈖 𓂋');
   document.dispatchEvent(new ClipboardEvent('paste',{
    clipboardData:dt,bubbles:true,cancelable:true
   }));
  });
  const count=async n=>{
   await page.waitForFunction(n=>document.getElementById('wordcount')?.textContent===
    n+' '+(n===1?'word':'words'),n,{timeout:90000});
   await page.waitForFunction(n=>document.querySelectorAll('.word').length===n,
    n,{timeout:90000});
  };
  await count(3);
  await page.locator('.word').first().click();
  const bar=page.locator('#word-quick-actions');
  await bar.waitFor({state:'visible'});
  assert.equal(await page.locator('.range-handle').count(),0,
   'A 44px range handle must not cover a single selected quadrat');
  assert.equal(await page.locator('#object-quick-actions').isVisible(),false,
   'No object-toolbar duplication for words');
  assert.equal(await page.locator('#format-panel').isVisible(),false,
   'Selecting a quadrat must not open desktop-like Format');

  // Overlay is explicit: only this measured tall+wide pair exposes Stack.
  const stack=page.locator('#word-action-stack');
  const reverse=page.locator('#word-action-reverse');
  assert.equal(await stack.isVisible(),true);
  assert.equal(await reverse.isVisible(),false);
  const drawnOrder=()=>page.locator('.word[data-index="0"] .glyph-ink-svg text')
   .evaluateAll(nodes=>nodes.map(node=>node.textContent));
  const waitForDrawnOrder=expected=>page.waitForFunction(expected=>{
   const nodes=[...document.querySelectorAll('.word[data-index="0"] .glyph-ink-svg text')];
   return nodes.length===expected.length&&nodes.every((node,index)=>node.textContent===expected[index]);
  },expected,{timeout:90000});
  await stack.click();
  await page.waitForFunction(()=>document.getElementById('word-action-stack')?.textContent==='Unstack');
  // The action label updates from the session delta before asynchronous
  // reflow replaces the page's SVG. Wait for the rendered projection itself.
  await waitForDrawnOrder(['𓂝','𓎛']);
  assert.deepEqual(await drawnOrder(),['𓂝','𓎛']);
  assert.equal(await reverse.isVisible(),true);
  await reverse.click();
  await waitForDrawnOrder(['𓎛','𓂝']);
  assert.deepEqual(await drawnOrder(),['𓎛','𓂝']);
  await stack.click();
  await page.waitForFunction(()=>document.getElementById('word-action-stack')?.textContent==='Stack');
  await waitForDrawnOrder(['𓂝','𓎛']);
  assert.deepEqual(await drawnOrder(),['𓂝','𓎛']);

  // Touch-only range selection cannot depend on desktop Shift+click.
  // Deliver the same long-press pointer events WebKit/Chromium dispatch:
  // the first tap establishes an anchor, and holding a second word extends it.
  const next=page.locator('.word[data-index="1"]');
  const targetBox=await next.boundingBox();
  assert.ok(targetBox);
  const holdPoint={x:targetBox.x+targetBox.width/2,
   y:targetBox.y+targetBox.height/2};
  await next.dispatchEvent('pointerdown',{
   pointerType:'touch',pointerId:91,isPrimary:true,button:0,
   clientX:holdPoint.x,clientY:holdPoint.y
  });
  await page.waitForTimeout(650);
  await page.evaluate(({x,y})=>window.dispatchEvent(new PointerEvent('pointerup',{
   bubbles:true,pointerType:'touch',pointerId:91,button:0,clientX:x,clientY:y
  })),holdPoint);
  assert.equal(await page.locator('#selection-summary').textContent(),'2 selected',
   'Second touch-and-hold extends the logical selection without Shift');
  assert.equal(await page.locator('.range-handle').count(),2);
  // The finger-sized range handles own their current glyph endpoints.
  // A tap on empty paper dismisses the range before a new single tap.
  await page.locator('.paper').first().click({position:{x:20,y:55}});
  assert.equal(await page.locator('#selection-summary').textContent(),'No selection');
  await page.locator('.word[data-index="0"]').click();
  assert.equal(await page.locator('#selection-summary').textContent(),'1 selected');
  const hitTargets=await bar.locator('button:visible').evaluateAll(nodes=>nodes.map(node=>{
   const r=node.getBoundingClientRect();
   return {width:r.width,height:r.height,label:node.getAttribute('aria-label')};
  }));
  assert.ok(hitTargets.length>=6);
  assert.ok(hitTargets.every(t=>t.width>=43.9&&t.height>=43.9),
   'Contextual actions must remain finger-sized at every zoom');
  const rect=await bar.boundingBox();
  assert.ok(rect&&rect.x>=0&&rect.y>=0&&
   rect.x+rect.width<=width&&rect.y+rect.height<=height,
   'Quick actions may not overflow the screen');

  await page.locator('#word-action-bold').click();
  await page.waitForFunction(()=>document.getElementById('word-action-bold')?.getAttribute('aria-pressed')==='true',
   null,{timeout:90000});
  await page.locator('#word-action-red').click();
  await page.waitForFunction(()=>document.querySelector('.word .glyph-ink-svg text')?.getAttribute('fill')==='#ac2533',
   null,{timeout:90000});
  await page.locator('#word-action-black').click();
  await page.waitForFunction(()=>document.querySelector('.word .glyph-ink-svg text')?.getAttribute('fill')==='#192433',
   null,{timeout:90000});

  // Flat hieroglyphs may occupy a thin band inside a much taller font
  // rectangle. Measure painted ink using independent browser canvas metrics,
  // not SVG text.getBoundingClientRect(), which includes empty em-space.
  const paintedCenter=async logicalIndex=>
   page.locator('.word[data-index="'+logicalIndex+'"] .glyph-ink-svg text').first().evaluate(t=>{
    const ctx=document.createElement('canvas').getContext('2d');
    const fontSize=Number(t.getAttribute('font-size'));
    ctx.font=fontSize+'px "MdwNfr Hieroglyphs"';
    const m=ctx.measureText(t.textContent);
    if(!m.actualBoundingBoxRight||!m.actualBoundingBoxAscent)
     throw Error('Selected glyph has no measured painted ink');
    const localX=Number(t.getAttribute('x'))+
     (m.actualBoundingBoxRight-m.actualBoundingBoxLeft)/2;
    const localY=Number(t.getAttribute('y'))+
     (m.actualBoundingBoxDescent-m.actualBoundingBoxAscent)/2;
    const matrix=t.getScreenCTM();
    if(!matrix)throw Error('Selected glyph has no screen transform');
    return{x:matrix.a*localX+matrix.c*localY+matrix.e,
     y:matrix.b*localX+matrix.d*localY+matrix.f};
   });
  await page.evaluate(()=>{
   window.__wordTapTrace=[];
   document.addEventListener('click',e=>{
    if(!e.target.closest?.('.paper,.range-handle'))return;
    window.__wordTapTrace.push({
     shift:e.shiftKey,target:e.target.tagName,
     classes:e.target.getAttribute('class'),
     word:e.target.closest('.word')?.dataset.index,
     rangeHandle:e.target.closest('.range-handle')?.dataset.edge,
     x:e.clientX,y:e.clientY
    });
   },true);
  });
  const firstInk=await paintedCenter(0);
  await page.mouse.click(firstInk.x,firstInk.y);
  assert.equal(await page.locator('#selection-summary').textContent(),'1 selected');
  assert.equal(await page.locator('.word[data-index="0"]').evaluate(n=>n.classList.contains('selected')),true,
   'Painted first glyph must select the first logical quadrat');
  const secondInk=await paintedCenter(1);
  await page.keyboard.down('Shift');
  try{await page.mouse.click(secondInk.x,secondInk.y);}
  finally{await page.keyboard.up('Shift');}
  await page.waitForTimeout(120);
  const selectedAfterTap=await page.locator('#selection-summary').textContent();
  if(selectedAfterTap!=='2 selected'){
   const debug=await page.evaluate(({first,second})=>({
    first,second,events:window.__wordTapTrace,
    hit:[first,second].map(p=>{
     const n=document.elementFromPoint(p.x,p.y);
     return{tag:n?.tagName,classes:n?.getAttribute('class'),
      word:n?.closest('.word')?.dataset.index,rangeHandle:n?.closest('.range-handle')?.dataset.edge};
    }),
    words:[...document.querySelectorAll('.word')].map(n=>({
     index:n.dataset.index,selected:n.classList.contains('selected'),
     box:n.getBoundingClientRect().toJSON()
    }))
   }),{first:firstInk,second:secondInk});
   console.log('WORD_PAINTED_SELECTION_AUDIT '+JSON.stringify({selectedAfterTap,debug}));
  }
  assert.equal(selectedAfterTap,'2 selected',
   'Touching second painted glyph must extend the range to two words');
  await bar.waitFor({state:'visible'});
  assert.equal(await page.locator('.range-handle').count(),2,
   'An extended word range must retain both adjustable endpoints');
  assert.equal(await page.locator('#word-action-edit').isVisible(),false);
  await page.locator('#word-action-copy').click();
  await page.locator('#word-action-delete').click();
  await count(1);
  assert.equal(await bar.isVisible(),false,
   'The action strip must vanish after deletion');
  await page.keyboard.press('Control+z');
  await count(3);

  await page.locator('.word').first().click();
  await bar.waitFor({state:'visible'});
  await page.locator('#word-action-edit').click();
  await page.locator('#keyboard-panel').waitFor({state:'visible'});
  assert.equal(await bar.isVisible(),false,'Word editing must prioritize keyboard');
  assert.equal(await page.locator('#composer-title').textContent(),'Edit selected word');
  assert.deepEqual(errors,[]);
  console.log('PASS:',label,'word selection, formatting, multi-select, undo and keyboard');
 }finally{
  await context.close();await browser.close();
 }
}

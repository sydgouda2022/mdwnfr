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
   const dt=new DataTransfer();dt.setData('text/plain','𓂝𓎛 𓈖 𓂋 𓂝𓎛𓂝𓎛');
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
  await count(4);
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
  const firstWordId=await page.locator('.word').first().getAttribute('data-id');
  const drawnOrderFor=id=>page.locator('.word').evaluateAll((nodes,id)=>{
   const word=nodes.find(node=>node.dataset.id===id);
   return word?[...word.querySelectorAll('.glyph-ink-svg text')].map(n=>n.textContent):[];
  },id);
  const waitForDrawnOrderFor=(id,expected)=>page.waitForFunction(({id,expected})=>{
   const word=[...document.querySelectorAll('.word')].find(node=>node.dataset.id===id);
   const nodes=word?[...word.querySelectorAll('.glyph-ink-svg text')]:[];
   return nodes.length===expected.length&&nodes.every((node,i)=>node.textContent===expected[i]);
  },{id,expected},{timeout:90000});
  const drawnOrder=()=>drawnOrderFor(firstWordId);
  const waitForDrawnOrder=expected=>waitForDrawnOrderFor(firstWordId,expected);
  await stack.click();
  await page.waitForFunction(()=>document.getElementById('word-action-stack')?.textContent==='Unstack');
  // The action label updates from the session delta before asynchronous
  // reflow replaces the page's SVG. Wait for the rendered projection itself.
  await waitForDrawnOrder(['𓂝','𓎛']);
  assert.deepEqual(await drawnOrder(),['𓂝','𓎛']);
  // Verify the visible ink itself is centered, not merely the glyph-cell boxes.
  const inkCentersFor=id=>page.locator('.word').evaluateAll((nodes,id)=>{
   const word=nodes.find(node=>node.dataset.id===id);
   return word?[...word.querySelectorAll('.glyph-ink-svg text')].map(node=>{
    const ctx=document.createElement('canvas').getContext('2d');
    const size=Number(node.getAttribute('font-size'));
    ctx.font=size+'px "MdwNfr Hieroglyphs"';
    const metrics=ctx.measureText(node.textContent);
    if(!metrics.actualBoundingBoxRight||!metrics.actualBoundingBoxAscent)
     throw Error('Overlay glyph has no measurable visible ink');
    const x=Number(node.getAttribute('x'))+
     (metrics.actualBoundingBoxRight-metrics.actualBoundingBoxLeft)/2;
    const y=Number(node.getAttribute('y'))+
     (metrics.actualBoundingBoxDescent-metrics.actualBoundingBoxAscent)/2;
    const matrix=node.getScreenCTM();
    if(!matrix)throw Error('Overlay glyph has no screen transform');
    return{x:matrix.a*x+matrix.c*y+matrix.e,
     y:matrix.b*x+matrix.d*y+matrix.f};
   }):[];
  },id);
  const inkCenters=await inkCentersFor(firstWordId);
  assert.equal(inkCenters.length,2,'Both overlay signs must paint visible ink');
  assert.ok(Math.hypot(inkCenters[0].x-inkCenters[1].x,
   inkCenters[0].y-inkCenters[1].y)<=1.5,
   'The visible ink centers, not only their em boxes, must align');
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
  await count(2);
  assert.equal(await bar.isVisible(),false,
   'The action strip must vanish after deletion');
  await page.keyboard.press('Control+z');
  await count(4);

  // A longer word exposes an explicit adjacent-pair picker. Logical
  // reading order remains unchanged when the second pair is overlaid.
  const longWord=page.locator('.word').nth(3);
  const longWordId=await longWord.getAttribute('data-id');
  await longWord.click();
  await bar.waitFor({state:'visible'});
  const pairPicker=page.locator('#word-action-pair');
  assert.equal(await pairPicker.isVisible(),true);
  assert.deepEqual(await pairPicker.locator('option').allTextContents(),['1–2','3–4']);
  await pairPicker.selectOption('2');
  await page.locator('#word-action-stack').click();
  await page.waitForFunction(()=>document.getElementById('word-action-stack')?.textContent==='Unstack');
  await waitForDrawnOrderFor(longWordId,['𓂝','𓎛','𓂝','𓎛']);
  assert.deepEqual(await drawnOrderFor(longWordId),['𓂝','𓎛','𓂝','𓎛']);
  await pairPicker.selectOption('0');
  await page.locator('#word-action-stack').click();
  await page.waitForFunction(()=>document.getElementById('word-action-stack')?.textContent==='Unstack');
  await waitForDrawnOrderFor(longWordId,['𓂝','𓎛','𓂝','𓎛']);
  assert.deepEqual(await drawnOrderFor(longWordId),['𓂝','𓎛','𓂝','𓎛']);

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

import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

for(const [name,engine,width,height] of [
 ['chromium-phone',chromium,390,844],
 ['webkit-ipad',webkit,1024,768]
]){
 const browser=await engine.launch({headless:true,args:engine===chromium?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,
  isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(45000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
   null,{timeout:180000});
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible'});
  await page.locator('#format-toggle').click();
  await page.locator('#insert-clipart').click();
  const panel=page.locator('#insert-sheet');
  await panel.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('aria-modal'),null,'No blocking modal dialog');
  assert.equal(await page.locator('#insert-sheet-cancel-top').count(),0,'No desktop X button');
  assert.equal(await page.locator('#insert-preview').count(),0,'No miniature document duplicate');
  assert.equal(await page.locator('#insert-sheet-confirm').textContent(),'Done');
  await page.locator('#artwork-grid .artwork-choice').first().waitFor({state:'visible'});
  await page.locator('#artwork-grid .artwork-choice').first().click();
  await page.waitForFunction(()=>Boolean(
   document.querySelector('#pages .draft-page-layer .draft-paper .draft-object'))&&
   !document.getElementById('insert-sheet-confirm').disabled,null,{timeout:90000});
  const draft=page.locator('#pages .draft-page-layer .draft-object');
  assert.equal(await draft.count(),1,'Draft object appears on the actual page');
  assert.equal(await page.locator('#pages .draft-source-hidden').count(),1,
   'Original page temporarily hidden under the draft reflow');
  const inspector=await panel.boundingBox(),viewport=page.viewportSize();
  assert.ok(inspector.width<viewport.width-(width>700?150:0),
   'Contextual inspector should leave the writing page accessible');
  const current=await draft.boundingBox();
  const startX=current.x+Math.min(24,current.width*.5);
  const startY=current.y+Math.min(24,current.height*.5);
  await page.mouse.move(startX,startY);
  await page.mouse.down();
  await page.mouse.move(startX+24,startY+24,{steps:5});
  const movement=await draft.evaluate(el=>el.style.transform);
  assert.ok(movement.includes('translate'),'Real selected object follows pointer, not outline');
  await page.mouse.up();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
   null,{timeout:90000});
  // Resize on the document. The Python compositor then reflows the page.
  const handle=draft.locator('.art-resize.bottom-right');
  await handle.hover();
  const r=await handle.boundingBox();const x=r.x+r.width/2,y=r.y+r.height/2;
  const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.className,{x,y});
  assert.ok(String(hit).includes('art-resize'),'Resize handle is actually hit-testable');
  const before=await draft.boundingBox();
  await page.mouse.down();
  await page.mouse.move(x+34,y+18,{steps:6});
  await page.mouse.up();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
   null,{timeout:90000});
  const resized=await page.locator('.draft-object').boundingBox();
  assert.ok(resized.width>before.width+1,'Actual object visibly resized');
  await page.locator('#insert-sheet-cancel').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  assert.equal(await page.locator('.draft-page-layer').count(),0,'Cancel removes draft page');
  assert.equal(await page.locator('.draft-source-hidden').count(),0,'Cancel restores normal page');
  assert.equal(await page.locator('#pages .clipart-object').count(),0,'Cancel does not insert');
  await page.locator('#format-toggle').click();
  await page.locator('#insert-cartouche').click();
  await page.locator('input[name="insert-cartouche-direction"][value="horizontal"]').check();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
   null,{timeout:90000});
  assert.ok(await page.locator('#pages .draft-page-layer .draft-object').count());
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  await page.locator('#pages .cartouche-object').first().waitFor({state:'visible',timeout:90000});
  assert.deepEqual(errors,[],'No uncaught JavaScript exceptions');
  console.log('PASS:',name,'iPad-first inspector, on-page moving and resizing, cancel and Done');
 }catch(error){
  console.error('ON-PAGE INSERT FAILURE:',name,error.message);
  await page.screenshot({path:'/tmp/mdwnfr-onpage-'+name+'.png'}).catch(()=>{});
  throw error;
 }finally{await context.close();await browser.close();}
}

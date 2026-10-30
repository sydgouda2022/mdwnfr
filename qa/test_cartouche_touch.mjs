import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

// Test actual touch pointer events, not Playwright's mouse.dblclick shortcut.
for(const [label,browserType,width,height] of [
 ['webkit-compact-iphone',webkit,375,667],
 ['chromium-iphone',chromium,390,844],
 ['webkit-ipad',webkit,1024,768]
]){
 const browser=await browserType.launch({headless:true,
  args:browserType===chromium?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({
  viewport:{width,height},isMobile:true,hasTouch:true,
  deviceScaleFactor:2,serviceWorkers:'block'
 });
 const page=await context.newPage();
 page.setDefaultTimeout(45000);
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
   null,{timeout:180000});
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible'});
  await page.locator('#format-toggle').click();
  await page.locator('#insert-cartouche').click();
  await page.locator('input[name="insert-cartouche-direction"][value="horizontal"]').check();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm')?.disabled,
   null,{timeout:90000});
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  const cart=page.locator('.cartouche-object').first();
  await cart.waitFor({state:'visible',timeout:90000});
  const at=await cart.boundingBox();
  assert.ok(at,'A new cartouche must have a visible hit target');
  const cx=at.x+at.width/2,cy=at.y+at.height/2;
  // Initial selection must not open an inspector or install text-only handles.
  await page.touchscreen.tap(cx,cy);
  assert.equal(await page.locator('#insert-dialog-backdrop').isVisible(),false);
  assert.equal(await page.locator('.range-handle').count(),0,
   'Text range handles must not block cartouche touch editing');
  const afterFirst=await page.evaluate(({x,y})=>{
   const node=document.elementFromPoint(x,y);
   return {tag:node?.tagName,classes:node?.getAttribute('class'),
    cartouche:node?.closest('.cartouche-object')?.dataset.id,
    handle:node?.closest('.art-resize')?.getAttribute('class'),
    panel:!!document.querySelector('#insert-screen-cartouche:not([hidden])')};
  },{x:cx,y:cy});
  console.log('CART_TOUCH_HIT',label,JSON.stringify({at,afterFirst}));
  // A second real finger tap must open the non-modal cartouche inspector.
  await page.touchscreen.tap(cx,cy);
  await page.locator('#insert-screen-cartouche').waitFor({state:'visible',timeout:15000});
  assert.equal(await page.locator('input[name="insert-cartouche-direction"]:checked').inputValue(),
   'horizontal','Reopening may not lose saved orientation');
  assert.equal(await page.locator('#insert-sheet-cancel-top').count(),0,
   'Mobile inspector must not acquire a desktop X close button');
  await page.locator('#insert-sheet-cancel').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  assert.equal(await cart.count(),1,'Cancel must leave the existing cartouche intact');
  assert.deepEqual(errors,[],'No uncaught browser errors');
  console.log('PASS:',label,'single touch selects, double touch reopens, cancel preserves object');
 } finally{
  await context.close();await browser.close();
 }
}

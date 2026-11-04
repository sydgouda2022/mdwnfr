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
  // Direct tap enters the nested keyboard, not an inspector window.
  await page.touchscreen.tap(cx,cy);
  await page.locator('#keyboard-panel').waitFor({state:'visible',timeout:15000});
  assert.equal(await page.locator('#insert-dialog-backdrop').isVisible(),false);
  assert.equal(await page.locator('.range-handle').count(),0,
   'Word selection handles may not block cartouche text entry');
  await page.locator('#keys .key').first().click();
  await page.locator('#suggestions .user-choice').first().click();
  await page.waitForFunction(()=>document.querySelector('.cartouche-word')!==null,
   null,{timeout:90000});
  assert.equal(await page.locator('.cartouche-word').count(),1,
   'A hieroglyph typed through the keyboard must appear inside the cartouche');
  // Closing the keyboard reveals contextual actions. The object specification
  // remains available through Edit rather than interrupting text entry.
  await page.locator('#keyboard-toggle').click();
  await page.locator('#object-quick-actions').waitFor({state:'visible'});
  await page.locator('#object-action-edit').click();
  await page.locator('#insert-screen-cartouche').waitFor({state:'visible',timeout:30000});
  assert.equal(await page.locator('input[name="insert-cartouche-direction"]:checked').inputValue(),
   'horizontal','Editing must preserve the existing cartouche orientation');
  await page.locator('#insert-sheet-cancel').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  assert.equal(await cart.count(),1,'Cancel must preserve cartouche and text');
  await page.locator('#object-quick-actions').waitFor({state:'visible'});
  await page.locator('#object-action-copy').click();
  await page.locator('#object-action-delete').click();
  await page.waitForFunction(()=>document.querySelectorAll('.cartouche-object').length===0,
   null,{timeout:90000});
  assert.equal(await page.locator('#object-quick-actions').isVisible(),false,
   'Deleting an object must dismiss its contextual actions');
  await page.keyboard.press('Control+z');
  await page.locator('.cartouche-object').first().waitFor({state:'visible',timeout:90000});
  assert.deepEqual(errors,[],'No uncaught browser errors');
  console.log('PASS:',label,'tap types nested word; Edit opens inspector; cancel preserves object');
 } finally{
  await context.close();await browser.close();
 }
}

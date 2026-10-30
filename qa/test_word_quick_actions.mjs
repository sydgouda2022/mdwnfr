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
   const dt=new DataTransfer();dt.setData('text/plain','𓅓𓏏 𓈖 𓂋');
   document.dispatchEvent(new ClipboardEvent('paste',{
    clipboardData:dt,bubbles:true,cancelable:true
   }));
  });
  const count=async n=>{
   await page.waitForFunction(n=>document.getElementById('wordcount')?.textContent===n+' words',
    n,{timeout:90000});
   await page.waitForFunction(n=>document.querySelectorAll('.word').length===n,
    n,{timeout:90000});
  };
  await count(3);
  await page.locator('.word').first().click();
  const bar=page.locator('#word-quick-actions');
  await bar.waitFor({state:'visible'});
  assert.equal(await page.locator('#object-quick-actions').isVisible(),false,
   'No object-toolbar duplication for words');
  assert.equal(await page.locator('#format-panel').isVisible(),false,
   'Selecting a quadrat must not open desktop-like Format');
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

  // Whole-word multi-select keeps formatting, but never edits a random word.
  await page.locator('.word').first().click();
  await page.locator('.word').nth(1).click({modifiers:['Shift']});
  await page.waitForFunction(()=>document.getElementById('selection-summary')?.textContent==='2 selected');
  await bar.waitFor({state:'visible'});
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

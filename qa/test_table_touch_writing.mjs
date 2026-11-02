import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

// A real cell touch must reach the existing canonical nested-word commit path,
// not only select a table or launch the Insert sheet.
for(const [name,engine,width,height] of [
 ['chromium-iphone',chromium,390,844],
 ['webkit-ipad',webkit,1024,768]
]){
 const browser=await engine.launch({headless:true,
  args:engine===chromium?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({viewport:{width,height},
  isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(45000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const saved=()=>page.evaluate(async()=>{
  const db=await new Promise((ok,bad)=>{
   const r=indexedDB.open('mdwnfr-canonical-v1',1);
   r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);
  });
  try{return await new Promise((ok,bad)=>{
   const r=db.transaction('documents','readonly').objectStore('documents').getAll();
   r.onsuccess=()=>ok(r.result[0]);r.onerror=()=>bad(r.error);
  });}finally{db.close();}
 });
 try{
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
    null,{timeout:180000});
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible'});
  await page.locator('#format-toggle').click();
  await page.locator('#insert-table').click();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm')?.disabled,
   null,{timeout:90000});
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  const cell=page.locator('.table-object .table-cell-view').first();
  await cell.waitFor({state:'visible',timeout:90000});
  await cell.click();
  await page.locator('#keyboard-panel').waitFor({state:'visible'});
  assert.equal(await page.locator('#insert-dialog-backdrop').isVisible(),false);
  // The Python edit becomes visible before IndexedDB's debounced save.
  // Observe durable state, not a race with the autosave timer.
  let before;
  for(let i=0;i<100;i++){
   before=await saved();
   if(before?.items?.some(o=>o.type==='table'))break;
   await page.waitForTimeout(150);
  }
  const table=before.items.find(o=>o.type==='table');
  assert.ok(table,'Table insertion must persist before the next transaction');
  assert.equal(table.rows[0][0].items.length,0);
  await page.locator('#keys .key').first().click();
  await page.locator('#suggestions .user-choice').first().click();
  let latest;
  for(let i=0;i<100;i++){
   latest=await saved();
   const t=latest.items.find(o=>o.id===table.id);
   if(t?.rows[0][0].items.length===1)break;
   await page.waitForTimeout(150);
  }
  assert.equal(latest.items.find(o=>o.id===table.id).rows[0][0].items.length,1,
   'Direct table keyboard input must save a nested word');
  assert.equal(latest.revision,before.revision+1,
   'Table editing must produce one atomic revision');
  await page.keyboard.press('Control+z');
  for(let i=0;i<100;i++){
   latest=await saved();
   if(!latest.items.find(o=>o.id===table.id).rows[0][0].items.length)break;
   await page.waitForTimeout(150);
  }
  assert.equal(latest.items.find(o=>o.id===table.id).rows[0][0].items.length,0,
   'Undo must remove only the nested word');
  assert.deepEqual(errors,[]);
  console.log('PASS:',name,'table cell tap, keyboard commit, persistence, undo');
 }catch(err){
  console.error('NESTED TABLE FAILURE:',name,err.message);
  await page.screenshot({path:'/tmp/mdwnfr-table-nested-'+name+'.png'}).catch(()=>{});
  throw err;
 }finally{await context.close();await browser.close();}
}

import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

// Exercise nested writing in both native touch-size layouts on the actual
// Python layout worker, including edits before the object is inserted.
for(const [label,engine,width,height] of [
 ['chromium-iphone',chromium,390,844],
 ['webkit-ipad',webkit,1024,768]
]){
 const browser=await engine.launch({headless:true,args:engine===chromium?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,
  deviceScaleFactor:2,serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 try{
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
   null,{timeout:180000});
  await page.locator('#create-document').click();
  await page.locator('#format-toggle').click();
  await page.locator('#insert-cartouche').click();
  await page.locator('#insert-cartouche-words').fill('𓅓 𓏏');
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm')?.disabled,
   null,{timeout:90000});
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  await page.locator('.cartouche-word').first().waitFor({state:'visible',timeout:90000});
  assert.equal(await page.locator('.cartouche-word').count(),2);
  await page.locator('#format-toggle').click();
  await page.locator('#insert-table').click();
  await page.locator('#insert-table-cell-input').fill('𓅓𓏏');
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm')?.disabled,
   null,{timeout:90000});
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  const tableDiagnostics=await page.evaluate(async()=>{
   const nodes=Array.from(document.querySelectorAll('.table-object'));
   const glyphs=Array.from(document.querySelectorAll('.table-cell-word'));
   const pages=Array.from(document.querySelectorAll('.paper')).map(e=>({visibility:getComputedStyle(e).visibility,classes:e.className}));
   let saved=null;
   try{
    const storage=await import('/storage.js');
    const docs=await storage.list();
    saved=await Promise.all(docs.map(async item=>{
     const d=await storage.load(item.id);
     return {id:item.id,revision:d?.revision,table:d?.items?.filter(x=>x.type==='table').map(x=>x.rows.map(row=>row.map(cell=>(cell.items||[]).map(w=>w.signs.join('')))))};
    }));
   }catch(err){saved={error:String(err)};}
   return {tableCount:nodes.length,wordCount:glyphs.length,
    wordStates:glyphs.map(e=>({visible:getComputedStyle(e).visibility,rect:e.getBoundingClientRect().toJSON()})),
    tableGeometry:nodes.map(e=>({classes:e.className,inner:e.querySelectorAll('.table-cell-view').length,html:e.outerHTML.slice(0,420)})),
    pages,saved};
  });
  console.log('NESTED_TABLE_DIAGNOSTICS',label,JSON.stringify(tableDiagnostics));
  await page.locator('.table-cell-word').first().waitFor({state:'visible',timeout:90000});
  await page.locator('.table-cell-view').first().dblclick();
  await page.locator('#insert-table-cell-input').waitFor({state:'visible'});
  assert.equal(await page.locator('#insert-table-cell-input').inputValue(),'𓅓𓏏');
  await page.locator('#insert-sheet-cancel').click();
  assert.deepEqual(errors,[]);
  console.log('PASS',label,'nested table and cartouche text entry');
 }finally{await context.close();await browser.close();}
}
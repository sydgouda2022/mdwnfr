import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const origin='http://127.0.0.1:8123/';
for(const [label,engine] of [['chromium-phone',chromium],['webkit-ipad',webkit]]){
 const browser=await engine.launch({headless:true,args:label.startsWith('chromium')?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({
  viewport:label.startsWith('chromium')?{width:390,height:844}:{width:1024,height:768},
  acceptDownloads:true,serviceWorkers:'block'
 });
 const page=await context.newPage();
 page.setDefaultTimeout(30000);
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#create-document')?.disabled===false,null,{timeout:180000});
  assert.equal(await page.locator('#library-import').isEnabled(),true);
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
  if(label.startsWith('chromium'))assert.equal(await page.locator('#zoom').inputValue(),'1');
  await page.locator('#library').click();
  await page.locator('#library-screen').waitFor({state:'visible',timeout:90000});
  await page.locator('#doc-list .document-more').first().click();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#doc-list .document-menu:not([hidden]) .document-action').filter({hasText:'Export file'}).click();
  const download=await downloadEvent;
  assert.ok(download.suggestedFilename().endsWith('.mdwnfr'));
  const saved=await download.path();
  assert.ok(saved,'Exported editable file must exist');

  await page.locator('#library-import-file').setInputFiles(saved);
  await page.waitForFunction(()=>document.querySelectorAll('#doc-list .document-card').length===2,null,{timeout:90000});
  assert.match(await page.locator('#doc-list').textContent(),/imported/);

  await page.locator('#library-import-file').setInputFiles({
   name:'invalid.mdwnfr',mimeType:'application/json',
   buffer:Buffer.from(JSON.stringify({schema:2,items:[]}))
  });
  await page.waitForFunction(()=>document.querySelector('#library-error')?.textContent?.includes('Import failed'),null,{timeout:30000});
  assert.equal(await page.locator('#doc-list .document-card').count(),2);
  await page.locator('#doc-list .document-more').first().click();
  await page.locator('#doc-list .document-menu:not([hidden]) .delete-action').click();
  await page.locator('#dialog-ok').click();
  await page.waitForFunction(()=>document.querySelectorAll('#doc-list .document-card').length===1);
  await page.locator('#library-trash').click();
  await page.locator('#library-trash-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#library-trash-items .trash-entry').count(),1);
  await page.locator('#library-trash-items .trash-entry button').filter({hasText:'Restore'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#doc-list .document-card').length===2);
  await page.locator('#library-trash-close').click();
  assert.equal(await page.locator('#library-trash-dialog').isVisible(),false);

  const nestedCount=await page.evaluate(async()=>{
   const {countWords}=await import('/storage.js');
   return countWords([{type:'word'},
    {type:'cartouche',items:[{type:'word'}]},
    {type:'table',rows:[[{mode:'text',items:[{type:'word'}]}]]}]);
  });
  assert.equal(nestedCount,3);
  assert.deepEqual(errors,[],'No JavaScript exceptions during backup and Trash workflow');
  console.log('PASS '+label+' editable export/import, strict validation, recoverable Trash, nested word counts');
 }finally{await browser.close();}
}

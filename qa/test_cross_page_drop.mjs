import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

// Real published editor, Python compositor, IndexedDB document and pointer
// events. Seed a valid long document once to avoid 800 individual UI taps;
// the object itself is inserted and moved through the real touch-first UI.
for(const [name,engine,width,height] of [
 ['chromium-phone',chromium,390,844],
 ['webkit-ipad',webkit,1024,768]
]){
 const browser=await engine.launch({headless:true,
  args:engine===chromium?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({viewport:{width,height},
  isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
 const page=await context.newPage();
 page.setDefaultTimeout(45000);
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const read=()=>page.evaluate(async()=>{
  const db=await new Promise((ok,bad)=>{
   const r=indexedDB.open('mdwnfr-documents',1);
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
  await page.locator('#insert-clipart').click();
  await page.locator('#artwork-grid .artwork-choice').first().click();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm')?.disabled,
   null,{timeout:90000});
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  for(let i=0;i<60;i++){
   if((await read())?.items?.[0]?.type==='clipart')break;
   await page.waitForTimeout(150);
  }
  const original=await read();
  assert.equal(original.items[0].type,'clipart');
  const artworkId=original.items[0].id;
  await page.locator('#library').click();
  await page.locator('#library-screen').waitFor({state:'visible'});

  // Seed the canonical persistent record and library index in one IDB
  // transaction while the editor is CLOSED. Every word and sign has a
  // stable ID; the Python engine still validates and composes the result.
  await page.evaluate(async()=>{
   const db=await new Promise((ok,bad)=>{
    const r=indexedDB.open('mdwnfr-documents',1);
    r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);
   });
   try{
    await new Promise((ok,bad)=>{
     const tx=db.transaction(['documents','document-index'],'readwrite');
     const docs=tx.objectStore('documents'),index=tx.objectStore('document-index');
     const req=docs.getAll();
     req.onsuccess=()=>{
      const document=req.result[0];
      document.font_size_pt=26;
      for(let i=0;i<860;i++){
       document.items.push({
        id:'qa-word-'+i,type:'word',
        signs:i%2?['𓅓','𓏏']:['𓈖'],
        symbol_ids:i%2?['qa-atom-'+i+'-0','qa-atom-'+i+'-1']:['qa-atom-'+i+'-0'],
        color:'#192433',bold:false,lexicon_ref:null
       });
      }
      document.revision++;
      docs.put(document);
      index.put({id:document.id,name:document.name,revision:document.revision,
       surface:document.surface,direction:document.direction,
       item_count:document.items.length,word_count:860,
       created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
     };
     tx.oncomplete=ok;tx.onerror=()=>bad(tx.error);
     tx.onabort=()=>bad(tx.error);
    });
   }finally{db.close();}
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
   null,{timeout:180000});
  await page.locator('#doc-list .document-open').first().click();
  await page.locator('#editor-screen').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('.page-shell').length>=4,
   null,{timeout:120000});
  const count=await page.locator('.page-shell').count(),destinationIndex=3;
  assert.ok(count>=4,'Fixture should create multiple fixed-paper pages');
  const summary=await page.locator('.page-shell[data-page-index="3"]').getAttribute('data-page-index');
  assert.equal(summary,'3');
  const originalWordOrder=(await read()).items.filter(o=>o.type==='word').map(o=>o.id);

  await page.locator('[data-id="'+artworkId+'"]').first()
   .waitFor({state:'visible',timeout:60000});
  await page.locator('[data-id="'+artworkId+'"]').first().click();
  const art=page.locator('[data-id="'+artworkId+'"] .art-move').first();
  await art.waitFor({state:'visible',timeout:60000});
  await art.hover();
  const grip=await art.boundingBox();
  assert.ok(grip?.width>=43.9&&grip?.height>=43.9);
  const initialRevision=(await read()).revision;
  const sx=grip.x+grip.width/2,sy=grip.y+grip.height/2;
  await page.mouse.move(sx,sy);
  await page.mouse.down();
  await page.mouse.move(sx+6,sy+14,{steps:5});
  // Mimic user scrolling while holding an object. The target page was
  // originally far outside the detailed-page virtualization window.
  await page.evaluate(index=>{
   const scroller=document.querySelector('#canvas-area');
   const dest=document.querySelector('.page-shell[data-page-index="'+index+'"]');
   scroller.scrollTop+=dest.getBoundingClientRect().top-
                       scroller.getBoundingClientRect().top-90;
  },destinationIndex);
  const target=page.locator('.page-shell[data-page-index="3"]');
  const r=await target.boundingBox();
  assert.ok(r&&r.height>100,'Destination shell should be present even if details are unloaded');
  const tx=r.x+r.width*.48,ty=Math.max(r.y+80,Math.min(r.y+r.height-80,r.y+r.height*.43));
  await page.mouse.move(tx,ty,{steps:10});
  await page.mouse.up();
  let updated;
  for(let i=0;i<160;i++){
   updated=await read();
   if(updated?.revision===initialRevision+1)break;
   await page.waitForTimeout(150);
  }
  assert.equal(updated?.revision,initialRevision+1,
   'Cross-page gesture must save exactly one transaction');
  assert.ok(updated.items.findIndex(o=>o.id===artworkId)>0,
   'Object should move into destination page reading order, not stay at the source');
  assert.equal(updated.items.filter(o=>o.id===artworkId).length,1,
   'Object identity must remain unique across pages');
  assert.deepEqual(updated.items.filter(o=>o.type==='word').map(o=>o.id),
   originalWordOrder,'Moving artwork cannot reorder or discard words');
  await page.waitForFunction(()=>
   !document.querySelector('.draft-page-layer'),null,{timeout:120000});
  assert.deepEqual(errors,[]);
  console.log('PASS:',name,'cross-page pointer drop relocated persistent object',
   'page_count='+count,'index='+updated.items.findIndex(o=>o.id===artworkId));
 }catch(error){
  console.error('CROSS-PAGE FAILURE',name,error.message);
  await page.screenshot({path:'/tmp/mdwnfr-cross-page-'+name+'.png'}).catch(()=>{});
  throw error;
 }finally{await context.close();await browser.close();}
}

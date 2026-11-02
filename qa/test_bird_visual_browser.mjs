import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

// Visual acceptance of the ACTUAL packaged Python/DOM editor. Screenshots are
// diagnostic, while assertions check assets, physical positions and use of
// clear sectors around the artwork. No browser-side typesetting oracle.
for(const [name,engine,width,height,direction] of [
 ['chromium-iphone-rtl',chromium,390,844,'rtl'],
 ['webkit-ipad-ltr',webkit,1024,768,'ltr'],
]){
 const browser=await engine.launch({headless:true,
  args:engine===chromium?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({viewport:{width,height},
  isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
 const page=await context.newPage();
 page.setDefaultTimeout(50000);
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const ids={horus:'ink-check-horus',bennu:'ink-check-bennu'};
 try{
  await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
   null,{timeout:180000});
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible'});
  await page.locator('#library').click();
  await page.locator('#library-screen').waitFor({state:'visible'});

  // Seed exactly the same schema the Python editor emits. Local-only fixture
  // creation runs while the document is CLOSED, then the real session opens
  // and validates its content and produces the authoritative page geometry.
  await page.evaluate(async ({ids,direction})=>{
   const database=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('mdwnfr-canonical-v1',1);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
   });
   try{
    await new Promise((resolve,reject)=>{
     const tx=database.transaction(['documents','document-index'],'readwrite');
     const docs=tx.objectStore('documents'),index=tx.objectStore('document-index');
     const req=docs.getAll();
     req.onsuccess=()=>{
      const document=req.result[0];
      document.surface='A4';
      document.direction=direction;
      document.font_size_pt=22;
      const spellings=[['𓅓','𓏏'],['𓈖'],['𓇋','𓏏'],['𓏺']];
      const items=[];
      let count=0;
      const addWords=n=>{
       for(let k=0;k<n;k++,count++){
        const signs=spellings[count%spellings.length];
        items.push({id:'ink-check-word-'+count,type:'word',
         signs:[...signs],symbol_ids:signs.map((_,j)=>'ink-check-atom-'+count+'-'+j),
         color:'#192433',bold:false,lexicon_ref:null});
       }
      };
      const addBird=(id,artwork_id,y_align)=>{
       items.push({id,type:'clipart',artwork_id,width_mm:60,
        flip:'auto',x_align:.5,y_align,x_offset_mm:0});
      };
      addWords(18);addBird(ids.horus,'horus-falcon-raster',.22);
      addWords(185);addBird(ids.bennu,'bennu',.29);addWords(280);
      document.items=items;document.revision+=1;
      docs.put(document);
      index.put({id:document.id,name:document.name,revision:document.revision,
       surface:document.surface,direction:document.direction,
       item_count:items.length,word_count:count,
       created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
     };
     tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
     tx.onabort=()=>reject(tx.error);
    });
   }finally{database.close();}
  },{ids,direction});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,
   null,{timeout:180000});
  await page.locator('#doc-list .document-open').first().click();
  await page.locator('#editor-screen').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('.page-shell').length>1,
   null,{timeout:120000});
  const shells=page.locator('.page-shell');
  for(const [bird,id] of Object.entries(ids)){
   const selector='[data-id="'+id+'"]';
   let found=false;
   for(let index=0;index<await shells.count();index++){
    const shell=shells.nth(index);
    await shell.scrollIntoViewIfNeeded();
    // The worker paints only visible page details on demand.
    for(let attempt=0;attempt<24;attempt++){
     if(await page.locator(selector+'.clipart-object').count()){
      found=true;break;
     }
     await page.waitForTimeout(150);
    }
    if(found)break;
   }
   assert.ok(found,bird+' artwork must appear on a visible rendered page');
   const artwork=page.locator(selector+'.clipart-object').first();
   await artwork.scrollIntoViewIfNeeded();
   await artwork.waitFor({state:'visible',timeout:30000});
   const painted=await page.evaluate(id=>{
    const art=document.querySelector('[data-id="'+id+'"].clipart-object');
    const paper=art?.closest('.paper');
    const image=art?.querySelector('img');
    const bounds=art?.getBoundingClientRect();
    if(!paper||!image||!bounds)return null;
    const wordRects=[...paper.querySelectorAll('.word')].map(node=>
     node.getBoundingClientRect()).filter(rect=>
     rect.left<bounds.right&&rect.right>bounds.left);
    return {width:bounds.width,height:bounds.height,
     src:image.getAttribute('src'),ready:image.complete&&image.naturalWidth>0,
     horizontalColumns:wordRects.length,
     above:wordRects.filter(rect=>rect.bottom<=bounds.top-2).length,
     below:wordRects.filter(rect=>rect.top>=bounds.bottom+2).length,
     paperIndex:paper.parentElement?.dataset.pageIndex??null};
   },id);
   assert.ok(painted?.ready,bird+' must load its actual bundled artwork PNG');
   assert.ok(painted.width>15&&painted.height>15,
    bird+' must have nonzero painted size');
   assert.ok(painted.src?.includes(bird==='horus'?'horus':'bennu'),
    bird+' image must match its canonical artwork ID');
   assert.ok(painted.horizontalColumns>0,
    bird+' must share horizontal writing area with real text');
   // Python proves precise in-mask clearance. Browser assertions ensure the
   // correctly reused upper/lower space is visible in DOM rather than hidden.
   assert.ok(painted.above>0,bird+' must show text in upper clear sector');
   assert.ok(painted.below>0,bird+' must show text in lower clear sector');
   await page.screenshot({path:'/tmp/mdwnfr-ink-'+name+'-'+bird+'.png'});
   console.log('PASS:',name,bird,'visible ink above/below art',JSON.stringify(painted));
  }
  assert.deepEqual(errors,[]);
 }catch(err){
  console.error('BIRD VISUAL FAILURE:',name,err.message);
  await page.screenshot({path:'/tmp/mdwnfr-ink-'+name+'-failure.png'}).catch(()=>{});
  throw err;
 }finally{await context.close();await browser.close();}
}

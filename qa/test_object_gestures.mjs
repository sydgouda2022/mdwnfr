import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 for(const width of [390,1024]){
  const browser=await engine.launch({headless:true,args:name==='chromium'?['--disable-dev-shm-usage']:[]});
  const context=await browser.newContext({viewport:{width,height:width===390?844:768},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(45000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto('http://127.0.0.1:8123/',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,null,{timeout:180000});
   await page.locator('#create-document').click();
   await page.locator('#editor-screen').waitFor({state:'visible'});
   const saved=()=>page.evaluate(async()=>{
    const db=await new Promise((ok,bad)=>{const r=indexedDB.open('mdwnfr-canonical-v1',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)});
    try{return await new Promise((ok,bad)=>{
     const r=db.transaction('documents','readonly').objectStore('documents').getAll();
     r.onsuccess=()=>ok(r.result[0]);r.onerror=()=>bad(r.error)
    })}finally{db.close()}
   });
   const waitPersist=async(fn)=>{
    for(let i=0;i<80;i++){const d=await saved();if(d&&fn(d))return d;await page.waitForTimeout(100)}
    throw Error('Document change did not persist');
   };
   const insert=async(kind)=>{
    if(!await page.locator('#format-panel').isVisible())await page.locator('#format-toggle').click();
    await page.locator('#insert-'+kind).click();
    if(kind==='clipart'){
     await page.locator('#artwork-grid .artwork-choice').first().waitFor({state:'visible'});
     await page.locator('#artwork-grid .artwork-choice').first().click();
    }else if(kind==='image'){
     await page.locator('#insert-image-file').setInputFiles({name:'picture.png',mimeType:'image/png',
      buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGOUcOr9z4AEmBjQAGEBAHwtAe6/I+HPAAAAAElFTkSuQmCC','base64')});
    }
    await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,null,{timeout:90000});
    await page.locator('#insert-sheet-confirm').click();
    await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
    await waitPersist(d=>d.items.some(o=>o.type===kind));
   };
   for(const kind of ['table','cartouche','clipart','image']){
    await insert(kind);
    const doc=await saved(),obj=doc.items.find(o=>o.type===kind);
    assert.ok(obj,kind+' must persist');
    const node=page.locator('[data-id="'+obj.id+'"]').first();
    await node.waitFor({state:'visible',timeout:90000});
    if(kind==='table')await node.locator('.table-cell-view').first().click();
    else await node.click();
    const handle=node.locator('.art-resize.right');
    await handle.waitFor({state:'visible'});
    const rect=await handle.boundingBox();
    assert.ok(rect?.width>=43.9&&rect?.height>=43.9,kind+' handle below 44px');
    const previous=kind==='cartouche'?(obj.enclosure_padding_mm||0):(obj.width_mm||0);
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const hit=await page.evaluate(({x,y})=>{
      const el=document.elementFromPoint(x,y);
      return {name:el?.className,id:el?.closest('[data-id]')?.dataset.id,
        classNames:el?.getAttribute('class')};
    },{x,y});
    console.log('GESTURE_START',JSON.stringify({engine:name,width,kind,id:obj.id,
      original:previous,box:rect,hit}));
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+32,y,{steps:7});await page.mouse.up();
    console.log('GESTURE_END',JSON.stringify({
      status:await page.locator('#state').textContent().catch(()=>null),
      saved:await saved()
    }).slice(0,1000));
    const updated=await waitPersist(d=>{
     const o=d.items.find(v=>v.id===obj.id);
     return (kind==='cartouche'?(o?.enclosure_padding_mm||0):(o?.width_mm||0))>previous;
    });
    assert.ok(updated.items.find(o=>o.id===obj.id),'Object ID must be stable');
    assert.equal(await page.locator('.object-resize-ghost').count(),0);
    console.log('PASS:',name,width,kind,'resize persisted');
   }
   assert.deepEqual(errors,[]);
  }catch(e){
   console.error('GESTURE FAILURE',name,width,e.message);
   await page.screenshot({path:'/tmp/mdwnfr-gestures-'+name+'-'+width+'.png'}).catch(()=>{});
   throw e;
  }finally{await context.close();await browser.close();}
 }
}

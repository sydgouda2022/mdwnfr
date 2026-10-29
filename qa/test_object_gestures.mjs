import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 for(const width of [390,1024]){
  const browser=await engine.launch({headless:true,args:name==='chromium'?['--disable-dev-shm-usage']:[]});
  const context=await browser.newContext({viewport:{width,height:width===390?844:768},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(45000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',msg=>{if(msg.text().startsWith('RESIZE_COMMIT_DEBUG'))console.log(msg.text())});
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
    // Format floats over the page; dismiss it before direct manipulation.
    if(await page.locator('#format-panel').isVisible())
     await page.locator('#format-toggle').click();
    const handle=node.locator('.art-resize.bottom-right');
    await handle.waitFor({state:'visible'});
    await page.waitForTimeout(180);
    const previous=kind==='cartouche'?(obj.enclosure_padding_mm||0):(obj.width_mm||0);
    let rect,x,y,hit;
    for(let attempt=0;attempt<4;attempt++){
     rect=await handle.boundingBox();
     assert.ok(rect?.width>=43.9&&rect?.height>=43.9,kind+' handle below 44px');
     x=rect.x+rect.width/2;y=rect.y+rect.height/2;
     await page.mouse.move(x,y);
     hit=await page.evaluate(({x,y})=>{
      const el=document.elementFromPoint(x,y);
      return {classNames:el?.getAttribute('class'),id:el?.closest('[data-id]')?.dataset.id};
     },{x,y});
     if((hit.classNames||'').includes('art-resize bottom-right')&&hit.id===obj.id)break;
     await page.waitForTimeout(120);
    }
    assert.ok((hit.classNames||'').includes('art-resize bottom-right')&&hit.id===obj.id,
      kind+' resize handle occluded or moved: '+JSON.stringify(hit));
    // Playwright waits for a moving DOM target to become stable before
    // hovering. A stale boundingBox from the previous Python reflow would
    // otherwise start a text-object drag instead of grabbing the handle.
    await handle.hover({timeout:30000});
    const stabilized=await handle.boundingBox();
    x=stabilized.x+stabilized.width/2;
    y=stabilized.y+stabilized.height/2;
    const actual=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.getAttribute('class'),{x,y});
    assert.ok((actual||'').includes('art-resize bottom-right'),
      'Resize handle changed before pointer-down: '+actual);
    console.log('GESTURE_START',JSON.stringify({engine:name,width,kind,original:previous,hit,rect:stabilized}));
    await page.mouse.down();
    await page.mouse.move(x+32,y,{steps:7});await page.mouse.up();
    await page.waitForTimeout(350);
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
    // A cancelled touch gesture must never become a committed edit, even if
    // its intermediate movement has started an asynchronous Python preview.
    // Dispatch touch PointerEvents explicitly: page.mouse only tests mouse
    // pointer events, even when the context advertises a touch screen.
    const beforeCancel=structuredClone(updated.items.find(o=>o.id===obj.id));
    const revisionBeforeCancel=updated.revision;
    await page.locator('[data-id="'+obj.id+'"] .art-resize.bottom-right')
     .waitFor({state:'visible',timeout:90000});
    const cancelGeometry=await page.evaluate(id=>{
     const node=[...document.querySelectorAll('[data-id]')]
      .find(el=>el.dataset.id===id&&el.querySelector('.art-resize.bottom-right'));
     if(!node)throw Error('Missing real object to test cancellation');
     const handle=node.querySelector('.art-resize.bottom-right');
     const before=node.style.cssText;
     const r=handle.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
     const pointerId=907;
     const init=(clientX,clientY)=>({bubbles:true,cancelable:true,
       pointerId,pointerType:'touch',isPrimary:true,button:0,
       clientX,clientY});
     handle.dispatchEvent(new PointerEvent('pointerdown',init(x,y)));
     window.dispatchEvent(new PointerEvent('pointermove',init(x+35,y+13)));
     window.dispatchEvent(new PointerEvent('pointercancel',init(x+35,y+13)));
     return {before,after:node.style.cssText};
    },obj.id);
    assert.equal(cancelGeometry.after,cancelGeometry.before,
     kind+' cancelled gesture must restore the original DOM geometry');
    await page.waitForTimeout(500); // let stale debounced preview requests settle
    const afterCancel=await saved();
    assert.equal(afterCancel.revision,revisionBeforeCancel,
     kind+' pointercancel must not commit a transaction');
    assert.deepEqual(afterCancel.items.find(o=>o.id===obj.id),beforeCancel,
     kind+' pointercancel must not change object geometry or identity');
    assert.equal(await page.locator('.draft-page-layer').count(),0,
     kind+' pointercancel must remove any transient preview');
    console.log('PASS:',name,width,kind,'resize persisted and touch cancellation reverted');
   }
   assert.deepEqual(errors,[]);
  }catch(e){
   console.error('GESTURE FAILURE',name,width,e.message);
   await page.screenshot({path:'/tmp/mdwnfr-gestures-'+name+'-'+width+'.png'}).catch(()=>{});
   throw e;
  }finally{await context.close();await browser.close();}
 }
}

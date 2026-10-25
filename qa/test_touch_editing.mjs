import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.MDWNFR_QA_URL||'http://127.0.0.1:8123/';
const engines=(process.env.MDWNFR_QA_ENGINES||'chromium,webkit').split(',');
const results=[];
for(const engineName of engines){
 const browser=await ({chromium,webkit}[engineName]).launch({headless:true});
 try{
  for(const viewport of [{width:390,height:844},{width:1024,height:768}]){
   const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block'});
   // Exercise the Safari-style denied-system-clipboard path deliberately.
   // Native clipboard events are tested separately below, without mocking Python.
   await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    writeText:async()=>{throw new DOMException('Not allowed','NotAllowedError');},
    readText:async()=>{throw new DOMException('Not allowed','NotAllowedError');}
   }}));
   const page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   page.setDefaultTimeout(45000);
   const count=async n=>{
    await page.waitForFunction(n=>document.getElementById('wordcount')?.textContent===n+' words',n,{timeout:90000});
    // The Python layout worker publishes asynchronously after the transaction.
    await page.waitForFunction(n=>document.querySelectorAll('.word').length===n,n,{timeout:90000});
   };
   const shortcut=async(letter,{meta=false,shift=false,key='ش'}={})=>page.evaluate(({letter,meta,shift,key})=>{
    document.dispatchEvent(new KeyboardEvent('keydown',{code:'Key'+letter,key,ctrlKey:!meta,metaKey:meta,shiftKey:shift,bubbles:true,cancelable:true}));
   },{letter,meta,shift,key});
   const pasteText=async text=>page.evaluate(text=>{
    const transfer=new DataTransfer();transfer.setData('text/plain',text);
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
   },text);
   const closeFormat=async()=>{if(await page.locator('#format-panel').isVisible())await page.locator('#format-toggle').click();};
   const hold=async(locator)=>{
    const box=await locator.boundingBox();assert.ok(box);
    const point={pointerId:71,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:box.x+box.width/2,clientY:box.y+box.height/2};
    await locator.dispatchEvent('pointerdown',point);
    await page.locator('#edit-menu').waitFor({state:'visible'});
    await locator.dispatchEvent('pointerup',{...point,buttons:0});
   };
   try{
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('#create-document').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,null,{timeout:180000});
    await page.locator('#create-document').click();
    await page.locator('#editor-screen').waitFor({state:'visible'});
    assert.equal(await page.locator('#font-size').inputValue(),'10','New documents must start at 10');
    await pasteText('𓅓𓏏 𓈖 𓂋');await count(3);
    await page.locator('.word').first().waitFor({state:'visible'});
    await page.locator('.word').first().click();
    await page.locator('#format-toggle').click();
    const layout=await page.evaluate(()=>{
     const panel=document.getElementById('format-panel'),r=panel.getBoundingClientRect();
     const groups=[...document.querySelectorAll('[data-format-group]')].map(x=>x.dataset.formatGroup);
     const bad=[...document.querySelectorAll('#format-main .format-control,#font-size,#font-family,#surface')]
      .filter(el=>!el.hidden&&el.getClientRects().length).map(el=>({id:el.id,r:el.getBoundingClientRect()}))
      .filter(({r})=>r.width<43.9||r.height<43.9).map(({id,r})=>({id,width:r.width,height:r.height}));
     return {groups,width:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,bad,viewport:{width:innerWidth,height:innerHeight}};
    });
    assert.deepEqual(layout.groups,['size','colors','history','font','surface','direction','insert']);
    assert.equal(await page.locator('#format-panel #surface').count(),1,'Writing surface belongs in Format');
    assert.equal(await page.locator('#pages-panel select,#pages-panel input').count(),0,'Pages contains only navigation');
    assert.ok(layout.width<=260,'The inspector must be slim');
    assert.ok(layout.left>=0&&layout.right<=viewport.width&&layout.top>=0&&layout.bottom<=viewport.height);
    assert.deepEqual(layout.bad,[],'All editing targets must be at least 44 CSS px');
    assert.equal(await page.locator('#font-family option').count(),1);
    await page.locator('#color-picker').click();
    await page.locator('#format-colors').waitFor({state:'visible'});
    assert.equal(await page.locator('#format-main').isVisible(),false,'Colors replace the same inspector');
    assert.equal(await page.locator('.egyptian-swatch').count(),24);
    const small=await page.locator('.egyptian-swatch').evaluateAll(els=>els.filter(el=>{const r=el.getBoundingClientRect();return r.width<43.9||r.height<43.9;}).length);
    assert.equal(small,0,'Egyptian color choices need finger-sized targets');
    await page.locator('.egyptian-swatch[data-color="#1f4ba8"]').click();
    await page.waitForFunction(()=>{const t=document.querySelector('.word .glyph-ink-svg text');return t&&getComputedStyle(t).fill==='rgb(31, 75, 168)';});
    await page.locator('#color-back').click();
    assert.equal(await page.locator('#format-main').isVisible(),true);
    await closeFormat();
    await shortcut('B');
    await page.waitForFunction(()=>document.getElementById('bold').getAttribute('aria-pressed')==='true');
    // Touch menu exposes all five actions and a real Cut can be undone.
    await hold(page.locator('.word').first());
    // Shortcut hints vary by platform, so assert semantic labels separately.
    assert.deepEqual(await page.locator('#edit-menu button').evaluateAll(els=>els.map(x=>x.getAttribute('aria-label'))),['Cut','Copy','Paste','Select all','Delete selection']);
    await page.locator('#cut-selection').click();await count(2);
    assert.equal(await page.locator('#edit-menu').isVisible(),false);
    await shortcut('Z',{meta:true});await count(3);
    // Physical codes must continue to work with a non-Latin e.key.
    await shortcut('A');
    assert.equal(await page.locator('#selection-summary').textContent(),'3 selected');
    await shortcut('C');
    await page.waitForFunction(()=>document.getElementById('state').textContent.includes('Copied inside'));
    await page.locator('.paper').click({position:{x:110,y:120}});
    assert.equal(await page.locator('#selection-summary').textContent(),'No selection');
    await shortcut('V',{meta:true});await count(6);
    const ids=await page.locator('.word').evaluateAll(els=>els.map(x=>x.dataset.id));
    assert.equal(new Set(ids).size,6,'Pasting creates fresh stable object identities');
    const blueWords=await page.locator('.word').evaluateAll(els=>els.filter(el=>{
     const text=el.querySelector('.glyph-ink-svg text');return text&&getComputedStyle(text).fill==='rgb(31, 75, 168)';
    }).length);
    assert.equal(blueWords,2,'The rich internal clipboard preserves color across paste');
    await shortcut('A',{meta:true});await shortcut('X');await count(0);
    await shortcut('Z');await count(6);
    await shortcut('A');
    await page.keyboard.press('Backspace');await count(0);
    await shortcut('Z');await count(6);
    await shortcut('A');
    await page.keyboard.press('Delete');await count(0);
    await shortcut('Z');await count(6);
    // Native clipboard events work for external Unicode; foreign text is rejected atomically.
    await page.locator('.paper').click({position:{x:110,y:120}});
    await pasteText('latin');
    await page.waitForFunction(()=>document.getElementById('state').textContent.includes('Paste only accepts'));
    await count(6);
    // On a blank insertion point the touch menu still offers Paste and Select All.
    await hold(page.locator('.paper'));
    assert.equal(await page.locator('#cut-selection').isEnabled(),false);
    assert.equal(await page.locator('#copy-selection').isEnabled(),false);
    assert.equal(await page.locator('#paste-selection').isEnabled(),true);
    await page.locator('#select-all').click();
    assert.equal(await page.locator('#selection-summary').textContent(),'6 selected');
    // Native form fields retain their own Select All shortcut.
    await page.locator('#format-toggle').click();
    const before=await page.locator('#selection-summary').textContent();
    await page.locator('#font-size').focus();await page.keyboard.press('Control+a');
    assert.equal(await page.locator('#selection-summary').textContent(),before);
    await closeFormat();
    await page.locator('#library').click();
    await page.locator('#library-screen').waitFor({state:'visible'});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,null,{timeout:180000});
    await page.locator('.document-open').first().click();await count(6);
    assert.equal(await page.locator('#font-size').inputValue(),'10');
    // Multiple real pages must stack as one thumbnail per row on both devices.
    await pasteText(Array(40).fill('𓅓').join(' '));await count(46);
    await page.locator('#format-toggle').click();
    await page.locator('#font-size').fill('72');await page.locator('#font-size').press('Tab');
    await page.waitForFunction(()=>Number(document.getElementById('page-total').textContent.match(/\d+/)?.[0])>=2,
      null,{timeout:90000});
    await page.locator('#pages-toggle').click();
    const thumbnails=await page.locator('.page-overview-item').evaluateAll(els=>els.map(el=>{
      const r=el.getBoundingClientRect();return {left:r.left,top:r.top,bottom:r.bottom};
    }));
    assert.ok(thumbnails.length>=2);
    for(let i=1;i<thumbnails.length;i++){
      assert.ok(Math.abs(thumbnails[i].left-thumbnails[0].left)<1,'Exactly one page per row');
      assert.ok(thumbnails[i].top>=thumbnails[i-1].bottom,'Page thumbnails cannot share a row');
    }
    assert.deepEqual(errors,[]);
    console.log('PASS:',engineName,viewport.width+'x'+viewport.height,'touch menu, clipboard, colors, delete/undo, reopen');
    results.push({engine:engineName,viewport,commands:'cut/copy/paste/select-all/delete',persistence:true,targets:'44px minimum'});
   }finally{await context.close();}
  }
 }finally{await browser.close();}
}
console.log('Touch editing acceptance:',JSON.stringify(results));

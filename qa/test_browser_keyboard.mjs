import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url='http://127.0.0.1:8123/';
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const context=await browser.newContext({
  viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,
  hasTouch:true,locale:'en-US',serviceWorkers:'block'
});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(30000);
try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#create-document')?.disabled===false,
    {timeout:180000});
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
  // The approved slim Format panel keeps editing commands in its touch menu.
  const panelAudit=await page.evaluate(()=>{
    const ids=['pages-panel','format-panel','keyboard-panel'];
    const old=['edit-panel','insert-panel','edit-toggle','insert-toggle'];
    const actions=['undo','redo','insert-clipart','insert-image','insert-table','insert-cartouche'];
    const format=document.getElementById('format-panel');
    const menu=document.getElementById('edit-menu');
    return {three:ids.every(x=>document.getElementById(x)),
      obsolete:old.some(x=>document.getElementById(x)),
      groups:[...format.querySelectorAll('[data-format-group]')].map(el=>el.dataset.formatGroup),
      edit:['select-all','copy-selection','cut-selection','paste-selection','delete'].every(id=>
        menu.contains(document.getElementById(id))&&!format.contains(document.getElementById(id))),
      actions:actions.map(id=>{
        const el=document.getElementById(id);
        return {id,inside:format.contains(el),icon:Boolean(el.querySelector('svg')),
          label:el.getAttribute('aria-label'),text:el.textContent.trim()};
      })};
  });
  assert.ok(panelAudit.three);assert.equal(panelAudit.obsolete,false);
  assert.ok(panelAudit.edit,'All five edit commands belong to the contextual menu');
  assert.deepEqual(panelAudit.groups,['size','colors','history','font','surface','direction','insert']);
  assert.equal(await page.locator('#font-size').inputValue(),'10');
  for(const tool of panelAudit.actions){
    assert.equal(tool.inside,true,tool.id+' must live in Format');
    assert.equal(tool.icon,true);assert.equal(tool.text,'');assert.ok(tool.label);
  }
  // e.code is tied to physical keys; e.key deliberately uses Arabic here.
  await page.evaluate(()=>document.dispatchEvent(
    new KeyboardEvent('keydown',{code:'Digit2',key:'٢',ctrlKey:true,shiftKey:true,bubbles:true})));
  assert.equal(await page.locator('#format-panel').isVisible(),true,
    'Ctrl+Shift+2 must open Format on non-English keyboard layouts');
  await page.evaluate(()=>document.dispatchEvent(
    new KeyboardEvent('keydown',{code:'Digit3',key:'٣',ctrlKey:true,shiftKey:true,bubbles:true})));
  assert.equal(await page.locator('#pages-panel').isVisible(),true);
  await page.locator('#keyboard-toggle').click();
  await page.locator('#keyboard-panel').waitFor({state:'visible'});
  const reed=page.locator('#keys button').filter({hasText:'𓇋'}).first();
  assert.ok(await reed.count(),'The glyph keyboard must expose M17');
  await reed.click();
  await reed.click();
  await page.waitForFunction(()=>{
    const panel=document.getElementById('quadrat-preview');
    return panel&&!panel.hidden&&panel.querySelectorAll('.glyph-ink-svg text').length===2;
  },null,{timeout:30000});
  const preview=await page.locator('#quadrat-preview .glyph-ink-svg text').allTextContents();
  assert.deepEqual(preview,['𓇋','𓇋'],'Live quadrat uses the chosen native Unicode signs');
  const own=page.locator('#suggestions button.user-choice').first();
  await own.waitFor({state:'visible'});
  await own.click();
  await page.waitForFunction(()=>document.getElementById('wordcount')?.textContent==='1 words',
    null,{timeout:90000});
  await page.waitForFunction(()=>
    document.querySelectorAll('.word .glyph-ink-svg text').length===2,
    null,{timeout:90000});
  const ink=await page.locator('.word .glyph-ink-svg text').allTextContents();
  assert.deepEqual(ink,['𓇋','𓇋'],'Rendered document preserves glyph sequence');
  // Native Unicode Noto outlines are LTR; right-to-left documents must
  // mirror visible ink, while the logical word remains identical.
  const rtlLayer=page.locator('.word .hieroglyph-direction-layer').first();
  await rtlLayer.waitFor({state:'attached'});
  assert.equal(await rtlLayer.getAttribute('data-writing-direction'),'rtl');
  assert.match(await rtlLayer.getAttribute('transform'),/scale\(-1 1\)/);
  assert.deepEqual(await page.locator('.word .glyph-ink-svg text').allTextContents(),
    ['𓇋','𓇋'],'Mirroring cannot reverse stored logical glyph order');
  await page.locator('#format-toggle').click();
  await page.locator('#dir-ltr').click();
  await page.waitForFunction(()=>
   document.querySelector('.word .hieroglyph-direction-layer')?.getAttribute('data-writing-direction')==='ltr',
   null,{timeout:30000});
  assert.equal(await page.locator('.word .hieroglyph-direction-layer').first().getAttribute('transform'),null,
    'Left-to-right outlines must remain in Unicode font baseline orientation');
  await page.locator('#dir-rtl').click();
  await page.waitForFunction(()=>
   document.querySelector('.word .hieroglyph-direction-layer')?.getAttribute('data-writing-direction')==='rtl',
   null,{timeout:30000});
  assert.match(await page.locator('.word .hieroglyph-direction-layer').first().getAttribute('transform'),
    /scale\(-1 1\)/,'Restored RTL faces should mirror again');

  // Close the floating Format inspector before selecting ink beneath it.
  // This matches the normal document editing flow on a small screen.
  await page.locator('#format-toggle').click();
  await page.locator('#format-panel').waitFor({state:'hidden'});
  // Physical Ctrl+B must work despite an Arabic key value.
  await page.locator('.word').first().click();
  await page.evaluate(()=>document.dispatchEvent(
    new KeyboardEvent('keydown',{code:'KeyB',key:'لا',ctrlKey:true,bubbles:true})));
  await page.waitForFunction(()=>document.querySelector('#bold')?.getAttribute('aria-pressed')==='true',
    null,{timeout:30000});
  await page.locator('#library').click();
  await page.locator('#library-screen').waitFor({state:'visible',timeout:45000});
  await page.locator('#doc-list .document-open').first().waitFor({state:'visible'});
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#create-document')?.disabled===false,
    null,{timeout:180000});
  await page.locator('#doc-list .document-open').first().click();
  await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
  await page.waitForFunction(()=>document.getElementById('wordcount')?.textContent==='1 words',
    null,{timeout:90000});
  await page.waitForFunction(()=>
    document.querySelectorAll('.word .glyph-ink-svg text').length===2,
    null,{timeout:90000});
  assert.deepEqual(await page.locator('.word .glyph-ink-svg text').allTextContents(),
    ['𓇋','𓇋'],'Saved local document reopens with visible silhouettes');
  assert.deepEqual(errors,[],'Browser page errors');
  console.log('PASS: mobile create → type → preview → insert → leave → reload → reopen');
}catch(error){
  await page.screenshot({path:'/tmp/mdwnfr-browser-failure.png',fullPage:true}).catch(()=>{});
  console.error('Browser acceptance failed:',error);
  console.error('UI state:',await page.locator('#state').textContent().catch(()=>null));
  console.error('Library warning:',await page.locator('#library-error').textContent().catch(()=>null));
  console.error('Page errors:',errors);
  throw error;
}finally{
  await browser.close();
}

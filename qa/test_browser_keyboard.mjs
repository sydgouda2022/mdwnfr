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
  assert.equal(await page.locator('.library-toolbar > button').count(),0);
   assert.equal(await page.locator('#create-document').getAttribute('aria-label'),'New document');
   assert.equal((await page.locator('#create-document').textContent()).trim(),'');
   assert.equal(await page.locator('.library-wordmark').textContent(),'𓌃𓄤𓂋𓆑');
   const fab=await page.locator('#create-document').boundingBox();
   assert.ok(fab&&fab.x>280&&fab.y>690,'The + button must float bottom-right');
   assert.equal(await page.locator('#library-import-file').count(),1,
    'Documents library must expose current-schema backup import');
   assert.equal(await page.locator('#library-trash').count(),1,
    'Deleted documents must remain recoverable from Trash');
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
   assert.equal(await page.locator('#quadrat-preview').count(),0,
     'The unrequested secondary preview should not exist');
   assert.equal(await page.locator('#composer').textContent(),'𓇋𓇋',
     'The normal composer shows exactly the sequence entered');
   const keyboardLayout=await page.evaluate(()=>{
     const numerals=document.getElementById('numbers');
     const keys=document.getElementById('keys');
     const panel=document.getElementById('keyboard-panel');
     const footer=document.querySelector('#editor-screen .bottom-bar');
     return {
       numeralCount:numerals.querySelectorAll('button').length,
       numeralsFirst:numerals.getBoundingClientRect().bottom<=keys.getBoundingClientRect().top+2,
       gap:footer.getBoundingClientRect().top-panel.getBoundingClientRect().bottom
     };
   });
   assert.equal(keyboardLayout.numeralCount,15,'All 15 numeral keys remain');
   assert.ok(keyboardLayout.numeralsFirst,'Numerals appear above all sign keys');
   assert.ok(keyboardLayout.gap>=-3&&keyboardLayout.gap<=12,
     'Keyboard sits immediately above footer, without wasted gap');
  await page.locator('.tab[data-tab="others"]').click();
  assert.equal(await page.locator('#keys button').count(),818,
    'Other page exposes every remaining installed-font glyph');
  await page.locator('#keys button').first().click();
  assert.equal(await page.locator('#composer').textContent(),'𓀀',
    'An uncatalogued but font-verified glyph is directly insertable');
  await page.locator('#clear').click();
  await page.locator('.tab[data-tab="unilaterals"]').click();
  await page.locator('#save-personal-word').click();
  await page.locator('#manage-personal-words').click();
  const ownSaved=page.locator('#personal-words-list .personal-item');
  await ownSaved.waitFor({state:'visible'});
  assert.equal(await ownSaved.count(),1);
  await ownSaved.locator('button[aria-label^="Remove personal word"]').click();
  await page.waitForFunction(()=>document.getElementById('personal-words-list')?.textContent.includes('No saved'));
  await page.locator('#manage-personal-words').click();
  const own=page.locator('#suggestions button.user-choice').first();
  await own.waitFor({state:'visible'});
  await own.click();
  await page.waitForFunction(()=>document.getElementById('wordcount')?.textContent==='1 word',
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
  const more=page.locator('#doc-list .document-more').first();
   assert.equal(await more.getAttribute('aria-expanded'),'false');
   await more.click();
   assert.deepEqual(await page.locator('#doc-list .document-menu:not([hidden]) button').allTextContents(),['Rename','Export file','Move to Trash']);
   await page.locator('.library-toolbar h2').click();
   assert.equal(await page.locator('#doc-list .document-menu:not([hidden])').count(),0);
   assert.equal(await page.locator('#doc-list .document-preview').count(),1);
   await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#create-document')?.disabled===false,
    null,{timeout:180000});
  await page.locator('#doc-list .document-open').first().click();
  await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
  await page.waitForFunction(()=>document.getElementById('wordcount')?.textContent==='1 word',
    null,{timeout:90000});
  await page.waitForFunction(()=>
    document.querySelectorAll('.word .glyph-ink-svg text').length===2,
    null,{timeout:90000});
  assert.deepEqual(await page.locator('.word .glyph-ink-svg text').allTextContents(),
    ['𓇋','𓇋'],'Saved local document reopens with visible silhouettes');
  // A real table must be readable on the writing surface and editable with
  // one tap, without navigating to a separate spreadsheet-style screen.
  await page.locator('#format-toggle').click();
  await page.locator('#insert-table').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'visible'});
  await page.locator('#insert-sheet-confirm').waitFor({state:'visible'});
  assert.equal(await page.locator('#insert-glyph-tabs button').count(),4,
    'Nested input uses the same four sign pages');
  assert.equal(await page.locator('#insert-glyph-numbers .numkey').count(),15,
    'Nested input keeps all Egyptian numerals on the first row');
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
    null,{timeout:90000});
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  const table=page.locator('.table-object').first();
  await table.waitFor({state:'visible',timeout:90000});
  await table.locator('.table-cell-view').first().click();
  assert.equal(await page.locator('#format-panel').isVisible(),false,
    'Cell selection must not pop an inspector over the next touch');
  await page.locator('#format-toggle').click();
   assert.equal(await page.locator('#table-controls').count(),0,'No second table editor');
   assert.equal(await table.locator('.table-cell-view').count(),4);
   const actualWidth=await table.evaluate(el=>el.getBoundingClientRect().width);
   const inkColumnWidth=await page.locator('.word').first().evaluate(el=>el.getBoundingClientRect().width);
   assert.ok(actualWidth>=inkColumnWidth*9,'Table remains readable');
   await page.locator('#format-toggle').click();
   await table.locator('.table-cell-view').first().click();
   await page.locator('#object-action-edit').click();
   await page.locator('#insert-dialog-backdrop').waitFor({state:'visible'});
   await page.locator('#insert-table-cell-input').fill('𓅓𓏏');
   await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,null,{timeout:90000});
   await page.locator('#insert-sheet-confirm').click();
   await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.querySelectorAll('.table-object .table-cell-word .glyph-ink-svg text').length>=2,null,{timeout:90000});
   // The four Insert screens are drafts. Cancel must never change the
  // document, even after a valid Python layout preview is rendered.
  if(!await page.locator('#format-panel').isVisible())await page.locator('#format-toggle').click();
  await page.locator('#insert-clipart').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'visible'});
  await page.locator('#artwork-grid .artwork-choice').first().waitFor({state:'visible'});
  await page.locator('#artwork-grid .artwork-choice').first().click();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
    null,{timeout:90000});
  assert.ok(await page.locator('#pages .draft-page-layer .draft-paper .draft-object').count(),
    'Clip-art selection must render its Python-composed object on the actual writing page');
  assert.equal(await page.locator('#insert-preview').count(),0,
    'There must not be a second miniature document preview');
  assert.equal(await page.locator('#insert-sheet-cancel-top').count(),0,
    'The contextual inspector must not have a desktop close X');
  assert.notEqual(await page.locator('#insert-sheet').getAttribute('aria-modal'),'true',
    'Insert must not behave as a modal desktop dialog');
  await page.locator('#insert-sheet-cancel').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  assert.equal(await page.locator('#pages .draft-page-layer').count(),0,
    'Cancel removes the temporary page layer');
  assert.equal(await page.locator('.clipart-object').count(),0,
    'Cancel leaves no clip art in the saved document');

  await page.locator('#format-toggle').click();
  await page.locator('#insert-cartouche').click();
  await page.locator('input[name="insert-cartouche-direction"][value="horizontal"]').check();
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
    null,{timeout:90000});
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden'});
  await page.locator('.cartouche-object').first().waitFor({state:'visible',timeout:90000});
  await page.locator('.cartouche-object').first().dblclick();
  await page.locator('#insert-screen-cartouche').waitFor({state:'visible'});
  assert.equal(await page.locator('input[name="insert-cartouche-direction"]:checked').inputValue(),
    'horizontal','Existing cartouche reopens its same orientation editor');
  await page.locator('#insert-sheet-cancel').click();

  await page.locator('#format-toggle').click();
  await page.locator('#insert-image').click();
  await page.locator('#insert-screen-image').waitFor({state:'visible'});
  await page.locator('#insert-image-file').setInputFiles({
    name:'embedded.png',mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGOUcOr9z4AEmBjQAGEBAHwtAe6/I+HPAAAAAElFTkSuQmCC','base64')
  });
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
    null,{timeout:90000});
  assert.equal(await page.locator('#insert-image-thumbnail').isVisible(),true);
  await page.locator('#insert-sheet-cancel').click();
  assert.equal(await page.locator('.clipart-object').count(),0,
    'Cancelling image selection does not add a document object');
  // Reproduce the production failure: configure a table in multiple
  // rapid changes and ensure Confirm commits the final 3x4 border settings.
  if(!await page.locator('#format-panel').isVisible())
    await page.locator('#format-toggle').click();
  await page.locator('#insert-table').click();
  await page.locator('#insert-table-rows').fill('3');
  await page.locator('#insert-table-rows').dispatchEvent('change');
  await page.locator('#insert-table-columns').fill('4');
  await page.locator('#insert-table-columns').dispatchEvent('change');
  await page.locator('#insert-table-border').selectOption('dashed');
  await page.locator('#insert-table-color').fill('#217acc');
  await page.locator('#insert-table-line').fill('1');
  await page.locator('#insert-table-line').dispatchEvent('change');
  await page.waitForFunction(()=>!document.getElementById('insert-sheet-confirm').disabled,
    null,{timeout:90000});
  console.log('TABLE_REQUESTED_UI',JSON.stringify(await page.evaluate(()=>({
    rows:document.getElementById('insert-table-rows').value,
    columns:document.getElementById('insert-table-columns').value,
    border:document.getElementById('insert-table-border').value,
    color:document.getElementById('insert-table-color').value,
    thickness:document.getElementById('insert-table-line').value,
    status:document.getElementById('insert-preview-status').textContent
  }))));
  await page.locator('#insert-sheet-confirm').click();
  try{
   await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden',timeout:30000});
  }catch(error){
   console.error('Table confirm failure status:',
     await page.locator('#state').textContent().catch(()=>null));
   console.error('Table preview status:',
     await page.locator('#insert-preview-status').textContent().catch(()=>null));
   throw error;
  }
  // The newly inserted table may be on a virtualized page outside the
  // viewport. Verify that the real IndexedDB transaction persisted its full
  // structure/style; the visible-table interaction is covered earlier.
  // Poll IndexedDB from Node rather than returning a Promise to
  // waitForFunction: the latter can treat the Promise itself as truthy.
  let snapshot=[];
  for(let attempt=0;attempt<50;attempt++){
    snapshot=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open('mdwnfr-documents',1);
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    try{
      const entries=await new Promise((resolve,reject)=>{
        const tx=db.transaction('documents','readonly');
        const r=tx.objectStore('documents').getAll();
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
      return entries.map(doc=>({
        id:doc.id,name:doc.name,revision:doc.revision,
        tables:doc.items.filter(item=>item.type==='table').map(item=>({
          rows:item.rows.length,cols:item.rows[0].length,style:item.style||{}
        }))
      }));
    }finally{db.close();}
  });
    if(snapshot.some(doc=>doc.name==='Untitled'&&doc.tables.length===2))break;
    await page.waitForTimeout(200);
  }
  console.log('TABLE_DB_DIAGNOSTICS',JSON.stringify(snapshot));
  const tables=snapshot.find(doc=>doc.name==='Untitled'&&doc.tables.length===2)?.tables||[];
  assert.equal(tables.length,2,'Both existing and configured tables persist');
  assert.equal(tables.at(-1).rows,3);
  assert.equal(tables.at(-1).cols,4);
  assert.equal(tables.at(-1).style.border_style,'dashed');
  assert.equal(tables.at(-1).style.border_color,'#217acc');
  assert.equal(tables.at(-1).style.border_width_mm,1);
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

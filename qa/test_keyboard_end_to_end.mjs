import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium,webkit} from 'playwright';
import {createKeyboardFromData} from '../web/vendor/hieroglyphic/keyboard_api.mjs';

// Choose a real, text-attested API result from the pinned corpus. The test
// does not hard-code a spelling or reimplement keyboard ranking.
const corpus=JSON.parse(readFileSync(new URL('../web/lexicon/lexicon.json',import.meta.url),'utf8'));
const api=createKeyboardFromData({lexicon:corpus});
const groups=[
  ['unilaterals','uni'],['bilaterals','bi'],['trilaterals','tri']
];
let chosen=null;
for(const [tab,group] of groups){
  for(const sign of api.getSigns(group).map(item=>item.glyph)){
    const candidate=api.predict(sign,{limit:80}).find(item=>
      item.source!=='RAMSES-CORPUS' && item.attested===true &&
      item.lexicalIdentityVerified===true && item.lexicon_ref &&
      [...item.text].length>1 && item.text.startsWith(sign));
    if(candidate){chosen={tab,sign,candidate};break;}
  }
  if(chosen)break;
}
assert.ok(chosen,'Pinned API corpus must provide a verified lemma-linked suggestion');

const provenance=chosen.candidate.lexicalIdentityVerified
  ? 'Use verified lemma-linked spelling '
  : chosen.candidate.attested
    ? 'Use attested spelling with unresolved lemma '
    : 'Use unverified spelling ';
const expectedLabel=provenance+chosen.candidate.text;
const base='http://127.0.0.1:8123/';

async function readStoredDocuments(page){
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('mdwnfr-documents');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    try{
      return await new Promise((resolve,reject)=>{
        const request=db.transaction('documents','readonly').objectStore('documents').getAll();
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      });
    }finally{db.close();}
  });
}

for(const [name,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch({headless:true});
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,
    hasTouch:true,locale:'en-US',serviceWorkers:'block'
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(30000);
  try{
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#create-document')?.disabled===false,
      null,{timeout:180000});
    await page.locator('#create-document').click();
    await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
    await page.locator('#keyboard-toggle').click();
    await page.locator('#keyboard-panel').waitFor({state:'visible'});

    await page.locator('.tab[data-tab="'+chosen.tab+'"]').click();
    const keyClicked=await page.locator('#keys button').evaluateAll((buttons,glyph)=>{
      const key=buttons.find(button=>button.textContent.trim()===glyph);
      if(!key)return false;
      key.click();return true;
    },chosen.sign);
    assert.ok(keyClicked,'The real keyboard UI must expose the API prefix glyph');

    await page.waitForFunction(label=>
      [...document.querySelectorAll('#suggestions button')].some(button=>
        button.getAttribute('aria-label')===label),
      expectedLabel,{timeout:90000});
    const matchingButtons=page.locator('#suggestions button').filter({
      has:page.locator('svg')
    });
    const targetIndex=await page.locator('#suggestions button').evaluateAll((buttons,label)=>
      buttons.findIndex(button=>button.getAttribute('aria-label')===label),expectedLabel);
    assert.ok(targetIndex>=0,'The UI must expose the chosen API suggestion with its provenance');
    await page.locator('#suggestions button').nth(targetIndex).click();

    await page.waitForFunction(()=>document.getElementById('wordcount')?.textContent==='1 word',
      null,{timeout:90000});
    await page.waitForFunction(expected=>
      [...document.querySelectorAll('.word .glyph-ink-svg text')].map(node=>node.textContent).join('')===expected,
      chosen.candidate.text,{timeout:90000});

    // Leaving the editor flushes autosave. Inspect IndexedDB, not a UI-only
    // mirror, to prove the exact upstream reference reached the stored model.
    await page.locator('#library').click();
    await page.locator('#library-screen').waitFor({state:'visible',timeout:90000});
    let documents=await readStoredDocuments(page);
    assert.equal(documents.length,1,'Exactly one document should have been created');
    let stored=documents[0];
    assert.equal(stored.items.length,1);
    assert.equal(stored.items[0].type,'word');
    assert.equal(stored.items[0].signs.join(''),chosen.candidate.text);
    assert.equal(stored.items[0].lexicon_ref,chosen.candidate.lexicon_ref,
      'The selected independent-API lexicon_ref must be persisted unchanged');

    await page.reload({waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#create-document')?.disabled===false,
      null,{timeout:180000});
    await page.locator('#doc-list .document-open').first().click();
    await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
    await page.waitForFunction(()=>document.getElementById('wordcount')?.textContent==='1 word',
      null,{timeout:90000});
    await page.waitForFunction(expected=>
      [...document.querySelectorAll('.word .glyph-ink-svg text')].map(node=>node.textContent).join('')===expected,
      chosen.candidate.text,{timeout:90000});

    documents=await readStoredDocuments(page);
    stored=documents[0];
    assert.equal(stored.items[0].lexicon_ref,chosen.candidate.lexicon_ref,
      'Reopening must retain the original API lexicon_ref');
    assert.deepEqual(errors,[],'No browser runtime errors are allowed');
    console.log('PASS:',name,'independent API prediction → provenance → document → IndexedDB save → reopen');
  }finally{
    await context.close();
    await browser.close();
  }
}

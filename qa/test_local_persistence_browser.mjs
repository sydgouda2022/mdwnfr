import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium,webkit} from 'playwright';

const origin='http://127.0.0.1:8123/';
const engines=[['chromium',chromium],['webkit',webkit]];

for(const [label,engine] of engines){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'mdwnfr-idb-'));
 let context=null;
 const pageErrors=[];
 const launch=()=>engine.launchPersistentContext(profile,{
  headless:true,
  viewport:label==='chromium'?{width:390,height:844}:{width:1024,height:768},
  args:label==='chromium'?['--disable-dev-shm-usage']:[]
 });
 const ready=async page=>{
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#create-document')?.disabled===false,
   null,{timeout:180000});
  // WebKit may finish installing/activating the worker after the first
  // navigation without assigning it as this page's controller. Wait for an
  // activated registration, then perform a real controlled navigation.
  await page.waitForFunction(async()=>{
   const registration=await navigator.serviceWorker?.getRegistration();
   return registration?.active?.state==='activated';
  },null,{timeout:90000});
  // Activation and control are separate lifecycle milestones. Wait for the
  // controllerchange event explicitly; a resolved registration.ready promise
  // alone does not prove that this document is controlled.
  const waitForController=()=>page.evaluate(()=>new Promise(resolve=>{
   if(navigator.serviceWorker?.controller){resolve(true);return;}
   if(!navigator.serviceWorker){resolve(false);return;}
   const timer=setTimeout(()=>resolve(false),15000);
   navigator.serviceWorker.addEventListener('controllerchange',()=>{
    clearTimeout(timer);resolve(!!navigator.serviceWorker.controller);
   },{once:true});
  }));
  if(!await waitForController()){
   await page.reload({waitUntil:'domcontentloaded'});
   await waitForController();
  }
  try{
   await page.waitForFunction(()=>!!navigator.serviceWorker?.controller&&
    document.querySelector('#offline-notice')?.hidden===true,
    null,{timeout:90000});
  }catch(error){
   const diagnostics=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker?.getRegistration();
    const names=await caches.keys();
    const cachesInfo=[];
    for(const name of names){
     const cache=await caches.open(name);
     const keys=await cache.keys();
     const manifest=await cache.match('/offline-assets.json');
     const publication=manifest?await manifest.json().catch(()=>null):null;
     cachesInfo.push({name,keyCount:keys.length,manifestComplete:publication?.complete,
      manifestAssets:publication?.assets?.length});
    }
    const notice=document.querySelector('#offline-notice');
    return {controller:!!navigator.serviceWorker?.controller,
     controllerScriptURL:navigator.serviceWorker?.controller?.scriptURL||null,
     registrationScope:registration?.scope||null,
     activeScriptURL:registration?.active?.scriptURL||null,
     workerState:registration?.active?.state,installingState:registration?.installing?.state,
     waitingState:registration?.waiting?.state||null,
     online:navigator.onLine,noticeHidden:notice?.hidden,noticeText:notice?.textContent,
     libraryState:document.querySelector('#library-state')?.textContent,cachesInfo};
   });
   throw new Error('Offline readiness failed: '+JSON.stringify(diagnostics)+'; '+error.message);
  }
 };
 try{
  // A persistent browser profile is essential: a fresh incognito context would
  // not prove that IndexedDB survives an actual browser close/reopen.
  context=await launch();
  context.on('page',page=>page.on('pageerror',error=>pageErrors.push(error.message)));
  const first=await context.newPage();
  await ready(first);
  const id='persistence-'+label;
  const initial={
   id,name:'Local persistence acceptance',revision:0,items:[],
   surface:'A4',direction:'rtl',
   created_at:'2026-11-08T00:00:00.000Z',
   updated_at:'2026-11-08T00:00:00.000Z'
  };
  await first.evaluate(async document=>{
   const storage=await import('/storage.js');
   await storage.save(document,null);
  },initial);

  // Two real tabs race from the same persisted revision. IndexedDB must
  // serialize readwrite transactions, allowing exactly one compare-and-swap.
  const second=await context.newPage();
  await ready(second);
  const contenders=[
   { ...initial,revision:1,marker:'tab-one',items:[{type:'word',id:'w1',signs:['𓅓']}] },
   { ...initial,revision:1,marker:'tab-two',items:[{type:'word',id:'w2',signs:['𓏏']}] }
  ];
  const outcomes=await Promise.all([
   first.evaluate(async ({id,document})=>{
    const storage=await import('/storage.js');
    try{await storage.save(document,0);return 'fulfilled';}
    catch(error){return 'rejected:'+error.message;}
   },{id,document:contenders[0]}),
   second.evaluate(async ({id,document})=>{
    const storage=await import('/storage.js');
    try{await storage.save(document,0);return 'fulfilled';}
    catch(error){return 'rejected:'+error.message;}
   },{id,document:contenders[1]})
  ]);
  assert.equal(outcomes.filter(value=>value==='fulfilled').length,1,
   'Exactly one tab may commit from the same base revision');
  assert.equal(outcomes.filter(value=>value.startsWith('rejected:')).length,1,
   'The stale tab must receive a revision conflict');
  const committed=await first.evaluate(async id=>{
   const storage=await import('/storage.js');
   return storage.load(id);
  },id);
  assert.equal(committed.revision,1);
  assert.ok(['tab-one','tab-two'].includes(committed.marker));
  const indexed=await first.evaluate(async()=>{
   const storage=await import('/storage.js');
   return storage.list();
  });
  assert.equal(indexed.find(entry=>entry.id===id)?.revision,1,
   'The document index must commit with the winning document revision');
  await context.close();context=null;

  // Reopen the SAME browser profile with networking disabled. The installed
  // service worker must boot the editor, and the exact IndexedDB document
  // written before shutdown must still be readable.
  context=await launch();
  context.setOffline(true);
  const reopened=await context.newPage();
  context.on('page',page=>page.on('pageerror',error=>pageErrors.push(error.message)));
  await ready(reopened);
  assert.equal(await reopened.evaluate(()=>navigator.onLine),false);
  const persisted=await reopened.evaluate(async id=>{
   const storage=await import('/storage.js');
   return storage.load(id);
  },id);
  assert.equal(persisted.revision,1);
  assert.equal(persisted.marker,committed.marker);
  assert.equal(persisted.items[0].signs[0],committed.items[0].signs[0]);
  assert.deepEqual(pageErrors,[],
   'No JavaScript exceptions during real IndexedDB persistence and offline restart');
  console.log('PASS '+label+' real IndexedDB cross-tab compare-and-swap, browser restart and offline reopen');
 }finally{
  if(context)await context.close();
  fs.rmSync(profile,{recursive:true,force:true});
 }
}

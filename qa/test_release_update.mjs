import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

const base='http://127.0.0.1:8124';
const dist=new URL('../dist/',import.meta.url);
const oldWorker=new URL('release-test-sw.js',dist),fixture=new URL('release-test.html',dist);
const published=await fs.readFile(new URL('index.html',dist),'utf8');
const stale=published.replace(/name="mdwnfr-build" content="[^"]+"/,'name="mdwnfr-build" content="old-release"');
assert.notEqual(stale,published);
await fs.writeFile(fixture,'<!doctype html><title>Release test</title>');
await fs.writeFile(oldWorker,`
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
 const p=new URL(e.request.url).pathname;
 if(e.request.mode==='navigate'&&p==='/')e.respondWith(Promise.resolve(new Response(${JSON.stringify(stale)},{headers:{'Content-Type':'text/html'}})));
 else if(p==='/app.js')e.respondWith(Promise.resolve(new Response('throw new Error("Stale app imported before update activated")',{headers:{'Content-Type':'application/javascript'}})));
});`);
try{
 for(const [name,type] of Object.entries({chromium,webkit})){
  const server=spawn('python3',['-m','http.server','8124','--bind','127.0.0.1','--directory',fileURLToPath(dist)],{stdio:'ignore'});
  let serving=false;
  for(let attempt=0;attempt<50;attempt++){
   try{serving=(await fetch(base+'/release-test.html')).ok;}catch{}
   if(serving)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(serving,'The isolated release-test server must start');
  const browser=await type.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(base+'/release-test.html');
   await page.evaluate(async()=>{
    await navigator.serviceWorker.register('/release-test-sw.js',{scope:'/'});
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
   });
   await page.goto(base+'/');
   await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,null,{timeout:180000});
   assert.notEqual(await page.locator('meta[name="mdwnfr-build"]').getAttribute('content'),'old-release');
   await page.locator('#create-document').click();
   await page.locator('#editor-screen').waitFor({state:'visible'});
   assert.equal(await page.locator('#font-size').inputValue(),'10','An update cannot mix fresh controls with an older Python default');
   await page.locator('#library').click();
   await page.locator('#library-screen').waitFor({state:'visible'});
   // WebKit's emulated offline switch can fail a reload internally before its
   // service worker gets the request. Stop this test's own origin instead:
   // successful navigation now proves the installed cache can run unaided.
   const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.getElementById('create-document')?.disabled===false,null,{timeout:180000});
   await page.locator('#create-document').click();
   await page.locator('#editor-screen').waitFor({state:'visible'});
   assert.equal(await page.locator('#font-size').inputValue(),'10');
   await page.locator('#format-toggle').click();
   await page.locator('#format-main').waitFor({state:'visible'});
   assert.deepEqual(errors,[]);
   console.log('PASS:',name,'stale installed release → atomic update → create → offline restart → create');
  }finally{await context.close();await browser.close();if(server.exitCode===null)server.kill('SIGTERM');}
 }
}finally{await fs.unlink(oldWorker).catch(()=>{});await fs.unlink(fixture).catch(()=>{});}

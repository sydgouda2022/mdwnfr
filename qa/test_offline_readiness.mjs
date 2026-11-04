import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const editor=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const start=editor.indexOf('async function showOfflineReadiness(){');
const end=editor.indexOf("\nif('serviceWorker' in navigator)",start);
assert.ok(start>=0&&end>start,'Current editor must expose offline readiness check');
const check=editor.slice(start,end);
const critical=['/index.html','/app.js','/keyboard-prediction-worker.mjs',
 '/keyboard-release-pin.json','/vendor/pyodide/pyodide.asm.wasm',
 '/assets/fonts/hieroglyphs.woff2'];
const full=[...critical,'/core/mdwnfr/layout.py','/vendor/pyodide/pyodide.asm.data'];

async function inspect({entries=full,cached=full,controller=true,complete=true,
 format='mdwnfr-offline-publication-v1',offlineReady=true}={}){
 const notice={hidden:false,textContent:''};
 const retry={hidden:true,disabled:false};
 const publication={format,complete,assets:entries.map(path=>({path}))};
 const cache={
  match:async path=>path==='/offline-assets.json'?{json:async()=>publication}:null,
  keys:async()=>cached.map(path=>({url:'https://mdwnfr.example'+path}))
 };
 const environment={
  $:id=>{assert.ok(['offline-notice','offline-retry'].includes(id));return id==='offline-notice'?notice:retry;},
  fetch:async path=>{assert.equal(path,'/runtime-status.json');
   return{ok:true,json:async()=>({offline_ready:offlineReady})};},
  navigator:{serviceWorker:{controller:controller?{}:null,
   getRegistration:async()=>({active:{},installing:null})}},
  window:{caches:{}},
  caches:{keys:async()=>['mdwnfr-offline-1234567890abcdef'],
   open:async name=>{assert.match(name,/^mdwnfr-offline-/);return cache;}},
  URL,clearTimeout:()=>{},setTimeout:()=>42
 };
 await vm.runInNewContext(check+'\nshowOfflineReadiness()',environment);
 return {hidden:notice.hidden,textContent:notice.textContent,retryHidden:retry.hidden};
}
assert.equal((await inspect()).hidden,true,'All advertised assets cached: ready');
const incomplete=await inspect({cached:critical});
assert.equal(incomplete.hidden,false,
 'A missing secondary Python module must fail readiness, even if critical files exist');
assert.match(incomplete.textContent,/incomplete \(6\/8 files\)/);
assert.equal(incomplete.retryHidden,false);
assert.equal((await inspect({cached:full.slice(1)})).hidden,false,
 'Missing initial HTML must fail readiness');
assert.equal((await inspect({entries:[...full,full[0]]})).hidden,false,
 'Duplicate manifest paths invalidate readiness');
const uncontrolled=await inspect({controller:false});
assert.equal(uncontrolled.hidden,false,
 'No installed controlling service worker means not yet offline ready');
assert.match(uncontrolled.textContent,/not controlling this tab/);
assert.equal((await inspect({complete:false})).hidden,false);
assert.equal((await inspect({format:'wrong-format'})).hidden,false);
assert.equal((await inspect({offlineReady:false})).hidden,false);
assert.match((await inspect({cached:[],entries:full})).textContent,/not installed|incomplete|No complete offline file inventory/);
assert.match((await inspect({offlineReady:false})).textContent,/missing its local Python runtime/);
console.log('PASS: offline readiness distinguishes complete, incomplete and inactive device installs');

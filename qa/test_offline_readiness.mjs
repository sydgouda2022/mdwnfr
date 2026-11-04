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
  $:id=>{assert.equal(id,'offline-notice');return notice;},
  fetch:async path=>{assert.equal(path,'/runtime-status.json');
   return{ok:true,json:async()=>({offline_ready:offlineReady})};},
  navigator:{serviceWorker:controller?{controller:{}}:{controller:null}},
  window:{caches:{}},
  caches:{keys:async()=>['mdwnfr-offline-1234567890abcdef'],
   open:async name=>{assert.match(name,/^mdwnfr-offline-/);return cache;}},
  URL
 };
 await vm.runInNewContext(check+'\nshowOfflineReadiness()',environment);
 return notice;
}
assert.equal((await inspect()).hidden,true,'All advertised assets cached: ready');
assert.equal((await inspect({cached:critical})).hidden,false,
 'A missing secondary Python module must fail readiness, even if critical files exist');
assert.equal((await inspect({cached:full.slice(1)})).hidden,false,
 'Missing initial HTML must fail readiness');
assert.equal((await inspect({entries:[...full,full[0]]})).hidden,false,
 'Duplicate manifest paths invalidate readiness');
assert.equal((await inspect({controller:false})).hidden,false,
 'No installed controlling service worker means not yet offline ready');
assert.equal((await inspect({complete:false})).hidden,false);
assert.equal((await inspect({format:'wrong-format'})).hidden,false);
assert.equal((await inspect({offlineReady:false})).hidden,false);
assert.match((await inspect({cached:[],entries:full})).textContent,/not installed|incomplete/);
assert.match((await inspect({offlineReady:false})).textContent,/missing its local Python runtime/);
console.log('PASS: offline readiness distinguishes complete, incomplete and inactive device installs');

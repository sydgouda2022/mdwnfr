import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';

// Exercise the actual fingerprinted, packaged service worker. An interrupted
// update may NOT modify the previously complete, already-active release.
const script=fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
const current=(script.match(/const CACHE = '([^']+)';/)||[])[1];
assert.match(current,/^mdwnfr-offline-[a-f0-9]{16}$/);
const previous='mdwnfr-offline-1111111111111111';
const entries=new Map([[previous,new Map([['/index.html','KNOWN_GOOD']])]]);
const handlers=new Map();
const dig=b=>createHash('sha256').update(b).digest('hex');
const assets=[
 {path:'/index.html',bytes:4,sha256:dig('HOME')},
 {path:'/app.js',bytes:3,sha256:dig('APP')}
];
let failSecond=true;
const caches={
 async has(k){return entries.has(k)},
 async keys(){return [...entries.keys()]},
 async delete(k){return entries.delete(k)},
 async open(k){
  if(!entries.has(k))entries.set(k,new Map());
  const cache=entries.get(k);
  return {
   async match(path){return cache.get(path)},
   async put(path,response){cache.set(path,response)}
  };
 }
};
const fetch=async path=>{
 if(path==='/offline-assets.json')return new Response(JSON.stringify({
  format:'mdwnfr-offline-publication-v1',complete:true,assets
 }),{headers:{'Content-Type':'application/json'}});
 const content=path==='/index.html'?'HOME':path==='/app.js'?'APP':null;
 if(content===null)throw Error('unexpected fetch '+path);
 // Simulate one corrupted asset mid-install after the first valid cache.put.
 return new Response(path==='/app.js'&&failSecond?'BAD':content);
};
const worker={
 location:{origin:'https://mdwnfr.example'},
 addEventListener(type,handler){handlers.set(type,handler)},
 async skipWaiting(){},
 clients:{async claim(){}}
};
vm.runInNewContext(script,{self:worker,caches,fetch,crypto:webcrypto,
 URL,Response,Headers},{filename:'sw.js'});
async function event(name){
 let promise;
 handlers.get(name)({waitUntil(p){promise=p}});
 return promise;
}
await assert.rejects(event('install'),/Incorrect checksum/);
assert.ok(entries.has(previous),'A failed update must preserve existing release cache');
assert.equal(entries.get(previous).get('/index.html'),'KNOWN_GOOD');
assert.ok(!entries.has(current),'A failed update must delete incomplete candidate cache');
failSecond=false;
await event('install');
assert.ok(entries.has(current),'Successful install must stage its own cache');
assert.ok(entries.has(previous),'Previous cache persists until activation');
await event('activate');
assert.ok(entries.has(previous),'Retain previous complete release for open tabs');
assert.ok(entries.has(current),'New cache must survive activation');
const active=await caches.open(current);
assert.equal(await (await active.match('/app.js')).text(),'APP');
console.log('PASS: failed offline update preserves previous release; verified candidate activates atomically');

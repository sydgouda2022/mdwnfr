import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const script=fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf-8');
const cacheName=(script.match(/const CACHE = '([^']+)';/)||[])[1];
assert.match(cacheName,/^mdwnfr-offline-[a-f0-9]{16}$/,'Published cache must be fingerprinted');
const handlers=new Map();
const matched=[];
const records=new Map([['/app.js','OFFLINE_APP'],['/style.css','OFFLINE_CSS'],['/index.html','OFFLINE_HOME']]);
const cache={async match(key){
 const path=typeof key==='string'?key:key.url;
 matched.push(path);
 return records.has(path)?new Response(records.get(path)):undefined;
}};
let online=false;
const ctx={
 self:{location:{origin:'https://mdwnfr.example'},addEventListener(name,handler){handlers.set(name,handler);}},
 caches:{async open(name){assert.equal(name,cacheName);return cache;}},
 fetch:async()=>{if(!online)throw Error('Offline');return new Response('NETWORK');},
 URL,Response,Headers,crypto:globalThis.crypto,
};
vm.runInNewContext(script,ctx,{filename:'sw.js'});
async function request(path,mode='cors'){
 let result;
 handlers.get('fetch')({request:{method:'GET',url:'https://mdwnfr.example'+path,mode},respondWith(promise){result=promise;}});
 assert.ok(result,'Service worker must handle GET');
 return (await result).text();
}
assert.equal(await request('/app.js?v=047'),'OFFLINE_APP');
assert.equal(await request('/style.css?v=047'),'OFFLINE_CSS');
assert.equal(await request('/?v=047','navigate'),'OFFLINE_HOME');
assert.ok(matched.includes('/app.js'));
assert.ok(matched.includes('/style.css'));
assert.ok(!matched.includes('/app.js?v=047'));
online=true;
assert.equal(await request('/?v=047','navigate'),'OFFLINE_HOME',
  'Online navigation must retain the cached HTML matching its cached assets');
console.log('PASS: cached versioned app assets and offline/online navigation');

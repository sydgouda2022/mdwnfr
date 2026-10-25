/* MdwNfr: the application shell is cached as one content-addressed release.
   An offline-ready installation requires ALL self-hosted Python/font assets.
   Incomplete updates never delete the previous working cache. */
const PREFIX = 'mdwnfr-offline-';
const CACHE = 'mdwnfr-offline-source';
const MANIFEST = '/offline-assets.json';

async function verifiedResponse(record) {
  const response=await fetch(record.path,{cache:'no-store'});
  if(!response.ok)throw Error('Missing offline asset: '+record.path);
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength!==record.bytes)throw Error('Incorrect size for '+record.path);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)))
    .map(v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==record.sha256)throw Error('Incorrect checksum for '+record.path);
  const headers=new Headers(response.headers);
  headers.set('Content-Length',String(buffer.byteLength));
  return new Response(buffer,{status:200,headers});
}

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const response=await fetch(MANIFEST,{cache:'no-store'});
  if(!response.ok)throw Error('Offline manifest is not available');
  const publication=await response.json();
  if(publication.format!=='mdwnfr-offline-publication-v1'||!Array.isArray(publication.assets))
    throw Error('Unsupported offline publication');
  const cache=await caches.open(CACHE);
  try {
    // Serial verification bounds transient memory, including on smaller iPhones.
    for(const record of publication.assets)
      await cache.put(record.path,await verifiedResponse(record));
    await cache.put(MANIFEST,new Response(JSON.stringify(publication),{
      headers:{'Content-Type':'application/json'}}));
    await self.skipWaiting();
  }catch(error){await caches.delete(CACHE);throw error;}
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Only after successfully installing the new cache do we remove old revisions.
  for(const key of await caches.keys())
    if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const active=await caches.open(CACHE);
    // Keep HTML and assets on the same verified release while online too.
    // A newly installed worker claims the next startup atomically.
    // Cache asset keys are paths without version queries.
    const match=await active.match(url.pathname,{ignoreSearch:false});
    if(match)return match;
    // The start URL is /, while its verified static asset is /index.html.
    if(request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')){
      const index=await active.match('/index.html');
      if(index)return index;
    }
    // An unlisted resource can be retrieved online but is not asserted offline.
    return fetch(request);
  })());
});

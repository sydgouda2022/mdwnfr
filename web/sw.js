/* MdwNfr: the application shell is cached as one content-addressed release.
   An offline-ready installation requires ALL self-hosted Python/font assets.
   Incomplete updates never delete the previous working cache. */
const PREFIX = 'mdwnfr-offline-';
const CACHE = 'mdwnfr-offline-source';
const MANIFEST = '/offline-assets.json';

async function verifiedResponse(record) {
  const response=await fetch(record.path,{cache:'no-store'});
  if(!response.ok)throw Error('Missing offline asset: '+record.path+' (HTTP '+response.status+')');
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength!==record.bytes)throw Error('Incorrect size for '+record.path+': '+buffer.byteLength+' != '+record.bytes);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)))
    .map(v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==record.sha256)throw Error('Incorrect checksum for '+record.path);
  const headers=new Headers(response.headers);
  // The body has been decoded by Fetch. Do not preserve transport encoding
  // metadata on the newly constructed response placed in Cache Storage.
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return new Response(buffer,{status:200,headers});
}

async function reportInstallFailure(error) {
  const detail=String(error?.stack||error?.message||error);
  console.error('MdwNfr offline installation failed:',detail);
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients)client.postMessage({
    type:'mdwnfr-offline-install-error',message:detail
  });
}

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const response=await fetch(MANIFEST,{cache:'no-store'});
  if(!response.ok)throw Error('Offline manifest is not available (HTTP '+response.status+')');
  const publication=await response.json();
  if(publication.format!=='mdwnfr-offline-publication-v1'||publication.complete!==true||!Array.isArray(publication.assets))
    throw Error('Unsupported offline publication');
  const cache=await caches.open(CACHE);
  try {
    const prior=await cache.match(MANIFEST);
    if(prior){
      const verified=await prior.json().catch(()=>null);
      if(verified?.complete===true &&
         JSON.stringify(verified.assets)===JSON.stringify(publication.assets)){
        const keys=new Set((await cache.keys()).map(key=>new URL(key.url).pathname));
        if(publication.assets.every(record=>keys.has(record.path))){
          await self.skipWaiting();return;
        }
      }
    }
    // WebKit can reject overlapping Cache.put operations for one cache.
    // Keep the fast three-at-a-time path, then retry a failed batch serially.
    // This is safe because all batch promises have settled before retry begins.
    for(let i=0;i<publication.assets.length;i+=3){
      const batch=publication.assets.slice(i,i+3);
      const results=await Promise.allSettled(batch.map(async record=>
        cache.put(record.path,await verifiedResponse(record))));
      const failures=results.map((item,index)=>item.status==='rejected'
        ?{record:batch[index],error:item.reason}:null).filter(Boolean);
      if(failures.length){
        for(const record of batch){
          try{
            await cache.put(record.path,await verifiedResponse(record));
          }catch(error){
            throw Error('Offline asset install failed for '+record.path+': '+
              String(error?.message||error)+' (parallel batch also failed: '+
              failures.map(item=>String(item.error?.message||item.error)).join('; ')+')');
          }
        }
      }
    }
    await cache.put(MANIFEST,new Response(JSON.stringify(publication),{
      headers:{'Content-Type':'application/json'}}));
    // Verify the committed inventory before allowing this release to activate.
    const committed=new Set((await cache.keys()).map(key=>new URL(key.url).pathname));
    const missing=publication.assets.find(record=>!committed.has(record.path));
    if(missing)throw Error('Offline cache commit is missing '+missing.path);
    await self.skipWaiting();
  }catch(error){
    await caches.delete(CACHE);
    await reportInstallFailure(error);
    throw error;
  }
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Preserve one complete prior release for still-open tabs and rollback.
  // Do not remove anything until this release finished staging and activating.
  const previous=(await caches.keys()).filter(key=>key.startsWith(PREFIX)&&key!==CACHE);
  for(const key of previous.slice(0,-1))await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const active=await caches.open(CACHE);
    const match=await active.match(url.pathname,{ignoreSearch:false});
    if(match)return match;
    if(request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')){
      const index=await active.match('/index.html');
      if(index)return index;
    }
    return fetch(request);
  })());
});

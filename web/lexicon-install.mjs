/** Local-first, self-repairing Late Egyptian lexicon installation for browser PWAs.
 *  Uses its own IndexedDB database: no access to documents, appointments or learning.
 *  All payload bytes are SHA-256 verified on every open, including cached copies.
 */
export const DB_NAME='egyptian-lexicon-install-v1';
export const MANIFEST_URL='/lexicon/manifest.json';
export const PAYLOAD_URL='/lexicon/lexicon.json';
const FORMAT='egyptian-lexicon-install-v1';
let inFlight=null;
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
const enc=new TextEncoder();
const native=s=>typeof s==='string'&&[...s].some(c=>{const n=c.codePointAt(0);return n>=0x13000&&n<=0x1342f;});

export function validateCatalog(payload){
 if(!payload||payload.format!=='mdwnfr-predict-v1'||!payload.metadata||!Array.isArray(payload.entries)||!payload.entries.length)throw Error('Invalid Late Egyptian lexicon format');
 const refs=new Set();
 for(const entry of payload.entries){
  if(!entry||typeof entry.ref!=='string'||!entry.ref||refs.has(entry.ref)||!native(entry.signs))throw Error('Invalid or duplicate Late Egyptian spelling');
  refs.add(entry.ref);
 }
 if(payload.metadata.spelling_records!==payload.entries.length||typeof payload.metadata.complete!=='boolean')throw Error('Lexicon counts or completeness metadata invalid');
 return payload;
}
export function validateManifest(m){
 if(!m||m.format!==FORMAT||m.language!=='egy'||m.stage!=='Late Egyptian'||typeof m.release!=='string'||!m.release||
   !Number.isSafeInteger(m.bytes)||m.bytes<=0||!Number.isSafeInteger(m.spelling_records)||m.spelling_records<1||
   !/^[a-f0-9]{64}$/.test(m.sha256)||typeof m.complete!=='boolean')throw Error('Invalid lexicon release manifest');
 return m;
}
export async function validateSlot(slot){
 if(!slot)return null;
 try{
  validateManifest(slot.manifest);
  const data=slot.bytes;
  if(!(data instanceof ArrayBuffer)||data.byteLength!==slot.manifest.bytes)return null;
  if(await hash(data)!==slot.manifest.sha256)return null;
  const payload=validateCatalog(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));
  if(payload.entries.length!==slot.manifest.spelling_records||payload.metadata.complete!==slot.manifest.complete)return null;
  return {slot,payload};
 }catch{return null;}
}

// Separate authority from all personal documents and scheduler data.
export function idbStore(name=DB_NAME){
 let open=null;
 async function db(){
  if(!open)open=new Promise((resolve,reject)=>{
   const request=indexedDB.open(name,1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('releases'))request.result.createObjectStore('releases');};
   request.onsuccess=()=>{const d=request.result;d.onversionchange=()=>{d.close();open=null;};resolve(d);};
   request.onerror=()=>{open=null;reject(request.error||Error('Lexicon storage unavailable'));};
   request.onblocked=()=>{open=null;reject(Error('Lexicon database blocked by another tab'));};
  });return open;
 }
 function transaction(mode,fn){return db().then(d=>new Promise((resolve,reject)=>{
  const tx=d.transaction('releases',mode);const store=tx.objectStore('releases');
  let result;try{result=fn(store,tx);}catch(e){try{tx.abort();}catch{}reject(e);return;}
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Lexicon write failed'));
  tx.onabort=()=>reject(tx.error||Error('Lexicon write aborted'));
 }));}
 return {
  read:async()=>{const d=await db();return new Promise((resolve,reject)=>{
   const tx=d.transaction('releases','readonly'),s=tx.objectStore('releases');
   const a=s.get('active'),p=s.get('previous');
   tx.oncomplete=()=>resolve({active:a.result||null,previous:p.result||null});
   tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Lexicon read aborted'));
  });},
  activate:async(next,prior)=>transaction('readwrite',s=>{s.put(next,'active');if(prior)s.put(prior,'previous');else s.delete('previous');}),
  restore:async(valid)=>transaction('readwrite',s=>{s.put(valid,'active');s.delete('previous');})
 };
}
async function requestJSON(url,fetcher,timeoutMs){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const response=await fetcher(url,{cache:'no-store',signal:controller.signal});
  if(!response.ok)throw Error('Lexicon asset unavailable: '+response.status);
  return response;
 }finally{clearTimeout(timer);}
}
async function download(manifest,fetcher,timeoutMs){
 const response=await requestJSON(PAYLOAD_URL,fetcher,timeoutMs);
 const bytes=await response.arrayBuffer();
 if(bytes.byteLength!==manifest.bytes||await hash(bytes)!==manifest.sha256)throw Error('Downloaded lexicon checksum mismatch');
 const slot={manifest,bytes};
 if(!await validateSlot(slot))throw Error('Downloaded lexicon failed structural verification');
 return slot;
}
/** Dependency injection used for no-browser regression and simulated-corruption tests.
 *  Remote failure with a verified local release never prevents startup.
 */
export async function ensureLexiconImpl({store=idbStore(),fetcher=fetch,online=true,timeoutMs=3000}={}){
 const saved=await store.read();
 let active=await validateSlot(saved.active),previous=await validateSlot(saved.previous);
 let recovered=false;
 if(!active&&previous){await store.restore(previous.slot);active=previous;recovered=true;}
 let remote=null;
 if(online||!active){
  // When the local record is missing, also try the PWA's offline precache.
  // A cached, SHA-256-valid release can repair IndexedDB without connectivity.
  try{remote=validateManifest(await (await requestJSON(MANIFEST_URL,fetcher,active?1600:timeoutMs)).json());}
  catch(e){if(!active)throw Error('Lexicon unavailable and no verified local copy: '+String(e?.message||e));}
 }
 if(remote&&(!active||remote.sha256!==active.slot.manifest.sha256)){
  try{
   const next=await download(remote,fetcher,timeoutMs);
   await store.activate(next,active?.slot||null);active=await validateSlot(next);recovered=false;
  }catch(e){if(!active)throw Error('Lexicon download/repair failed: '+String(e?.message||e));}
 }
 if(!active)throw Error('No verified local lexicon and no downloadable release; connect once to install');
 return {payload:active.payload,bytes:active.slot.bytes,manifest:active.slot.manifest,
   status:recovered?'recovered':remote&&active.slot.manifest.sha256===remote.sha256?'verified':'offline',
   complete:active.slot.manifest.complete};
}
/** Runtime entry: one operation per page/worker. */
export function ensureLexicon(options={}){
 if(!inFlight)inFlight=ensureLexiconImpl({...options,online:options.online??(typeof navigator==='undefined'||navigator.onLine!==false)}).finally(()=>{inFlight=null;});
 return inFlight;
}
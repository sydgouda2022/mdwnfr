/** Versioned, local-first Egyptian lexicon installer. Integrity is not authentication. */
export const DB_NAME='egyptian-lexicon-install-v1';
const FORMAT='egyptian-lexicon-install-v1';
const SOURCES=new Set(['TLA-LE19','AES-LATE-CURATED','TLA-LE19+AES-LATE-CURATED','RAMSES-WORD-MODEL-2023']);
const HASH=/^[0-9a-f]{64}$/;
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
const SIGN=cp=>(cp>=0x13000&&cp<=0x1342f)||(cp>=0x13460&&cp<=0x143ff);
const OPS=new Set([0x13430,0x13431,0x13432,0x13433,0x13434,0x13435,0x13436,0x13439,0x1343a,0x1343b]);
const OPEN=new Map([[0x13437,0x13438],[0x1343c,0x1343d],[0x1343e,0x1343f]]);
const CLOSE=new Set(OPEN.values());
export function validEgyptianWord(value){
 if(typeof value!=='string'||!value||[...value].length>256)return false;
 let expecting=true,mirror=false,signs=0;const stack=[];
 for(const ch of value){
  const cp=ch.codePointAt(0);
  if(SIGN(cp)){signs++;expecting=false;mirror=false;}
  else if(cp===0x13440){if(!expecting||mirror)return false;mirror=true;}
  else if(OPEN.has(cp)){if(mirror)return false;stack.push(OPEN.get(cp));expecting=true;}
  else if(CLOSE.has(cp)){if(mirror||expecting||stack.pop()!==cp)return false;expecting=false;}
  else if(OPS.has(cp)){if(expecting||mirror)return false;expecting=true;}
  else return false;
 }
 return signs>0&&!expecting&&!mirror&&stack.length===0;
}
export function validateCatalog(payload){
 if(payload?.format!=='mdwnfr-predict-v1'||!payload.metadata||!Array.isArray(payload.entries)||!payload.entries.length)throw Error('Invalid Egyptian catalog');
 const meta=payload.metadata;
 if(meta.stage!=='Late Egyptian'||typeof meta.complete!=='boolean'||meta.spelling_records!==payload.entries.length)throw Error('Invalid Egyptian catalog metadata');
 const refs=new Set();
 for(const entry of payload.entries){
  if(!entry||typeof entry.ref!=='string'||!entry.ref||refs.has(entry.ref)||!validEgyptianWord(entry.signs))throw Error('Invalid or duplicate native spelling');
  if(typeof entry.source!=='string'||!entry.source||!Number.isSafeInteger(entry.attestations)||entry.attestations<0)throw Error('Missing spelling provenance or frequency');
  if(!SOURCES.has(entry.source))throw Error('Unknown source provenance');
  if(entry.source==='RAMSES-WORD-MODEL-2023'&&entry.lexical_identity_verified!==false)throw Error('Unlinked corpus form cannot claim a verified lemma');
  if(typeof entry.lemma==='string'&&entry.lemma.startsWith('unresolved:')&&entry.lexical_identity_verified===true)throw Error('Unresolved lemma cannot claim a verified identity');
  refs.add(entry.ref);
 }
 return payload;
}
export function validateManifest(m){
 if(m?.format!==FORMAT||m.language!=='egy'||m.stage!=='Late Egyptian'||typeof m.release!=='string'||!m.release||
 !Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>128*1024*1024||
 !Number.isSafeInteger(m.spelling_records)||m.spelling_records<1||
 !HASH.test(m.sha256)||typeof m.complete!=='boolean')throw Error('Invalid Egyptian release manifest');
 return m;
}
export async function validateSlot(slot){
 if(!slot)return null;
 try{
  validateManifest(slot.manifest);
  const bytes=slot.bytes;
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==slot.manifest.bytes)return null;
  if(await hash(bytes)!==slot.manifest.sha256)return null;
  const payload=validateCatalog(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  if(payload.entries.length!==slot.manifest.spelling_records||payload.metadata.complete!==slot.manifest.complete)return null;
  return {slot,payload};
 }catch{return null;}
}
export function idbStore(name=DB_NAME){
 let opened=null;
 function db(){
  if(opened)return opened;
  opened=new Promise((resolve,reject)=>{
   const req=indexedDB.open(name,1);let settled=false;
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('releases'))req.result.createObjectStore('releases');};
   req.onsuccess=()=>{
    const connection=req.result;
    if(settled){connection.close();return;}
    settled=true;connection.onversionchange=()=>{connection.close();opened=null;};resolve(connection);
   };
   req.onerror=()=>{if(settled)return;settled=true;opened=null;reject(req.error||Error('Lexicon IndexedDB unavailable'));};
   req.onblocked=()=>{if(settled)return;settled=true;opened=null;reject(Error('Another tab blocked the lexicon database upgrade'));};
  });
  return opened;
 }
 function write(callback){return db().then(d=>new Promise((resolve,reject)=>{
  const tx=d.transaction('releases','readwrite'),store=tx.objectStore('releases');
  try{callback(store);}catch(e){try{tx.abort();}catch{}reject(e);return;}
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('Lexicon write failed'));tx.onabort=()=>reject(tx.error||Error('Lexicon write aborted'));
 }));}
 return {
  read:async()=>{const d=await db();return new Promise((resolve,reject)=>{
   const tx=d.transaction('releases','readonly'),store=tx.objectStore('releases'),a=store.get('active'),p=store.get('previous');
   tx.oncomplete=()=>resolve({active:a.result||null,previous:p.result||null});
   tx.onerror=()=>reject(tx.error||Error('Lexicon read failed'));tx.onabort=()=>reject(tx.error||Error('Lexicon read aborted'));
  });},
  activate:(next,prior)=>write(s=>{s.put(next,'active');if(prior)s.put(prior,'previous');else s.delete('previous');}),
  restore:valid=>write(s=>{s.put(valid,'active');s.delete('previous');})
 };
}
/**
 * Read bounded responses, timing the complete body, not just response headers.
 * Browser fetch supports streams; simple injected test fetchers may provide
 * arrayBuffer()/json() only.
 */
async function readResponse(url,fetcher,timeoutMs,kind,maxBytes=65536){
 const controller=new AbortController();
 let timer;
 try{
  const operation=(async()=>{
   const response=await fetcher(url,{cache:'no-store',signal:controller.signal});
   if(!response?.ok)throw Error('Lexicon asset unavailable: '+String(response?.status));
   if(kind==='json')return response.json();
   if(kind!=='arrayBuffer')throw new TypeError('Unexpected response type');
   const length=Number(response.headers?.get?.('content-length'));
   if(Number.isFinite(length)&&length>maxBytes)throw Error('Lexicon download exceeds maximum size');
   if(response.body&&typeof response.body.getReader==='function'){
    const reader=response.body.getReader(),parts=[];let total=0;
    try{
     while(true){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw Error('Invalid lexicon download chunk');
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel().catch(()=>{});throw Error('Lexicon download exceeds maximum size');}
      parts.push(value);
     }
    }finally{reader.releaseLock();}
    const merged=new Uint8Array(total);let offset=0;
    for(const part of parts){merged.set(part,offset);offset+=part.byteLength;}
    return merged.buffer;
   }
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength>maxBytes)throw Error('Lexicon download exceeds maximum size');
   return bytes;
  })();
  return await Promise.race([operation,new Promise((_,reject)=>{
   timer=setTimeout(()=>{controller.abort();reject(Error('Lexicon asset timed out'));},timeoutMs);
  })]);
 }finally{clearTimeout(timer);}
}
async function download(manifest,fetcher,timeoutMs,payloadUrl){
 const bytes=await readResponse(payloadUrl,fetcher,timeoutMs,'arrayBuffer',manifest.bytes);
 if(bytes.byteLength!==manifest.bytes||await hash(bytes)!==manifest.sha256)
  throw Error('Downloaded lexicon checksum mismatch');
 const payload=validateCatalog(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 if(payload.entries.length!==manifest.spelling_records||payload.metadata.complete!==manifest.complete)
  throw Error('Downloaded lexicon metadata disagrees with its manifest');
 return {slot:{manifest,bytes},payload};
}
/**
 * Verified immutable install. An existing matching local release is reused
 * without network access unless refresh=true. A pin is enforced on both
 * restored and downloaded records. Application code owns version migrations.
 */
export async function ensureLexiconImpl({
 store=idbStore(),fetcher=globalThis.fetch,online=true,refresh=false,timeoutMs=30000,
 manifestUrl,payloadUrl,expectedSha256=null
}={}){
 if(!manifestUrl||!payloadUrl||typeof fetcher!=='function')
  throw new TypeError('Explicit lexicon URLs and fetcher are required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)
  throw new RangeError('Invalid download timeout');
 if(expectedSha256!==null&&!HASH.test(expectedSha256))
  throw new TypeError('Expected release SHA-256 must be 64 lowercase hex characters');
 const matches=valid=>valid&&(!expectedSha256||valid.slot.manifest.sha256===expectedSha256);
 const saved=await store.read();
 let active=await validateSlot(saved.active);
 let previous=await validateSlot(saved.previous);
 // A verified release from a different application edition must not be used.
 if(!matches(active))active=null;
 if(!matches(previous))previous=null;
 let recovered=false;
 if(!active&&previous){await store.restore(previous.slot);active=previous;recovered=true;}
 if(active&&!refresh)return result(active,recovered?'recovered':'verified');
 if(!online){
  if(active)return result(active,recovered?'recovered':'offline');
  throw Error('No verified matching local release; network access is disabled');
 }
 let remote=null;
 try{
  remote=validateManifest(await readResponse(manifestUrl,fetcher,active?3000:timeoutMs,'json'));
  if(expectedSha256&&remote.sha256!==expectedSha256)
   throw Error('Remote dictionary does not match pinned SHA-256');
 }catch(error){
  if(!active)throw Error('No verified matching release: '+String(error?.message||error));
  return result(active,recovered?'recovered':'offline');
 }
 if(active&&remote.sha256===active.slot.manifest.sha256)
  return result(active,recovered?'recovered':'verified');
 try{
  const installed=await download(remote,fetcher,timeoutMs,payloadUrl);
  await store.activate(installed.slot,active?.slot||null);
  return result(installed,false);
 }catch(error){
  if(!active)throw Error('Lexicon download/repair failed: '+String(error?.message||error));
  return result(active,recovered?'recovered':'offline');
 }
}
function result(valid,status){
 return {payload:valid.payload,bytes:valid.slot.bytes,manifest:valid.slot.manifest,
  status,complete:valid.slot.manifest.complete};
}
export function ensureLexicon(options={}){return ensureLexiconImpl(options);}

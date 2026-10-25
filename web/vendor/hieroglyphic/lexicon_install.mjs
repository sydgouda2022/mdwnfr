/** Versioned, local-first Egyptian lexicon installer. Integrity is not authentication. */
export const DB_NAME='egyptian-lexicon-install-v1';
export const MANIFEST_URL=new URL('./lexicon/manifest.json',import.meta.url).href;
export const PAYLOAD_URL=new URL('./lexicon/lexicon.json',import.meta.url).href;
const FORMAT='egyptian-lexicon-install-v1';
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
  if(entry.source==='RAMSES-WORD-MODEL-2023'&&entry.lexical_identity_verified!==false)throw Error('Unlinked corpus form cannot claim a verified lemma');
  refs.add(entry.ref);
 }
 return payload;
}
export function validateManifest(m){
 if(m?.format!==FORMAT||m.language!=='egy'||m.stage!=='Late Egyptian'||typeof m.release!=='string'||!m.release||
 !Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>128*1024*1024||
 !Number.isSafeInteger(m.spelling_records)||m.spelling_records<1||
 !/^[0-9a-f]{64}$/.test(m.sha256)||typeof m.complete!=='boolean')throw Error('Invalid Egyptian release manifest');
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
async function readResponse(url,fetcher,timeoutMs,method){
 const controller=new AbortController();
 let timer;
 try{
  return await Promise.race([
   (async()=>{
    const response=await fetcher(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('Lexicon asset unavailable: '+response.status);
    return response[method]();
   })(),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Lexicon asset timed out'));},timeoutMs);})
  ]);
 }finally{clearTimeout(timer);}
}
async function download(manifest,fetcher,timeoutMs,payloadUrl){
 const bytes=await readResponse(payloadUrl,fetcher,timeoutMs,'arrayBuffer');
 if(bytes.byteLength!==manifest.bytes||await hash(bytes)!==manifest.sha256)throw Error('Downloaded lexicon checksum mismatch');
 const slot={manifest,bytes};
 if(!await validateSlot(slot))throw Error('Downloaded lexicon failed structural verification');
 return slot;
}
/** Failure to update must never erase the last verified local release. */
export async function ensureLexiconImpl({store=idbStore(),fetcher=fetch,online=true,timeoutMs=6000,
 manifestUrl=MANIFEST_URL,payloadUrl=PAYLOAD_URL}={}){
 if(!manifestUrl||!payloadUrl||typeof fetcher!=='function')throw new TypeError('Lexicon URLs and fetcher are required');
 const saved=await store.read();
 let active=await validateSlot(saved.active),previous=await validateSlot(saved.previous);
 let recovered=false;
 if(!active&&previous){await store.restore(previous.slot);active=previous;recovered=true;}
 let remote=null;
 if(online||!active){
  try{remote=validateManifest(await readResponse(manifestUrl,fetcher,active?2000:timeoutMs,'json'));}
  catch(e){if(!active)throw Error('Lexicon unavailable and no verified local copy: '+String(e?.message||e));}
 }
 if(remote&&(!active||remote.sha256!==active.slot.manifest.sha256)){
  try{const next=await download(remote,fetcher,timeoutMs,payloadUrl);await store.activate(next,active?.slot||null);
   active=await validateSlot(next);recovered=false;
  }catch(e){if(!active)throw Error('Lexicon download/repair failed: '+String(e?.message||e));}
 }
 if(!active)throw Error('No verified local lexicon and no downloadable release');
 return {payload:active.payload,bytes:active.slot.bytes,manifest:active.slot.manifest,
  status:recovered?'recovered':remote&&remote.sha256===active.slot.manifest.sha256?'verified':'offline',
  complete:active.slot.manifest.complete};
}
export function ensureLexicon(options={}){
 return ensureLexiconImpl({...options,online:options.online??(typeof navigator==='undefined'||navigator.onLine!==false)});
}

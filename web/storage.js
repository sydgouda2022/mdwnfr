/* One device-local IndexedDB. Library browsing never loads embedded image data.
   No legacy migrations or old data conversion. */
const DB='mdwnfr-canonical-v1';
const STORE='documents';
const PROFILE='writing-profile';
const INDEX='document-index';
const SNAPSHOTS='document-snapshots';
const SNAPSHOT_META='snapshot-metadata';
const SNAPSHOT_INTERVAL_MS=5*60*1000;
const MAX_SNAPSHOT_BYTES=40*1024*1024;
const MAX_SNAPSHOT_COUNT=48;
const SNAPSHOT_RETENTION_MS=365*24*60*60*1000;
const snapshotKey=(id,when)=>`${id}:${String(when).padStart(13,'0')}:${crypto.randomUUID()}`;
const snapshotBytes=doc=>new TextEncoder().encode(JSON.stringify(doc)).byteLength;
// Recent recovery points are dense, while older points become progressively sparse.
function pruneSnapshotMetadata(records,now,protectedKey=null){
 const periods=[
  [60*60*1000,5*60*1000],
  [24*60*60*1000,60*60*1000],
  [7*24*60*60*1000,6*60*60*1000],
  [30*24*60*60*1000,24*60*60*1000],
  [90*24*60*60*1000,7*24*60*60*1000],
  [SNAPSHOT_RETENTION_MS,30*24*60*60*1000],
 ];
 const keep=new Set(),buckets=new Set();let total=0;
 for(const entry of [...records].sort((a,b)=>b.captured_at-a.captured_at)){
  const age=Math.max(0,now-entry.captured_at);
  const group=periods.findIndex(([limit])=>age<=limit);
  if(group<0)continue;
  const period=periods[group][1],bucket=group+':'+Math.floor(entry.captured_at/period);
  const forced=entry.key===protectedKey;
  if(!forced&&(buckets.has(bucket)||keep.size>=MAX_SNAPSHOT_COUNT||total+entry.bytes>MAX_SNAPSHOT_BYTES))continue;
  keep.add(entry.key);total+=entry.bytes;buckets.add(bucket);
 }
 // Do not sacrifice the pre-restore version, even when pruning older entries.
 return records.filter(entry=>!keep.has(entry.key));
}

let connection=null;
const summary=doc=>({id:doc.id,name:doc.name,revision:doc.revision,
  surface:doc.surface,direction:doc.direction,
  item_count:Array.isArray(doc.items)?doc.items.length:0,
  word_count:Array.isArray(doc.items)?doc.items.filter(item=>item.type==='word').length:0,
  created_at:doc.created_at||'',updated_at:doc.updated_at||''});
function database(){
 if(connection)return connection;
 connection=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{
   const db=req.result;
   db.createObjectStore(STORE,{keyPath:'id'});
   db.createObjectStore(PROFILE,{keyPath:'id'});
   db.createObjectStore(INDEX,{keyPath:'id'});
   db.createObjectStore(SNAPSHOTS,{keyPath:'key'});
   const m=db.createObjectStore(SNAPSHOT_META,{keyPath:'key'});
   m.createIndex('by_document','document_id',{unique:false});
  };
  req.onsuccess=()=>{const db=req.result;
   db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
  req.onerror=()=>{connection=null;reject(req.error);};
 });
 return connection;
}
async function operation(mode,fn,store=STORE){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,mode);let value;
  let request;
  try{request=fn(tx.objectStore(store));}catch(e){tx.abort();reject(e);return;}
  request.onsuccess=()=>{value=request.result;};
  tx.oncomplete=()=>resolve(value);
  tx.onerror=()=>reject(tx.error||new Error('Document storage transaction failed'));
  tx.onabort=()=>reject(tx.error||new Error('Document storage transaction aborted'));
 });
}
// A document, its library metadata, and any recovery snapshot commit together.
// A failed transaction never leaves a snapshot pointing at an unsaved document.
async function mutateDocument(id,doc){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,INDEX,SNAPSHOTS,SNAPSHOT_META],'readwrite');
  const docs=tx.objectStore(STORE),index=tx.objectStore(INDEX);
  const snapshots=tx.objectStore(SNAPSHOTS),metas=tx.objectStore(SNAPSHOT_META);
  let failed=false;
  const fail=error=>{failed=true;try{tx.abort();}catch(_){};reject(error);};
  try{
   if(!doc){
    docs.delete(id);index.delete(id);
    const req=metas.index('by_document').getAll(IDBKeyRange.only(id));
    req.onsuccess=()=>{for(const meta of req.result){snapshots.delete(meta.key);metas.delete(meta.key);}};
   }else{
    const oldReq=docs.get(id),summaryReq=index.get(id);
    let previous,oldIndex,loaded=0;
    const ready=()=>{
     if(++loaded!==2)return;
     const now=Date.now();
     const due=!oldIndex?.last_snapshot_at || now-oldIndex.last_snapshot_at>=SNAPSHOT_INTERVAL_MS;
     const previousDocument=previous||doc;
     // Only snapshot a real prior revision, or the original new document.
     const canCapture=due&&previousDocument&&
       (!previous||previous.revision!==doc.revision)&&snapshotBytes(previousDocument)<=MAX_SNAPSHOT_BYTES;
     const updatedIndex={...summary(doc),last_snapshot_at:oldIndex?.last_snapshot_at||0};
     docs.put(doc);
     if(canCapture){
      const key=snapshotKey(id,now),bytes=snapshotBytes(previousDocument);
      const meta={key,document_id:id,captured_at:now,revision:previousDocument.revision,
                  name:previousDocument.name||'Untitled',bytes,reason:'autosave'};
      snapshots.put({key,document_id:id,document:structuredClone(previousDocument)});
      metas.put(meta);
      updatedIndex.last_snapshot_at=now;
      const req=metas.index('by_document').getAll(IDBKeyRange.only(id));
      req.onsuccess=()=>{
       const unique=[...req.result.filter(item=>item.key!==key),meta];
       for(const drop of pruneSnapshotMetadata(unique,now,key)){
        snapshots.delete(drop.key);metas.delete(drop.key);
       }
      };
     }
     index.put(updatedIndex);
    };
    oldReq.onsuccess=()=>{previous=oldReq.result;ready();};
    summaryReq.onsuccess=()=>{oldIndex=summaryReq.result;ready();};
   }
  }catch(e){fail(e);return;}
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>{if(!failed)reject(tx.error||new Error('Save failed'));};
  tx.onabort=()=>{if(!failed)reject(tx.error||new Error('Save aborted'));};
 });
}
export async function save(doc){return mutateDocument(doc.id,doc);}

export async function listSnapshots(id){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(SNAPSHOT_META,'readonly');
  const req=tx.objectStore(SNAPSHOT_META).index('by_document').getAll(IDBKeyRange.only(id));
  req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.captured_at-a.captured_at));
  req.onerror=()=>reject(req.error);
 });
}

// Restoring always takes a fresh checkpoint of the current document first.
// The restored revision is NEW, so future editing cannot replay an old revision.
export async function restoreSnapshot(id,key){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,INDEX,SNAPSHOTS,SNAPSHOT_META],'readwrite');
  const docs=tx.objectStore(STORE),index=tx.objectStore(INDEX);
  const snapshots=tx.objectStore(SNAPSHOTS),metas=tx.objectStore(SNAPSHOT_META);
  let restored=null;
  const currentReq=docs.get(id),sourceReq=snapshots.get(key);
  let current,source,count=0;
  const ready=()=>{
   if(++count!==2)return;
   if(!current||!source||source.document_id!==id){tx.abort();return;}
   const now=Date.now(),checkpointBytes=snapshotBytes(current);
   // Never restore without a reversible pre-restore checkpoint.
   if(checkpointBytes>MAX_SNAPSHOT_BYTES){tx.abort();return;}
   const originalKey=snapshotKey(id,now);
   snapshots.put({key:originalKey,document_id:id,document:structuredClone(current)});
   metas.put({key:originalKey,document_id:id,captured_at:now,revision:current.revision,
              name:current.name||'Untitled',bytes:checkpointBytes,reason:'before-restore'});
   restored={...structuredClone(source.document),id,revision:current.revision+1,
             updated_at:new Date(now).toISOString()};
   docs.put(restored);
   index.put({...summary(restored),last_snapshot_at:now});
   const req=metas.index('by_document').getAll(IDBKeyRange.only(id));
   req.onsuccess=()=>{
    const checkpoint={key:originalKey,document_id:id,captured_at:now,revision:current.revision,
              bytes:checkpointBytes,reason:'before-restore'};
    const entries=[...req.result.filter(entry=>entry.key!==originalKey),checkpoint];
    for(const item of pruneSnapshotMetadata(entries,now,originalKey)){
     snapshots.delete(item.key);metas.delete(item.key);
    }
   };
  };
  currentReq.onsuccess=()=>{current=currentReq.result;ready();};
  sourceReq.onsuccess=()=>{source=sourceReq.result;ready();};
  tx.oncomplete=()=>resolve(restored);
  tx.onerror=()=>reject(tx.error||new Error('Restore failed'));
  tx.onabort=()=>reject(new Error('Restore could not preserve the current document; nothing was changed'));
 });
}
export async function load(id){return operation('readonly',s=>s.get(id));}
export async function list(){return operation('readonly',s=>s.getAll(),INDEX);}
export async function remove(id){return mutateDocument(id,null);}
export async function loadProfile(){return (await operation('readonly',s=>s.get('profile'),PROFILE))||null;}
export async function saveProfile(profile){return operation('readwrite',s=>s.put({...profile,id:'profile'}),PROFILE);}

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
const MAX_LARGE_SNAPSHOT_BYTES=120*1024*1024;
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
 // Keep the latest pre-restore checkpoint even if it exceeds the automatic
 // snapshot budget. Without it, a large illustrated restoration is not
 // reversible. Retain no more than one oversized pre-restore safety point.
 const ordered=[...records].sort((a,b)=>b.captured_at-a.captured_at);
 const latestRestore=ordered.find(entry=>entry.reason==='before-restore');
 const latestLarge=ordered.find(entry=>entry.reason==='autosave-large');
 const retained=new Set(ordered.filter(entry=>
  entry.key===protectedKey||entry.key===latestRestore?.key||
  entry.key===latestLarge?.key).map(entry=>entry.key));
 const buckets=new Set();let total=0;
 for(const entry of ordered){
  if(retained.has(entry.key))continue;
  const age=Math.max(0,now-entry.captured_at);
  const group=periods.findIndex(([limit])=>age<=limit);
  if(group<0)continue;
  const period=periods[group][1],bucket=group+':'+Math.floor(entry.captured_at/period);
  if(buckets.has(bucket)||retained.size>=MAX_SNAPSHOT_COUNT||
     total+entry.bytes>MAX_SNAPSHOT_BYTES)continue;
  retained.add(entry.key);total+=entry.bytes;buckets.add(bucket);
 }
 return records.filter(entry=>!retained.has(entry.key));
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
// Large recovery is best-effort in a SEPARATE transaction. A quota error in
// backup storage must never roll back an otherwise valid document save.
async function captureLargeSnapshot(id,previous,capturedAt,bytes){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([INDEX,SNAPSHOTS,SNAPSHOT_META],'readwrite');
  const index=tx.objectStore(INDEX),snapshots=tx.objectStore(SNAPSHOTS);
  const metas=tx.objectStore(SNAPSHOT_META);
  const indexReq=index.get(id);
  const existingReq=metas.index('by_document').getAll(IDBKeyRange.only(id));
  let loaded=0,meta;
  const ready=()=>{
   if(++loaded!==2)return;
   const old=indexReq.result;
   if(!old || old.last_snapshot_at>=capturedAt)return;
   const key=snapshotKey(id,capturedAt);
   meta={key,document_id:id,captured_at:capturedAt,revision:previous.revision,
    name:previous.name||'Untitled',bytes,reason:'autosave-large'};
   snapshots.put({key,document_id:id,document:structuredClone(previous)});
   metas.put(meta);
   index.put({...old,last_snapshot_at:capturedAt});
   for(const drop of pruneSnapshotMetadata([...existingReq.result,meta],capturedAt,key)){
    snapshots.delete(drop.key);metas.delete(drop.key);
   }
  };
  indexReq.onsuccess=ready;existingReq.onsuccess=ready;
  tx.oncomplete=()=>resolve(Boolean(meta));
  tx.onerror=()=>reject(tx.error||Error('Large recovery snapshot could not be saved'));
  tx.onabort=()=>reject(tx.error||Error('Large recovery snapshot aborted'));
 });
}

async function mutateDocument(id,doc,expectedRevision=undefined){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,INDEX,SNAPSHOTS,SNAPSHOT_META],'readwrite');
  const docs=tx.objectStore(STORE),index=tx.objectStore(INDEX);
  const snapshots=tx.objectStore(SNAPSHOTS),metas=tx.objectStore(SNAPSHOT_META);
  let failed=false,largeCandidate=null;
  const fail=error=>{failed=true;try{tx.abort();}catch(_){};reject(error);};
  try{
   if(!doc){
    // Never delete newer content from a second tab.
    const current=docs.get(id);
    current.onsuccess=()=>{
     if(expectedRevision!==undefined&&(current.result?.revision??null)!==expectedRevision){
      fail(new Error('Another tab changed this document. Deletion was canceled.'));return;
     }
     docs.delete(id);index.delete(id);
     const req=metas.index('by_document').getAll(IDBKeyRange.only(id));
     req.onsuccess=()=>{for(const meta of req.result){snapshots.delete(meta.key);metas.delete(meta.key);}};
    };
   }else{
    const oldReq=docs.get(id),summaryReq=index.get(id);
    let previous,oldIndex,loaded=0;
    const ready=()=>{
     if(++loaded!==2)return;
     const now=Date.now();
     // Compare the exact stored revision, not just whether it is lower
     // than the editor's revision. Several local edits may be coalesced.
     const actual=previous?.revision??null;
     const expected=expectedRevision===undefined?(previous?doc.revision-1:null):expectedRevision;
     if(actual!==expected||(previous&&doc.revision<=previous.revision)){
      fail(new Error('Another tab modified this document. Unsaved edits remain here; export a backup before reopening.'));return;
     }
      const due=!oldIndex?.last_snapshot_at || now-oldIndex.last_snapshot_at>=SNAPSHOT_INTERVAL_MS;
     const previousDocument=previous||doc;
     const eligible=due&&previousDocument&&(!previous||previous.revision!==doc.revision);
     const bytes=eligible?snapshotBytes(previousDocument):0;
     const canCapture=eligible&&bytes<=MAX_SNAPSHOT_BYTES;
     if(eligible&&bytes>MAX_SNAPSHOT_BYTES&&bytes<=MAX_LARGE_SNAPSHOT_BYTES)
      largeCandidate={document:previousDocument,at:now,bytes};
     const updatedIndex={...summary(doc),created_at:oldIndex?.created_at||doc.created_at||new Date(now).toISOString(),updated_at:new Date(now).toISOString(),last_snapshot_at:oldIndex?.last_snapshot_at||0};
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
  tx.oncomplete=()=>{
   if(!largeCandidate){resolve();return;}
   // Never surface optional backup-quota failures as document-save failures.
   captureLargeSnapshot(id,largeCandidate.document,largeCandidate.at,largeCandidate.bytes)
    .then(()=>resolve(),()=>resolve());
  };
  tx.onerror=()=>{if(!failed)reject(tx.error||new Error('Save failed'));};
  tx.onabort=()=>{if(!failed)reject(tx.error||new Error('Save aborted'));};
 });
}
export async function save(doc,expectedRevision){return mutateDocument(doc.id,doc,expectedRevision);}

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
export async function restoreSnapshot(id,key,expectedRevision=undefined){
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
   if(!current||!source||source.document_id!==id||
       (expectedRevision!==undefined&&current.revision!==expectedRevision)){tx.abort();return;}
   const now=Date.now(),checkpointBytes=snapshotBytes(current);
   // The 40 MiB budget limits AUTOMATIC history, not a mandatory rollback
   // checkpoint. IndexedDB quota is the real limit, and the single
   // transaction aborts unchanged if storage quota is exhausted.
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
              name:current.name||'Untitled',bytes:checkpointBytes,reason:'before-restore'};
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
export async function remove(id,expectedRevision){return mutateDocument(id,null,expectedRevision);}
export async function loadProfile(){return (await operation('readonly',s=>s.get('profile'),PROFILE))||null;}
// Atomic cross-tab profile operations: every change starts from persisted data.
export async function updateProfile(change){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(PROFILE,'readwrite'),store=tx.objectStore(PROFILE);
  let updated;
  store.get('profile').onsuccess=event=>{
   try{
    const old=event.target.result||{};
    const p={id:'profile',global_choices:{...(old.global_choices||{})},
     document_choices:{...(old.document_choices||{})},
     personal_entries:[...(old.personal_entries||[])]};
    if(change.op==='choice'){
     const key=change.spelling,id=change.document_id;
     if(typeof key!=='string'||!key||key.length>256||typeof id!=='string'||!id)
      throw Error('Invalid spelling choice');
     p.global_choices[key]=Math.min(10000,(Number(p.global_choices[key])||0)+1);
     const choices={...(p.document_choices[id]||{})};
     choices[key]=Math.min(10000,(Number(choices[key])||0)+1);
     p.document_choices[id]=choices;
    }else if(change.op==='add-word'){
     if(typeof change.spelling!=='string'||!change.spelling||change.spelling.length>256)
      throw Error('Invalid personal spelling');
     if(!p.personal_entries.some(item=>item.signs===change.spelling)){
      if(p.personal_entries.length>=5000)throw Error('My Words limit reached (5000)');
      p.personal_entries.push({signs:change.spelling});
     }
    }else if(change.op==='delete-word'){
     p.personal_entries=p.personal_entries.filter(item=>item.signs!==change.spelling);
    }else if(change.op==='forget-document'){
     delete p.document_choices[change.document_id];
    }else throw Error('Invalid profile operation');
    updated=p;store.put(p);
   }catch(error){try{tx.abort();}catch{}reject(error);}
  };
  tx.oncomplete=()=>resolve(updated);
  tx.onerror=()=>reject(tx.error||Error('Profile update failed'));
  tx.onabort=()=>reject(tx.error||Error('Profile update aborted'));
 });
}

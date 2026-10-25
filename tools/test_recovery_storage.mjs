/* Runs actual web/storage.js operations using a deterministic IndexedDB transaction
   emulator. Network/service-worker behavior is NOT simulated or claimed. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

let now=1_780_000_000_000;
let failNextDocumentWrite=false;
const tables=new Map();
const schema=new Map();
const db={
  objectStoreNames:{contains:name=>tables.has(name)},
  createObjectStore(name){tables.set(name,new Map());schema.set(name,{});return {
    createIndex(index,field){schema.get(name)[index]=field;},
    openCursor(){return {set onsuccess(fn){setImmediate(()=>fn({target:{result:null}}));}};}
  };},
  transaction(names,mode){
    const selection=(Array.isArray(names)?names:[names]);
    let pending=0,aborted=false,completionQueued=false;
    const changes=new Map(selection.map(name=>[name,new Map(tables.get(name))]));
    const tx={oncomplete:null,onerror:null,onabort:null,
      abort(){aborted=true;setImmediate(()=>tx.onabort?.());},
      objectStore(name){
        if(!changes.has(name))throw Error('Store not in transaction');
        const map=changes.get(name);
        function request(work){
          pending++;const r={onsuccess:null,onerror:null,result:undefined,error:null};
          setImmediate(()=>{
            if(aborted)return;
            try{r.result=work();r.onsuccess?.({target:r});}
            catch(e){r.error=e;r.onerror?.({target:r});aborted=true;tx.onerror?.();tx.onabort?.();}
            pending--;complete();
          });
          return r;
        }
        return {
          get(k){return request(()=>structuredClone(map.get(k)));},
          getAll(){return request(()=>[...map.values()].map(x=>structuredClone(x)));},
          put(o){return request(()=>{if(name==='documents'&&failNextDocumentWrite){failNextDocumentWrite=false;throw Error('Simulated quota/IO failure');}map.set(o.key??o.id,structuredClone(o));return o.key??o.id;});},
          delete(k){return request(()=>{map.delete(k);});},
          index(indexName){return {getAll(query){return request(()=>[...map.values()].filter(item=>item[schema.get(name)[indexName]]===query.value).map(item=>structuredClone(item)));}};},
        };
      }
    };
    function complete(){
      if(aborted||pending||completionQueued)return;
      completionQueued=true;
      setImmediate(()=>{
        if(aborted)return;
        if(pending){completionQueued=false;return;}
        for(const [name,values] of changes)tables.set(name,values);
        tx.oncomplete?.();
      });
    }
    return tx;
  },
  onversionchange:null,close(){}
};
const indexedDB={open(name,version){
 const req={result:db,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,transaction:{objectStore(name){return {openCursor(){return {set onsuccess(fn){setImmediate(()=>fn({target:{result:null}}));}};}};}}};
 setImmediate(()=>{if(req.onupgradeneeded)req.onupgradeneeded();req.onsuccess?.();});
 return req;
}};
const DateFake=class extends Date {static now(){return now;}};
const context=vm.createContext({indexedDB,IDBKeyRange:{only:value=>({value})},
 TextEncoder,structuredClone,crypto:webcrypto,Date:DateFake,console,setImmediate});
const source=fs.readFileSync(new URL('../web/storage.js',import.meta.url),'utf8');
vm.runInContext(source.replaceAll('export async function ','async function ')+
 'globalThis.storage={save,load,list,remove,listSnapshots,restoreSnapshot};',context);
const {save,load,list,remove,listSnapshots,restoreSnapshot}=context.storage;
const doc=(rev)=>({id:'d1',name:'Papyrus',revision:rev,items:[{type:'word',id:'w1',signs:['𓅓']},...Array.from({length:rev},(_,i)=>({type:'word',id:`w${i+2}`,signs:['𓏏']}))],surface:'A4',direction:'rtl',created_at:'2026-01-01',updated_at:new DateFake(now).toISOString()});
await save(doc(0));
assert.equal((await listSnapshots('d1')).length,1,'first document gets a baseline snapshot');
await save(doc(1));
assert.equal((await listSnapshots('d1')).length,1,'rapid edit does not duplicate baseline');
now+=6*60*1000;
await save(doc(2));
let history=await listSnapshots('d1');
assert.equal(history.length,2);
assert.equal(history[0].revision,1,'checkpoint captures preceding content');
let restored=await restoreSnapshot('d1',history[0].key);
assert.equal(restored.revision,3);
assert.equal(restored.items.length,2);
assert.equal((await load('d1')).revision,3);
history=await listSnapshots('d1');
const checkpoint=history.find(item=>item.reason==='before-restore');
assert(checkpoint,'prior version must be retained when restoring');
assert.equal(checkpoint.revision,2);
restored=await restoreSnapshot('d1',checkpoint.key);
assert.equal(restored.items.length,3,'restore itself is reversible');
assert.equal(restored.revision,4);
await assert.rejects(restoreSnapshot('d1','missing'));
assert.equal((await load('d1')).revision,4,'invalid restore must not change current doc');
// A write failure must not publish partial snapshots or index changes.
const beforeFailure=(await listSnapshots('d1')).length;
failNextDocumentWrite=true;
await assert.rejects(save(doc(5)));
assert.equal((await load('d1')).revision,4);
assert.equal((await listSnapshots('d1')).length,beforeFailure);

// Repeated edits across many hours must thin the history and remain bounded.
await save({...doc(0),id:'d2'});
for(let i=1;i<=100;i++){
 now+=60*60*1000;
 await save({...doc(i),id:'d2'});
}
const thinned=await listSnapshots('d2');
assert(thinned.length<=48,'bounded checkpoint count');
assert(thinned.length<100,'aging checkpoints are thinned');
await remove('d2');
await remove('d1');
assert.equal((await list()).length,0);
assert.equal((await listSnapshots('d1')).length,0,'delete cleans recovery points');
console.log('PASS: IndexedDB storage transactions, temporal snapshots, reversible restoration, rejected restore and deletion cleanup (simulated storage engine)');

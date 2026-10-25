/**
 * Headless, browser- and Node-compatible Egyptian Unicode keyboard API.
 * No DOM, editor, UI, service worker, account, hosted prediction service
 * or implicit network call. API version is independent of data release.
 */
import {SIGN_CATALOG} from './keyboard_catalog.js';
import {prepareKeyboardIndex,predictKeyboard} from './keyboard_search.mjs';
import {validEgyptianWord,ensureLexiconImpl,idbStore} from './lexicon_install.mjs';

export const API_VERSION='2.0.1';
export const KEYBOARD_GROUPS=Object.freeze(['uni','bi','tri']);
const GROUPS=Object.freeze({uni:'single',bi:'dual',tri:'triple',
 uniliteral:'single',biliteral:'dual',triliteral:'triple'});
const loadInFlight=new Map();
function canonicalGroup(group){
 if(group==='all')return 'all';
 if(typeof group!=='string'||!Object.hasOwn(GROUPS,group))
  throw new RangeError('Unknown Egyptian sign group');
 return GROUPS[group];
}
const signs=Object.freeze(Object.entries(SIGN_CATALOG).flatMap(([group,entries])=>{
 if(!['single','dual','triple'].includes(group)||!Array.isArray(entries))
  throw Error('Invalid curated keyboard group');
 return entries.map(item=>Object.freeze({
  code:item.code,glyph:item.glyph,name:item.name,
  group:group==='single'?'uni':group==='dual'?'bi':'tri'
 }));
}));
if(!signs.length||signs.some(s=>!s.code||!s.glyph||!s.name))
 throw Error('Empty/invalid curated sign catalog');
const rankCode=(a,b)=>a.code.localeCompare(b.code,'en',{numeric:true});
function queryKey(q){
 if(typeof q!=='string')throw new TypeError('Sign query must be a string');
 return q.trim().toLocaleLowerCase('en');
}
/** A synchronous API backed by trusted, already loaded object data.
 * This constructor DOES NOT verify a raw catalog's publisher or checksum.
 */
export function createKeyboardFromData({lexicon=null,manifest=null}={}){
 const index=lexicon===null?null:prepareKeyboardIndex('egy',lexicon);
 const info=Object.freeze({
  apiVersion:API_VERSION,language:'egy',stage:'Late Egyptian',
  status:index?'provided':'signs-only',complete:lexicon?.metadata?.complete===true,
  spellingRecords:index?.rows.length||0,
  release:manifest?.release||null,sha256:manifest?.sha256||null
 });
 return Object.freeze({
  apiVersion:API_VERSION,info,
  getSigns(group='all'){
   const selected=canonicalGroup(group);
   return selected==='all'?signs.slice():signs.filter(s=>GROUPS[s.group]===selected);
  },
  searchSigns(query='',{group='all',limit=100}={}){
   const selected=canonicalGroup(group),key=queryKey(query);
   if(!Number.isSafeInteger(limit)||limit<1||limit>1000)
    throw new RangeError('Invalid sign search limit');
   const results=signs.filter(s=>(selected==='all'||GROUPS[s.group]===selected)&&
    (!key||s.code.toLocaleLowerCase('en').includes(key)||s.name.toLocaleLowerCase('en').includes(key)));
   results.sort((a,b)=>{
    const aa=a.code.toLocaleLowerCase('en').startsWith(key)?0:1;
    const bb=b.code.toLocaleLowerCase('en').startsWith(key)?0:1;
    return aa-bb||rankCode(a,b);
   });
   return results.slice(0,limit);
  },
  predict(word,options={}){
   if(typeof word!=='string')throw new TypeError('Native Unicode string required');
   if(!index)return word?[{text:word,raw:true,personal:false,attested:false,
    lexicalIdentityVerified:false,source:null,sourceId:null,
    lexicon_ref:null,lexicon_refs:[]}]:[];
   return predictKeyboard(index,word,options);
  },
  validate(text){return validEgyptianWord(text);}
 });
}
/**
 * Install a verified, version-pinned dictionary from caller-owned URLs or a
 * supplied storage/fetch implementation. No automatic background refresh.
 * Different namespaces remain isolated and concurrent default loads coalesce.
 */
export async function createHieroglyphicKeyboard({
 manifestUrl,lexiconUrl,expectedSha256=null,storageNamespace='default',
 store=null,fetcher=globalThis.fetch,online=globalThis.navigator?.onLine!==false,
 refresh=false,timeoutMs=30000
}={}){
 if(!manifestUrl||!lexiconUrl)throw new TypeError('Explicit manifestUrl and lexiconUrl required');
 if(typeof storageNamespace!=='string'||!storageNamespace.trim()||storageNamespace.length>128)
  throw new TypeError('Storage namespace must be a nonempty string of at most 128 characters');
 const config={
  manifestUrl:String(manifestUrl),payloadUrl:String(lexiconUrl),
  expectedSha256,fetcher,online,refresh,timeoutMs
 };
 const build=async()=>{
  // Pin-specific storage prevents competing releases from overwriting one another.
  const storage=store||idbStore('hieroglyphic-keyboard-v2:'+storageNamespace+
   (expectedSha256?':'+expectedSha256:''));
  const installed=await ensureLexiconImpl({...config,store:storage});
  const engine=createKeyboardFromData({lexicon:installed.payload,manifest:installed.manifest});
  return Object.freeze({...engine,info:Object.freeze({...engine.info,status:installed.status})});
 };
 // Injected stores or fetchers have caller-specific identity; never coalesce them.
 // A refresh must not share an in-flight ordinary cached read.
 if(store||refresh||fetcher!==globalThis.fetch)return build();
 const key=JSON.stringify([storageNamespace,config.manifestUrl,config.payloadUrl,
  expectedSha256,online,timeoutMs]);
 if(loadInFlight.has(key))return loadInFlight.get(key);
 const promise=build().finally(()=>loadInFlight.delete(key));
 loadInFlight.set(key,promise);
 return promise;
}

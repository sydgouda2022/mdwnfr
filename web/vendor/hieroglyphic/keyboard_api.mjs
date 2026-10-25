/**
 * Hieroglyphic Keyboard public library API v1.
 * No DOM, service worker, editor, global state, analytics, or network service.
 * The source catalog is the single authoritative sign list.
 */
import {SIGN_CATALOG} from './keyboard_catalog.js';
import {prepareKeyboardIndex,predictKeyboard} from './keyboard_search.mjs';
import {validEgyptianWord,ensureLexiconImpl,idbStore} from './lexicon_install.mjs';

export const API_VERSION='1.0.0';
export const KEYBOARD_GROUPS=Object.freeze(['uni','bi','tri']);
const GROUPS={uni:'single',bi:'dual',tri:'triple',
 uniliteral:'single',biliteral:'dual',triliteral:'triple'};
const canonicalGroup=group=>{
 if(group==='all')return 'all';
 if(typeof group!=='string'||!GROUPS[group])throw new RangeError('Unknown Egyptian sign group');
 return GROUPS[group];
};
const ownedSigns=Object.freeze(
 Object.entries(SIGN_CATALOG).flatMap(([group,entries])=>entries.map(item=>
  Object.freeze({code:item.code,glyph:item.glyph,name:item.name,group:
   group==='single'?'uni':group==='dual'?'bi':'tri'})))
);
if(ownedSigns.length===0||ownedSigns.some(s=>!s.code||!s.glyph))throw new Error('Invalid embedded sign catalog');
function normalizeInput(text){
 if(typeof text!=='string')throw new TypeError('Text must be a string');
 return text.trim().toLowerCase();
}
/**
 * Zero-dependency sign-only keyboard.
 * `lexicon` is a trusted, already obtained catalog; this synchronous path does
 * not verify its byte-level SHA-256. Use createHieroglyphicKeyboard for verified
 * network/file installation with explicit URLs and a local store.
 */
export function createKeyboardFromData({lexicon=null,manifest=null}={}){
 const index=lexicon?prepareKeyboardIndex('egy',lexicon):null;
 const metadata=lexicon?.metadata||null;
 const info=Object.freeze({
  apiVersion:API_VERSION,language:'egy',stage:'Late Egyptian',
  status:index?'provided':'signs-only',complete:metadata?.complete===true,
  spellingRecords:index?.rows.length||0,
  release:manifest?.release||null,sha256:manifest?.sha256||null
 });
 return Object.freeze({
  apiVersion:API_VERSION,
  info,
  getSigns(group='all'){
   const choice=canonicalGroup(group);
   return choice==='all'?ownedSigns.slice():ownedSigns.filter(s=>GROUPS[s.group]===choice);
  },
  searchSigns(search='',{group='all',limit=100}={}){
   const selected=canonicalGroup(group),term=normalizeInput(search);
   if(!Number.isInteger(limit)||limit<1||limit>1000)throw new RangeError('Invalid sign search limit');
   const found=ownedSigns.filter(s=>(selected==='all'||GROUPS[s.group]===selected)&&
    (!term||s.code.toLowerCase().includes(term)||s.name.toLowerCase().includes(term)));
   found.sort((a,b)=>{
    const aStart=a.code.toLowerCase().startsWith(term)?0:1;
    const bStart=b.code.toLowerCase().startsWith(term)?0:1;
    return aStart-bStart||a.code.localeCompare(b.code,'en');
   });
   return found.slice(0,limit);
  },
  predict(text,options={}){
   if(typeof text!=='string')throw new TypeError('Text must be a string');
   if(!index)return text?[{text,raw:true,attested:false,personal:false,
    lexicon_ref:null,lexicon_refs:[]}]:[];
   return predictKeyboard(index,text,options);
  },
  validate(text){return validEgyptianWord(text);}
 });
}
/**
 * Verified local-first catalog load. Caller owns URL location and storage scope.
 * A consumer can pass a mock store/fetcher in tests or its own storage adapter.
 * No default URLs are inferred from this module's path.
 */
export async function createHieroglyphicKeyboard({
 manifestUrl,lexiconUrl,storageNamespace='default',
 store=null,fetcher=globalThis.fetch,online=true,timeoutMs=6000
}={}){
 if(!manifestUrl||!lexiconUrl)throw new TypeError('Explicit manifestUrl and lexiconUrl required');
 if(typeof storageNamespace!=='string'||!storageNamespace.trim()||storageNamespace.length>128)
  throw new TypeError('Storage namespace must be a nonempty string (max 128 chars)');
 const storage=store||idbStore('hieroglyphic-keyboard-v1:'+storageNamespace);
 const installed=await ensureLexiconImpl({store:storage,fetcher,online,timeoutMs,
  manifestUrl:String(manifestUrl),payloadUrl:String(lexiconUrl)});
 const engine=createKeyboardFromData({lexicon:installed.payload,manifest:installed.manifest});
 return Object.freeze({...engine,info:Object.freeze({...engine.info,status:installed.status})});
}

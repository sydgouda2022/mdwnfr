// Isolated headless keyboard API consumer. No document authority or DOM.
import {createHieroglyphicKeyboard} from './vendor/hieroglyphic/keyboard_api.mjs';
let instance=null,opening=null;
async function ready(){
 if(instance)return instance;
 if(!opening)opening=(async()=>{
 const pin=await fetch('/keyboard-release-pin.json',{cache:'force-cache'});
 if(!pin.ok)throw new Error('Missing reviewed keyboard release pin');
 const {sha256}=await pin.json();
 if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Invalid keyboard release pin');
 return createHieroglyphicKeyboard({
  manifestUrl:'/lexicon/manifest.json',lexiconUrl:'/lexicon/lexicon.json',
  expectedSha256:sha256,
  storageNamespace:'mdwnfr-v2',timeoutMs:30000
 });
 })().then(value=>(instance=value)).catch(error=>{opening=null;throw error;});
 return opening;
}
self.onmessage=async ({data})=>{
 const {id,prefix,offset=0,limit=8,global_choices={},document_choices={},personal_entries=[]}=data;
 try{
  const keyboard=await ready(),learned={};
  for(const [spelling,n] of Object.entries(global_choices))learned['egy:'+spelling]=n;
  for(const [spelling,n] of Object.entries(document_choices))learned['egy:'+spelling]=(learned['egy:'+spelling]||0)+n;
  for(const item of personal_entries)if(typeof item.signs==='string')learned['egy:'+item.signs]=Math.max(1,learned['egy:'+item.signs]||0);
  const candidates=keyboard.predict(prefix.join(''),{limit:80,learned});
  const suggestions=candidates.slice(offset,offset+limit).map(x=>({
   signs:[...x.text],source:x.raw?'user':x.personal?'personal':'lexicon',
   lexicon_ref:x.lexicon_ref||null,
   source_tier:x.source==='RAMSES-CORPUS'?'ramses_corpus':x.personal?'personal':
    x.lexicalIdentityVerified===true?'lemma_linked':x.attested===true?'unlinked_attestation':'unverified',
   lexical_identity_verified:x.lexicalIdentityVerified===true,attested:x.attested===true
  }));
  self.postMessage({id,ok:true,suggestions,total:candidates.length,
   has_more:offset+limit<candidates.length});
 }catch(error){self.postMessage({id,ok:false,error:String(error?.message||error)});}
};

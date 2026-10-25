// Isolated headless keyboard API consumer. No document authority or DOM.
import {createHieroglyphicKeyboard} from './vendor/hieroglyphic/keyboard_api.mjs';
let instance=null,opening=null;
async function ready(){
 if(instance)return instance;
 if(!opening)opening=createHieroglyphicKeyboard({
  manifestUrl:'/lexicon/manifest.json',lexiconUrl:'/lexicon/lexicon.json',
  expectedSha256:'48f7769c20b1560f76b0080e8ac5155b5e42c2b9fe2c1fe696f765e803dd5a39',
  storageNamespace:'mdwnfr-v2',timeoutMs:30000
 }).then(value=>(instance=value)).catch(error=>{opening=null;throw error;});
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
   source_tier:x.source==='RAMSES-CORPUS'?'ramses_corpus':x.personal?'personal':'lemma_linked',
   lexical_identity_verified:x.lexicalIdentityVerified===true,attested:x.attested===true
  }));
  self.postMessage({id,ok:true,suggestions,total:candidates.length,
   has_more:offset+limit<candidates.length});
 }catch(error){self.postMessage({id,ok:false,error:String(error?.message||error)});}
};

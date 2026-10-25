/**
 * The sole native Egyptian Unicode prediction implementation.
 * Dataset entries are typed records. Legacy array records are deliberately
 * rejected because they cannot preserve verifiable provenance.
 */
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const TEXT_SOURCES=new Set(['TLA-LE19','AES-LATE-CURATED','TLA-LE19+AES-LATE-CURATED']);
const MODEL_SOURCE='RAMSES-WORD-MODEL-2023';
export function keyboardKey(text,language='egy'){
 if(language!=='egy')throw new RangeError('This keyboard supports Egyptian Unicode only');
 if(typeof text!=='string')throw new TypeError('Unicode string required');
 return text.normalize('NFC');
}
export function prepareKeyboardIndex(language,pack){
 if(language!=='egy')throw new RangeError('This keyboard supports Egyptian Unicode only');
 if(!Array.isArray(pack?.entries))throw new TypeError('An Egyptian typed-entry catalog is required');
 const rows=pack.entries.map(item=>{
  if(!item||Array.isArray(item)||typeof item.signs!=='string'||!item.signs)
   throw new TypeError('Invalid native spelling; legacy arrays are unsupported');
  if(typeof item.ref!=='string'||!item.ref||typeof item.source!=='string')
   throw new TypeError('Missing reference or source provenance');
  if(!TEXT_SOURCES.has(item.source)&&item.source!==MODEL_SOURCE)
   throw new TypeError('Unknown source provenance: '+item.source);
  if(!Number.isSafeInteger(item.attestations)||item.attestations<0)
   throw new TypeError('Invalid source-record frequency');
  const text=keyboardKey(item.signs);
  const model=item.source===MODEL_SOURCE;
  const verified=!model&&item.lexical_identity_verified!==false&&
   typeof item.lemma==='string'&&!item.lemma.startsWith('unresolved:');
  return Object.freeze({text,key:text,id:item.ref,
   source:model?'RAMSES-CORPUS':'LATE',sourceId:item.source,
   sourceRef:item.ref,frequency:item.attestations,
   attested:!model,lexicalIdentityVerified:verified,
   lemma:typeof item.lemma==='string'?item.lemma:null});
 });
 rows.sort((a,b)=>cmp(a.key,b.key)||cmp(a.id,b.id));
 return Object.freeze({language:'egy',rows:Object.freeze(rows)});
}
function lowerBound(rows,key){
 let lo=0,hi=rows.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].key<key)lo=mid+1;else hi=mid;}
 return lo;
}
function weight(learned,key){
 if(!learned||typeof learned!=='object')return 0;
 const n=Number(Object.hasOwn(learned,key)?learned[key]:0);
 return Number.isFinite(n)?Math.min(10000,Math.max(0,n)):0;
}
function rank(row,learned,previous){
 const personal=weight(learned,'egy:'+row.text);
 const context=previous?weight(learned,'ctx:egy:'+previous+':'+row.text):0;
 // Different evidence categories are not comparable frequencies.
 // Tier first, frequency and user history only within the same tier.
 const tier=row.attested?(row.lexicalIdentityVerified?3:2):row.source==='RAMSES-CORPUS'?1:0;
 const score=Math.log1p(row.frequency)*8+Math.log1p(personal)*25+
   Math.log1p(context)*20-[...row.text].length*0.05;
 return {tier,score};
}
export function predictKeyboard(index,raw,{limit=4,learned={},previous=''}={}){
 if(index?.language!=='egy'||!Array.isArray(index.rows))throw new TypeError('Invalid Egyptian index');
 if(typeof raw!=='string')throw new TypeError('Unicode input required');
 if(!Number.isInteger(limit)||limit<1||limit>80)throw new RangeError('Invalid suggestion limit');
 if(typeof previous!=='string')throw new TypeError('Previous word must be a string');
 if(!raw)return [];
 const lookup=keyboardKey(raw),found=new Map(),exact=[];
 const add=(row)=>{
  if(!row.key.startsWith(lookup))return;
  if(row.text===lookup){exact.push(row);return;}
  const existing=found.get(row.text);
  if(existing){
   existing.refs.push(row.sourceRef);
   const best=rank(row,learned,previous),old=rank(existing.row,learned,previous);
   if(best.tier>old.tier||(best.tier===old.tier&&best.score>old.score))existing.row=row;
  }else found.set(row.text,{row,refs:[row.sourceRef]});
 };
 for(let i=lowerBound(index.rows,lookup);i<index.rows.length;i++){
  const row=index.rows[i];
  if(!row.key.startsWith(lookup))break;
  add(row);
 }
 // Personal strings are never promoted to corpus attestations.
 if(learned&&typeof learned==='object')for(const [key,n] of Object.entries(learned)){
  if(!key.startsWith('egy:')||!(Number(n)>0))continue;
  const text=key.slice(4);
  if(!text||text===lookup||found.has(text)||!keyboardKey(text).startsWith(lookup))continue;
  found.set(text,{row:{text,key:text,id:null,source:'PERSONAL',
   sourceId:null,sourceRef:null,frequency:0,attested:false,
   lexicalIdentityVerified:false,lemma:null},refs:[]});
 }
 const options=[...found.values()].map(({row,refs})=>{
  const {tier,score}=rank(row,learned,previous);
  return {text:row.text,raw:false,personal:row.source==='PERSONAL',
   attested:row.attested,lexicalIdentityVerified:row.lexicalIdentityVerified,
   source:row.source,sourceId:row.sourceId,lemma:row.lemma,
   frequency:row.frequency,lexicon_ref:row.sourceRef,lexicon_refs:refs,
   tier,score};
 }).sort((a,b)=>b.tier-a.tier||b.score-a.score||cmp(a.text,b.text));
 const rawAttested=exact.some(row=>row.attested);
 const preferred=exact.find(row=>row.attested&&row.lexicalIdentityVerified)||
  exact.find(row=>row.attested)||exact[0]||null;
 return [{text:raw,raw:true,personal:false,attested:rawAttested,
  lexicalIdentityVerified:exact.some(row=>row.lexicalIdentityVerified),
  source:preferred?.source||null,sourceId:preferred?.sourceId||null,
  lexicon_ref:preferred?.sourceRef||null,
  lexicon_refs:exact.map(row=>row.sourceRef)},
  ...options.slice(0,limit-1).map(({tier,score,...publicData})=>publicData)];
}

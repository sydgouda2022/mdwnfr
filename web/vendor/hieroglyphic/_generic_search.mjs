/** Egyptian-only, native Unicode prefix predictor. No transliteration or autocorrection. */
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function keyboardKey(text,language='egy'){
 if(language!=='egy')throw new RangeError('Wrong keyboard language');
 if(typeof text!=='string')throw new TypeError('Unicode string required');
 return text.normalize('NFC');
}
export function prepareKeyboardIndex(language,pack){
 if(language!=='egy')throw new RangeError('Wrong keyboard language');
 const entries=pack?.entries||pack?.rows;
 if(!Array.isArray(entries))throw new TypeError('Missing Late Egyptian spelling records');
 const rows=entries.map(item=>{
  const legacy=Array.isArray(item),text=legacy?item[0]:item?.signs;
  if(typeof text!=='string'||!text)throw new TypeError('Invalid native spelling');
  const source=legacy?'LATE':item.source==='RAMSES-WORD-MODEL-2023'?'RAMSES-CORPUS':'LATE';
  const ref=legacy?(item[3]||'egy:'+text):item.ref;
  const frequency=Number(legacy?item[1]:item.attestations);
  return {text,key:keyboardKey(text),id:typeof ref==='string'&&ref?ref:'egy:'+text,
   source,sourceRef:ref||null,frequency:Number.isFinite(frequency)?Math.max(0,frequency):0,
   lexicalIdentityVerified:legacy||item.lexical_identity_verified!==false,
   lemma:legacy?item[2]:(item.lemma||null)};
 });
 rows.sort((a,b)=>cmp(a.key,b.key)||cmp(a.id,b.id));
 return {language:'egy',rows};
}
function lowerBound(rows,key){
 let lo=0,hi=rows.length;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(rows[mid].key<key)lo=mid+1;else hi=mid;}return lo;
}
function count(source,key){
 const n=Number(Object.hasOwn(source||{},key)?source[key]:0);
 return Number.isFinite(n)?Math.min(10000,Math.max(0,n)):0;
}
export function predictKeyboard(index,raw,{limit=4,learned={},previous=''}={}){
 if(index?.language!=='egy'||!Array.isArray(index.rows))throw new TypeError('Invalid Egyptian index');
 if(typeof raw!=='string')throw new TypeError('Unicode input required');
 if(!Number.isInteger(limit)||limit<1||limit>80)throw new RangeError('Invalid suggestion limit');
 if(!raw)return [];
 const lookup=keyboardKey(raw),found=new Map();
 let exact=false,exactRefs=[];
 const add=(row,personal=false)=>{
  if(!row.key.startsWith(lookup))return;
  if(row.text===raw){
   if(!personal){exact=true;exactRefs.push(row.sourceRef||row.id);}
   return;
  }
  const learning=count(learned,'egy:'+row.text);
  const context=previous?count(learned,'ctx:egy:'+previous+':'+row.text):0;
  const score=(personal?0:Math.log1p(row.frequency)*8)+(row.source==='RAMSES-CORPUS'?-12:0)+
    Math.log1p(learning)*45+Math.log1p(context)*30-[...row.text].length*0.05;
  const existing=found.get(row.text);
  const candidate={text:row.text,raw:false,personal,attested:!personal,
   frequency:row.frequency,lemma:row.lemma,source:personal?'PERSONAL':row.source,
   lexicalIdentityVerified:!personal&&row.lexicalIdentityVerified,
   lexicon_ref:personal?null:row.sourceRef||row.id,
   lexicon_refs:personal?[]:[row.sourceRef||row.id],score};
  if(!existing){found.set(row.text,candidate);return;}
  if(!personal && existing.attested){
   existing.lexicon_refs.push(candidate.lexicon_ref);
   if(candidate.score>existing.score){candidate.lexicon_refs=existing.lexicon_refs;found.set(row.text,candidate);}
  }else if(!personal){candidate.lexicon_refs=existing.lexicon_refs.concat(candidate.lexicon_refs);found.set(row.text,candidate);}
 };
 for(let i=lowerBound(index.rows,lookup);i<index.rows.length;i++){
  const row=index.rows[i];if(!row.key.startsWith(lookup))break;add(row);
 }
 for(const [key,n] of Object.entries(learned||{})){
  if(!key.startsWith('egy:')||!(Number(n)>0))continue;
  const text=key.slice(4);
  if(!text||text===raw||found.has(text))continue;
  add({text,key:keyboardKey(text),frequency:0,source:'PERSONAL',lexicalIdentityVerified:false},true);
 }
 const options=[...found.values()].sort((a,b)=>b.score-a.score||cmp(a.text,b.text));
 return [{text:raw,raw:true,attested:exact,personal:false,lexicon_ref:exactRefs[0]||null,
  lexicon_refs:exactRefs},...options.slice(0,limit-1).map(({score,...rest})=>rest)];
}

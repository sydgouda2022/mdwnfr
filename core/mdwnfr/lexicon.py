"""Read-only published spelling catalog and native Unicode predictive index.

The embedded corpus is *explicitly incomplete* development data. No Latin
transliteration is accepted as search input. All scoring lives in Python.
"""
from __future__ import annotations
import json, math
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from .document import validate_signs

DATA_PATH=Path(__file__).with_name('data')/'lexicon.json'

class Lexicon:
    def __init__(self, package:dict):
        if package.get('format')!='mdwnfr-predict-v1':
            raise ValueError('Unsupported lexicon package')
        self.metadata=package['metadata'].copy()
        self.entries=[]
        self.by_first=defaultdict(set)
        self.by_sign=defaultdict(set)
        for entry in package.get('entries',[]):
            chars=entry.get('signs', '')
            if not isinstance(chars,str) or not chars:raise ValueError('Invalid published spelling')
            validate_signs(list(chars))
            idx=len(self.entries)
            self.entries.append(entry)
            self.by_first[chars[0]].add(idx)
            for sign in set(chars):self.by_sign[sign].add(idx)
        expected=self.metadata.get('spelling_records')
        if expected is not None and expected!=len(self.entries):
            raise ValueError('Verified dictionary spelling count mismatch')
        self.metadata['spelling_records']=len(self.entries)
        self.metadata['unique_native_surfaces']=len({x['signs'] for x in self.entries})
        if not self.entries:raise ValueError('Published catalog is empty')

    def candidates(self, typed:list[str], personal_entries:list[dict]|None=None,
                   global_choices:dict|None=None, document_choices:dict|None=None,
                   offset:int=0, limit:int=20)->dict:
        validate_signs(typed)
        if not isinstance(offset,int) or offset<0 or not isinstance(limit,int) or not 1<=limit<=80:
            raise ValueError('Invalid suggestion window')
        pattern=''.join(typed)
        global_choices=global_choices or {}
        document_choices=document_choices or {}
        all_candidates=[]
        # Prefer contiguous native SIGN PREFIXES in the 41k form lexicon.
        # Shared-sign fuzzy search is only a fallback when no prefix exists.
        candidate_ids={i for i in self.by_first.get(typed[0],())
                       if self.entries[i]['signs'].startswith(pattern)}
        if not candidate_ids:
            candidate_ids=set().union(*(self.by_sign.get(s,set()) for s in typed))
        for idx in candidate_ids:
            record=self.entries[idx]
            value=record['signs']
            if value==pattern:continue   # user's exact input stays first, never duplicated
            score=_match_score(value,pattern)
            if score<=0:continue
            score+=_choice_bonus(value,global_choices,document_choices)
            is_rtc=record.get('lexical_identity_verified') is False or (
                record.get('source')=='RAMSES-WORD-MODEL-2023')
            n=record.get('attestations',0)
            if isinstance(n,(int,float)) and not isinstance(n,bool) and n>0:
                score+=min(85,round(12*math.log1p(n)))
            if not is_rtc:score+=18
            # Verified primary is tie-break only; never allows nonprefix above prefix.
            all_candidates.append((score,1 if record.get('primary') else 0,
                                   value,record.get('ref',''),record,'lexicon'))
        for personal in personal_entries or []:
            if not isinstance(personal,dict):continue
            value=personal.get('signs','')
            if not isinstance(value,str) or value==pattern or not value:continue
            try:validate_signs(list(value))
            except ValueError:continue
            score=_match_score(value,pattern)
            if score>0:
                all_candidates.append((score+_choice_bonus(value,global_choices,document_choices)+3,
                                       0,value,'personal:'+value,personal,'personal'))
        # Identical displayed spellings from multiple records are collapsed, not fabricated.
        all_candidates.sort(key=lambda row:(-row[0],-row[1],row[2],row[3]))
        unique=[]; seen=set()
        for score,primary,value,ref,record,source in all_candidates:
            if value in seen:continue
            seen.add(value)
            is_rtc=(source=='lexicon' and (
                record.get('lexical_identity_verified') is False or
                record.get('source')=='RAMSES-WORD-MODEL-2023'))
            unique.append({'signs':list(value),'source':source,
                           'lexicon_ref':ref if source=='lexicon' else None,
                           'source_tier':'ramses_corpus' if is_rtc else
                                  ('lemma_linked' if source=='lexicon' else 'personal'),
                           'lexical_identity_verified':source=='lexicon' and not is_rtc})
        own={'signs':typed.copy(),'source':'user','lexicon_ref':None}
        count=1+len(unique)
        # Offset is in the full list, including the user-input candidate.
        results=([own]+unique)[offset:offset+limit]
        return {'suggestions':results,'total':count,'offset':offset,
                'has_more':offset+len(results)<count,
                'exact_attested':pattern in self._exact_set(),
                'dictionary_spelling_records':self.metadata['spelling_records']}

    @lru_cache(maxsize=1)
    def _exact_set(self):return frozenset(x['signs'] for x in self.entries)


def _match_score(value:str, pattern:str)->int:
    if value.startswith(pattern):return 100000+min(1000,len(pattern)*40)-len(value)
    if pattern in value:return 40000+len(pattern)*25-len(value)
    # Ordered subsequence, never transliteration or semantic auto-correction.
    i=0
    for ch in value:
        if i<len(pattern) and ch==pattern[i]:i+=1
    if i==len(pattern):return 10000+len(pattern)*10-len(value)
    # Partial shared-sign fallback after stronger matches.
    common=len(set(value)&set(pattern))
    return common*100 if common else 0


def _choice_bonus(value:str, global_choices:dict, document_choices:dict)->int:
    def count(map_):
        raw=map_.get(value,0) if isinstance(map_,dict) else 0
        return min(10000,max(0,int(raw))) if isinstance(raw,int) and not isinstance(raw,bool) else 0
    return round(65*math.log1p(count(global_choices))+115*math.log1p(count(document_choices)))

@lru_cache(maxsize=1)
def bundled_lexicon()->Lexicon:
    return Lexicon(json.loads(DATA_PATH.read_text(encoding='utf-8')))


def suggest(typed:list[str], entries:list[dict]|None=None,
            global_choices:dict|None=None, document_choices:dict|None=None,
            limit:int=20)->list[dict]:
    """Compatibility for source tests; no implicit dictionary when entries supplied."""
    validate_signs(typed)
    if entries is None:
        return bundled_lexicon().candidates(typed,global_choices=global_choices,
                    document_choices=document_choices,limit=limit)['suggestions']
    package={'format':'mdwnfr-predict-v1','metadata':{'complete':False},
             'entries':[{'signs':''.join(e['signs']),'ref':e.get('lexicon_ref') or '',
                         'primary':False} for e in entries]}
    if not package['entries']:
        return [{'signs':typed.copy(),'source':'user','lexicon_ref':None}]
    return Lexicon(package).candidates(typed,global_choices=global_choices,
                                document_choices=document_choices,limit=limit)['suggestions']

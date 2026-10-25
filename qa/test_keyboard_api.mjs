import assert from 'node:assert/strict';
import {createKeyboardFromData,API_VERSION} from '../web/vendor/hieroglyphic/keyboard_api.mjs';
assert.equal(API_VERSION,'1.0.0');
const signs=createKeyboardFromData();
assert.ok(signs.searchSigns('M17A').some(s=>s.code==='M17A'));
assert.ok(signs.getSigns('uni').length>0);
assert.deepEqual(signs.predict('𓅓').map(x=>x.text),['𓅓']);
const dictionary=createKeyboardFromData({lexicon:{metadata:{complete:false},
  entries:[{signs:'𓅓𓏏',ref:'tla:1',source:'TLA-LE19',attestations:8},
           {signs:'𓅓𓈖',ref:'ramses:2',source:'RAMSES-WORD-MODEL-2023',
            lexical_identity_verified:false,attestations:20}]}});
const suggestions=dictionary.predict('𓅓',{limit:8});
assert.equal(suggestions[0].raw,true);
assert.ok(suggestions.some(x=>x.source==='RAMSES-CORPUS'&&!x.lexicalIdentityVerified));
assert.ok(suggestions.some(x=>x.lexicon_ref==='tla:1'));
assert.ok(dictionary.validate('𓅓'));
assert.equal(dictionary.validate('nfr'),false);
console.log('PASS: MdwNfr consumes the independent headless keyboard API');

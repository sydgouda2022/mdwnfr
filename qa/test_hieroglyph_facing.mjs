import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NO_MIRROR_HIEROGLYPHS,mirrorSign,reverseVisualQuadrat} from '../web/hieroglyph_facing.mjs';
test('visual reflection follows reading direction without changing codepoint',()=>{
 assert.equal(reverseVisualQuadrat('rtl'),true);
 assert.equal(reverseVisualQuadrat('ltr'),false);
 assert.equal(mirrorSign('ltr','𓅓'),false);
 assert.equal(mirrorSign('rtl','𓅓'),true);
 assert.equal(mirrorSign('rtl','𓀀'),true);
 assert.throws(()=>reverseVisualQuadrat('other'),RangeError);
});
test('Unikemet semantic exceptions remain unmirrored',()=>{
 const listed=[0x13081,0x13084,0x130BB,0x130BD].map(cp=>String.fromCodePoint(cp));
 assert.deepEqual([...NO_MIRROR_HIEROGLYPHS],listed);
 for(const sign of listed){
  assert.equal(mirrorSign('rtl',sign),false);
  assert.equal(mirrorSign('ltr',sign),false);
 }
});

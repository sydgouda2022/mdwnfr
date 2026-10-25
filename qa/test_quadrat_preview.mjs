import assert from 'node:assert/strict';
import {fitQuadrat} from '../web/quadrat_preview.mjs';
const source={width:20,height:30,signs:[
 {sign:'𓅓',x:2,y:3,width:8,height:10,font_size:10,text_x:1.5,text_y:12.3},
 {sign:'𓏏',x:11,y:3,width:7,height:10,font_size:14,text_x:10.2,text_y:15.1},
 {sign:'𓈖',x:4,y:16,width:12,height:10,font_size:35,text_x:3.5,text_y:21.7}
]};
const before=structuredClone(source);
const preview=fitQuadrat(source,100,60);
assert.equal(preview.width,40);
assert.equal(preview.height,60);
assert.deepEqual(preview.signs.map(g=>g.sign),['𓅓','𓏏','𓈖']);
assert.equal(preview.signs[1].x,22);
assert.equal(preview.signs[2].y,32);
assert.equal(preview.signs[0].font_size,20);
assert.equal(preview.signs[1].text_y,30.2);
assert.deepEqual(source,before,'No mutation of measured Python geometry');
const narrow=fitQuadrat(source,30,200);
assert.equal(narrow.width,30);
assert.equal(narrow.height,45);
for(const g of narrow.signs)assert.ok(g.x+g.width<=narrow.width+1e-7);
for(const broken of [
 {...source,height:0},{...source,signs:[]},
 {...source,signs:[{...source.signs[0],x:-1}]},
 {...source,signs:[{...source.signs[0],x:19}]},
 {...source,signs:[{...source.signs[0],font_size:Infinity}]}])
 assert.throws(()=>fitQuadrat(broken),TypeError);
console.log('PASS: SVG text bearings and ink geometry preserve Python placement');

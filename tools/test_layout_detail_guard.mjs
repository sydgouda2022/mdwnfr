/* Optional browser-adapter regression; no npm dependencies. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const start=source.indexOf('// A detail request is valid only');
const end=source.indexOf('const VIRTUALIZE_ABOVE_PAGES=10;',start);
assert(start>0&&end>start,'Missing detail revision protection functions');
let resets=0,reflows=0;
const context={
 editorScreen:{hidden:false},
 doc:{id:'document-1',revision:3},
 layoutCache:{document_id:'document-1',revision:3},
 layoutVersion:11,
 resetLayoutSynchronization(){resets++;},
 reflow(){reflows++;return Promise.resolve();},
};
runInNewContext(source.slice(start,end)+`\nthis.guards={layoutDetailIsCurrent,recoverLayoutDetailRevision};`,context);
const {layoutDetailIsCurrent:current,recoverLayoutDetailRevision:recover}=context.guards;
const conflict={code:'LayoutRevisionConflict'};
assert(current('document-1',3,11));
assert(!current('document-1',2,11));
assert(!current('document-2',3,11));
assert(!current('document-1',3,12));
assert(!recover('document-1',2,11,conflict));
assert(!recover('document-1',3,10,conflict));
assert(!recover('document-1',3,11,{code:'OtherError'}));
assert(recover('document-1',3,11,conflict));
assert(!recover('document-1',3,11,conflict),'One automatic recovery per revision');
assert.equal(resets,1);
assert.equal(reflows,1);
context.doc.revision=4;
assert(!recover('document-1',3,11,conflict));
assert.equal(reflows,1);
context.layoutCache.revision=4;context.layoutVersion=12;
assert(recover('document-1',4,12,conflict));
assert.equal(reflows,2);
console.log('PASS: stale page/column detail requests ignored; one bounded repair per revision');

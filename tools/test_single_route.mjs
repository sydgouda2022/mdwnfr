// One shipping application shell, editor and object-insert route.
// Keep this guard source-only: it runs before installing browsers or Pyodide.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const read = path => readFileSync(path,'utf8');
const html=read('web/index.html');
const app=read('web/app.js');
const boot=read('web/boot.mjs');
const api=read('core/mdwnfr/api.py');
const storage=read('web/storage.js');
const layoutSync=read('core/mdwnfr/layout_sync.py');
const packageInit=read('core/mdwnfr/__init__.py');
assert.match(storage,/const DB='mdwnfr-documents';/,'Only the new document database is supported');
assert.doesNotMatch(storage,/mdwnfr-canonical-v1/,'No historical database route');
assert.match(app,/const OBJECT_EDGES=\['bottom-right'\]/,'Only the active resize handle is used');
assert.doesNotMatch(layoutSync,/def apply_canonical_delta\(/,'No duplicate layout replay API');
assert.doesNotMatch(packageInit,/__version__\s*=/,'Package version belongs only in pyproject.toml');

const css=read('web/style.css');
// CSS is not validated by Node's syntax checker. A partial comment removal
// can silently hide an entire suffix of an otherwise well-formed stylesheet.
const comments=[...css.matchAll(/\/\*|\*\//g)].map(m=>m[0]);
let open=false;
for(const part of comments){
 if(part==='/*')assert.ok(!open,'Nested or unterminated CSS comment');
 else assert.ok(open,'CSS comment closes without opening');
 open=part==='/*';
}
assert.ok(!open,'Unterminated CSS comment');
const withoutComments=css.replace(/\/\*[\s\S]*?\*\//g,'');
assert.equal((withoutComments.match(/\{/g)||[]).length,
 (withoutComments.match(/\}/g)||[]).length,'CSS braces are unbalanced');
for(const retired of ['.table-grid-editor','.toolgroup','.sidebar','.art-resize.top-left'])
 assert.ok(!css.includes(retired),'Retired CSS selector returned: '+retired);


const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const unique=new Set(ids);
assert.equal(unique.size,ids.length,'Every rendered control must have one ID');
for(const expected of [
 'library-screen','editor-screen','format-panel','insert-dialog-backdrop',
 'insert-sheet','insert-glyph-numbers','insert-glyph-keys','numbers','keys'
])assert.ok(unique.has(expected),'Missing canonical control: '+expected);

for(const forbidden of [
 'quadrat-preview','table-controls','cartouche-controls','insert-placement',
 'insert-object-width','insert-object-y','insert-glyph-space',
 'nested-horizontal','nested-vertical','nested-float','clipart-horizontal'
])assert.ok(!unique.has(forbidden),'Retired control reintroduced: '+forbidden);

for(const match of app.matchAll(/(?:\$|getElementById)\(['"]([A-Za-z0-9_-]+)['"]\)/g)){
 const name=match[1];
 assert.ok(unique.has(name),'JavaScript references absent control: '+name);
}
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual(scripts,['/boot.mjs'],'Only the canonical boot entrypoint is supported');
assert.match(boot,/await import\('\.\/app\.js'\)/,'Boot must load the sole editor module');

const functions=[...app.matchAll(/(?:^|\n)(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]);
assert.equal(new Set(functions).size,functions.length,'Duplicate editor function implementation');
const rpc=[...api.matchAll(/name=="([a-z_]+)"/g)].map(m=>m[1]);
assert.deepEqual(new Set(rpc),new Set([
 'new','transact','session_open','session_edit','session_history','layout',
 'layout_open','layout_sync','layout_columns','layout_page','import_document'
]),'A new or retired Python RPC route must be deliberately reviewed');
for(const retired of [
 'web/quadrat_preview.mjs','web/lexicon/coverage.json',
 'docs/LAYOUT_ENGINE_V2.md','tools/benchmark_layout_v2.py',
 'qa/test_object_layout_v2.py','qa/audit_live_ui_20261030.mjs'
])assert.ok(!existsSync(retired),'Retired artifact exists: '+retired);
console.log('PASS: one document library, editor, keyboard, Insert route and RPC authority');

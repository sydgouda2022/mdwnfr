import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const start=source.indexOf('function renderPagesOverview(){');
const end=source.indexOf('// Legacy v4 artwork',start);
const frames=[];
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.attrs={};this.offsetTop=50;this.scrollTop=0;
  this.classList={remove(){},toggle(){}};}
 replaceChildren(){this.children=[];}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(name,value){this.attrs[name]=value;}
}
const elements={'pages-overview':new Node('nav'),'pages-panel':new Node('aside'),'page-total':new Node('span')};
let visited=null;
const makePages=count=>Array.from({length:count},(_,i)=>({shell:{scrollIntoView(){visited=i;}}}));
const context={pageSlots:makePages(10000),pageOverviewVersion:0,PAGE_OVERVIEW_LIMIT:80,
 $:id=>elements[id],document:{createElement:tag=>new Node(tag)},closePanels(){},
 requestAnimationFrame:fn=>frames.push(fn)};
runInNewContext(source.slice(start,end)+'\nthis.render=renderPagesOverview;',context);
context.render();
let thumbs=elements['pages-overview'].children;
assert.equal(thumbs.length,80,'Large documents keep a bounded thumbnail window');
assert.equal(thumbs[0].attrs['aria-label'],'Go to page 1');
assert.ok(thumbs.every(n=>n.tag==='button'&&n.children.every(c=>c.tag==='span')),'Only page thumbnails belong in Pages');
elements['pages-panel'].scrollTop=10000*144;
elements['pages-panel'].onscroll();frames.shift()();
thumbs=elements['pages-overview'].children;
assert.equal(thumbs.length,80);
assert.equal(thumbs.at(-1).attrs['aria-label'],'Go to page 10000');
thumbs.at(-1).onclick();assert.equal(visited,9999,'Last page is reachable by scrolling');
// A queued scroll from another document must not replace the new list.
elements['pages-panel'].onscroll();
context.pageSlots=makePages(3);context.render();frames.shift()();
assert.equal(elements['pages-overview'].children.length,3);
assert.equal(elements['pages-panel'].onscroll,null);
assert.equal(elements['pages-overview'].style.height,'');
console.log('PASS: thumbnail-only single-column navigation stays bounded and reaches page 10,000');

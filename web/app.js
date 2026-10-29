import {save,load,list,remove,loadProfile,updateProfile} from './storage.js';
import {createKeyboardFromData} from './vendor/hieroglyphic/keyboard_api.mjs';
import {NO_MIRROR_HIEROGLYPHS,mirrorSign,reverseVisualQuadrat} from './hieroglyph_facing.mjs';
import {fitQuadrat} from './quadrat_preview.mjs';
import {buildEgyptianPalette,normalizeColour} from './editor_controls.mjs';

/* All document and typesetting decisions go through the Python RPC worker.
   JavaScript owns only interaction state, local persistence, and DOM drawing. */
const $=id=>document.getElementById(id);
const pxmm=96/25.4;
const signKeyboard=createKeyboardFromData();
const glyphGroups={unilaterals:signKeyboard.getSigns('uni'),bilaterals:signKeyboard.getSigns('bi'),trilaterals:signKeyboard.getSigns('tri')};
const numerals=[...('𓏺𓏻𓏼𓏽𓏾𓏿𓐀𓐁𓐂')].map((sign,i)=>({sign,value:String(i+1)})).concat([
 {sign:'𓎆',value:'10'},{sign:'𓍢',value:'100'},{sign:'𓆼',value:'1,000'},
 {sign:'𓂭',value:'10,000'},{sign:'𓆐',value:'100,000'},{sign:'𓁨',value:'1,000,000'}]);
const worker=new Worker('/worker.js',{type:'module'});
// Separate Python layout worker: lengthy reflow never blocks document edits.
// Created lazily by the browser on first layout job; it loads no lexicon.
let layoutWorker=null,layoutRestarts=0,layoutIdleTimer=null;
function releaseLayoutWorker(){
 if(layoutIdleTimer!==null){clearTimeout(layoutIdleTimer);layoutIdleTimer=null;}
 layoutWorker?.terminate();layoutWorker=null;
 resetLayoutSynchronization();
}
function scheduleLayoutIdle(){
 if(layoutIdleTimer!==null)clearTimeout(layoutIdleTimer);
 layoutIdleTimer=setTimeout(()=>{
  layoutIdleTimer=null;
  // Free the second Pyodide runtime when all geometry jobs are idle.
  if(!layoutPending.size&&!layoutInFlight&&!queuedLayout)releaseLayoutWorker();
  else scheduleLayoutIdle();
 },45000);
}
function getLayoutWorker(){
 if(!layoutWorker){
  layoutWorker=new Worker('/worker.js?role=layout',{type:'module'});
  layoutWorker.onmessage=handleLayoutMessage;
  layoutWorker.onerror=handleLayoutError;
 }
 return layoutWorker;
}
let nextLayoutReq=0;const layoutPending=new Map();
let nextReq=0;const pending=new Map();
let ready=false,doc=null,selectedId=null,editingId=null,caretIndex=0;
let artworkEntries=null,artworkById=new Map();
let insertDraft=null; // Python-projected temporary object; only Confirm may persist it.
let selectedTableCell=null; // {tableId,row,column}; coordinates are UI-only
// Selection endpoints are stable object IDs, never viewport coordinates.
let selectionAnchorId=null,selectionFocusId=null;
let internalClipboard=null;
const RICH_MIME='application/x-mdwnfr-fragment+json';
let suppressWordClick=false,suppressPaperClick=false;
let buffer=[],activeGroup='unilaterals',zoom=1,zoomChoice='fit-page',layoutVersion=0;
let queuedLayout=null,layoutInFlight=false;
// Python layout worker owns a revisioned shadow document. Ordinary edits send
// only editor-authorized deltas; never transfer the full document for reflow.
let layoutSyncedId=null,layoutSyncedRevision=null,layoutDeltas=[];
function resetLayoutSynchronization(){
 layoutSyncedId=null;layoutSyncedRevision=null;layoutDeltas=[];
}

// Learned spelling preferences stay local; ranking belongs to the headless keyboard API.
const emptyProfile=()=>({id:'profile',global_choices:{},document_choices:{},personal_entries:[]});
let writingProfile=emptyProfile(),profileSaveQueue=Promise.resolve();
let lexiconMeta=null;
let keyboardWorker=null,keyboardRequest=0;
const keyboardPending=new Map();
function keyboardSuggest(offset=0,limit=8){
 if(!keyboardWorker){
  keyboardWorker=new Worker('/keyboard-prediction-worker.mjs',{type:'module'});
  keyboardWorker.onmessage=({data})=>{
   const request=keyboardPending.get(data.id);if(!request)return;
   keyboardPending.delete(data.id);data.ok?request.resolve(data):request.reject(new Error(data.error));
  };
  keyboardWorker.onerror=event=>{
   for(const request of keyboardPending.values())request.reject(new Error(event.message||'Keyboard worker failed'));
   keyboardPending.clear();keyboardWorker.terminate();keyboardWorker=null;
  };
 }
 return new Promise((resolve,reject)=>{
  const id=++keyboardRequest;keyboardPending.set(id,{resolve,reject});
  keyboardWorker.postMessage({id,prefix:buffer.slice(),offset,limit,
   global_choices:writingProfile.global_choices,document_choices:docChoices(),
   personal_entries:writingProfile.personal_entries});
 });
}
let expanded=false, expandedOffset=0, expandedLoading=false, expandedGeneration=0;
function docChoices(){return doc?.id?(writingProfile.document_choices[doc.id]||{}):{};}
function queueProfileChange(change){
 profileSaveQueue=profileSaveQueue.catch(()=>{}).then(async()=>{
  writingProfile=await updateProfile(change);return writingProfile;
 });
 return profileSaveQueue;
}
async function rememberChoice(candidate){
 const value=candidate.signs.join('');
 if(!doc||!value)return;
 try{await queueProfileChange({op:'choice',spelling:value,document_id:doc.id});}
 catch(e){status('Word saved; preference history could not save: '+e.message,true);}
}
let txQueue=Promise.resolve();
// Reversible Python-generated command patches, not full document copies.
let canUndo=false,canRedo=false;
const MAX_ATOMIC_OBJECTS=150000;
let layoutCache=null;
// Display-only indexes, reconstructed after every immutable layout publication.
// They are never authoritative document data or geometry calculations.
let itemIndexById=new Map(),placementById=new Map();
// Stable logical indices are independent of viewport and page-detail eviction.
let logicalIndexById=new Map();
function objectById(id){
 const idx=logicalIndexById.get(id);
 return idx===undefined?null:doc?.items[idx];
}
let pageSlots=[],pageObserver=null;
const MAX_DETAILED_PAGES=7;
let pageUsageClock=0;
// A detail request is valid only for the exact published document revision.
// At most one forced worker resynchronization is attempted per revision.
const repairedDetailRevisions=new Set();
function layoutDetailIsCurrent(documentId,revision,generation){
 return Boolean(!editorScreen.hidden && doc && layoutCache &&
   doc.id===documentId && doc.revision===revision &&
   layoutCache.document_id===documentId && layoutCache.revision===revision &&
   layoutVersion===generation);
}
function recoverLayoutDetailRevision(documentId,revision,generation,error){
 if(error?.code!=='LayoutRevisionConflict'||!layoutDetailIsCurrent(documentId,revision,generation))return false;
 const key=documentId+':'+revision;
 if(repairedDetailRevisions.has(key))return false;
 repairedDetailRevisions.add(key);
 // No document mutation: reopen the layout mirror from the authoritative
 // editor snapshot, then replace page slots together after a full reflow.
 resetLayoutSynchronization();
 void reflow();
 return true;
}
const VIRTUALIZE_ABOVE_PAGES=10;
$('canvas-area').addEventListener('scroll',()=>{if(doc?.surface==='papyrus')schedulePapyrusWindow();},{passive:true});
const PAGE_OVERVIEW_LIMIT=80;
let pageOverviewVersion=0;
function clearPageVirtualization(){
 if(pageObserver){pageObserver.disconnect();pageObserver=null;}
 pageSlots=[];itemIndexById.clear();placementById.clear();pageUsageClock=0;
}
function unloadPageDetails(index){
 const slot=pageSlots[index];
 if(!slot||!slot.page)return;
 for(const col of slot.page.columns)for(const placement of col.placements)placementById.delete(placement.id);
 slot.page=null;
 slot.shell.replaceChildren();
}
async function renderPageDetails(index){
 if(doc?.surface==='papyrus')return renderPapyrusWindow();
 const slot=pageSlots[index];
 if(!slot||slot.shell.querySelector('.paper')||!doc)return;
 if(slot.pending)return slot.pending;
 const documentId=layoutCache?.document_id,revision=layoutCache?.revision;
 const generation=layoutVersion;
 // An edit can be queued while the previous page is still visible. Never
 // dispatch detail RPCs for a revision already superseded by that edit.
 if(!layoutDetailIsCurrent(documentId,revision,generation))return;
 const task=(async()=>{
  let p=slot.page;
  if(!p){
   const response=await layoutRpc('layout_page',{document_id:documentId,revision,index});
   if(pageSlots[index]!==slot||!layoutDetailIsCurrent(documentId,revision,generation))return;
   p=response.page;
   slot.page=p;
   for(const col of p.columns)for(const placement of col.placements)
    placementById.set(placement.id,{placement,column:col,pageIndex:index});
  }
  if(pageSlots[index]!==slot||slot.shell.querySelector('.paper'))return;
  slot.lastUsed=++pageUsageClock;
  const shell=slot.shell;
  paintPageContent(slot,p,shell);
  drawInsertionCaret();drawSelectionHandles();
  // Browser retains detailed geometry only for a bounded working set.
  const loaded=pageSlots.map((entry,i)=>({entry,i})).filter(v=>v.entry.page);
  if(loaded.length>MAX_DETAILED_PAGES){
   loaded.sort((a,b)=>(a.entry.lastUsed||0)-(b.entry.lastUsed||0));
   for(const {entry,i} of loaded){
    if(pageSlots.filter(s=>s.page).length<=MAX_DETAILED_PAGES)break;
    if(i===index||entry.shell.getBoundingClientRect().bottom>=0&&
       entry.shell.getBoundingClientRect().top<=window.innerHeight)continue;
    unloadPageDetails(i);
   }
  }
 })();
 slot.pending=task;
 try{await task;}catch(err){
  if(!recoverLayoutDetailRevision(documentId,revision,generation,err)&&
     layoutDetailIsCurrent(documentId,revision,generation))status('Page loading: '+err.message,true);
 }
 finally{if(pageSlots[index]===slot)slot.pending=null;}
}
// Papyrus is a single long page. Ask Python for a bounded column window;
// JS computes ONLY the viewport range, never document geometry or text flow.
let papyrusRequestFrame=0;
function schedulePapyrusWindow(){
 if(papyrusRequestFrame)return;
 papyrusRequestFrame=requestAnimationFrame(()=>{papyrusRequestFrame=0;renderPapyrusWindow();});
}
async function renderPapyrusWindow(){
 const slot=pageSlots[0],summary=slot?.summary;
 if(!slot||!summary||!doc||doc.surface!=='papyrus'||!layoutCache)return;
 const count=summary.column_count;
 const box=slot.shell.getBoundingClientRect();
 const viewport=$('canvas-area').getBoundingClientRect();
 const unit=zoom*pxmm;
 const margin=doc.direction==='rtl'?(doc.margins_mm?.right??18):(doc.margins_mm?.left??18);
  const left=Math.max(0,(viewport.left-box.left)/unit);
 const right=Math.max(left,(viewport.right-box.left)/unit);
 const w=layoutCache.column_width_mm;
 if(!(w>0))return;
 // Convert physical column bands into document-order column indices. The
 // same query handles RTL and LTR; coordinates themselves come from Python.
 let lo,hi;
 if(doc.direction==='rtl'){
  lo=(summary.width-margin-right)/w;
  hi=(summary.width-margin-left)/w;
 }else{
  lo=(left-margin)/w;
  hi=(right-margin)/w;
 }
 // A single image may occupy multiple physical column-width slots.
 // Page summaries carry spans only when necessary, so viewport indexing remains
 // bounded and accurate without ever requesting hidden quadrat geometry.
 const spans=summary.column_spans;
 const physicalToColumn=slotPosition=>{
  if(!spans)return slotPosition;
  if(!slot.slotStarts){
   slot.slotStarts=[0];for(const n of spans)slot.slotStarts.push(slot.slotStarts.at(-1)+n);
  }
  let low=0,high=slot.slotStarts.length-1;
  while(low<high){const mid=(low+high+1)>>1;
   if(slot.slotStarts[mid]<=slotPosition)low=mid;else high=mid-1;
  }
  return Math.min(count,low);
 };
 const first=physicalToColumn(Math.floor(lo));
 const last=physicalToColumn(Math.ceil(hi));
 const start=Math.max(0,Math.floor((first-4)/16)*16);
 const end=Math.min(count,Math.ceil((last+4)/16)*16);
 const windowKey=`${start}:${Math.max(0,end-start)}`;
 if(!count){
  if(!slot.page){slot.page={index:0,width:summary.width,height:summary.height,columns:[],dividers:[]};paintPageContent(slot,slot.page,slot.shell);}
  return;
 }
 if(start>=end)return;
 slot.wantWindow=windowKey;
 if(slot.page&&slot.windowKey===windowKey)return;
 if(slot.pending)return slot.pending;
 const documentId=layoutCache.document_id,revision=layoutCache.revision,generation=layoutVersion;
 if(!layoutDetailIsCurrent(documentId,revision,generation))return;
 let succeeded=false;
 const task=(async()=>{
  // The Python server applies a strict cap; for unusually zoomed-out views,
  // request the first 256 columns and continue shifting as users scroll.
  const response=await layoutRpc('layout_columns',{
   document_id:documentId,revision,index:0,start,limit:Math.min(256,end-start)});
  if(pageSlots[0]!==slot||!layoutDetailIsCurrent(documentId,revision,generation))return;
  const old=slot.page;
  if(old)for(const c of old.columns)for(const p of c.placements)placementById.delete(p.id);
  const page=response.page;
  slot.page=page;slot.windowKey=windowKey;
  for(const col of page.columns)for(const placement of col.placements)
   placementById.set(placement.id,{placement,column:col,pageIndex:0});
  slot.shell.replaceChildren();
  paintPageContent(slot,page,slot.shell);
  drawInsertionCaret();drawSelectionHandles();
  succeeded=true;
 })();
 slot.pending=task;
 try{await task;}catch(e){
  if(!recoverLayoutDetailRevision(documentId,revision,generation,e)&&
     layoutDetailIsCurrent(documentId,revision,generation))status('Papyrus columns: '+e.message,true);
 }
 finally{
  if(pageSlots[0]===slot){slot.pending=null;if(succeeded&&slot.wantWindow!==slot.windowKey)schedulePapyrusWindow();}
 }
}
// One verified font determines exact glyph ink and SVG baseline coordinates.
// Single SVG rendering path for ordinary, table, cartouche and preview glyphs.
function drawQuadratInk(host,quadrat,color,bold){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.classList.add('glyph-ink-svg');
 svg.setAttribute('viewBox',`0 0 ${quadrat.width} ${quadrat.height}`);
 svg.setAttribute('aria-hidden','true');
 const direction=doc?.direction||'ltr';
 const layer=document.createElementNS(ns,'g');
 layer.classList.add('hieroglyph-direction-layer');
 layer.setAttribute('data-writing-direction',direction);
 // RTL reverses the whole quadrat: both sign faces and paired-row order.
 if(reverseVisualQuadrat(direction))
  layer.setAttribute('transform',`translate(${quadrat.width} 0) scale(-1 1)`);
 svg.append(layer);
 for(const glyph of quadrat.signs){
  const text=document.createElementNS(ns,'text');text.textContent=glyph.sign;
   if(glyph.id)text.setAttribute('data-symbol-id',glyph.id);
  text.setAttribute('x',String(glyph.text_x));
  text.setAttribute('y',String(glyph.text_y));
  text.setAttribute('font-size',String(glyph.font_size));
  text.setAttribute('font-family','MdwNfr Hieroglyphs');
  text.setAttribute('direction','ltr');text.setAttribute('fill',color||'#192433');
  // Counter-mirror only semantic NoMirror glyphs; they still change position.
  if(reverseVisualQuadrat(direction)&&NO_MIRROR_HIEROGLYPHS.has(glyph.sign)){
   const center=glyph.x+glyph.width/2;
   text.setAttribute('transform',`translate(${2*center} 0) scale(-1 1)`);
   text.setAttribute('data-no-mirror','true');
  }
  if(bold){text.setAttribute('paint-order','stroke fill');
   text.setAttribute('stroke',color||'#192433');
   text.setAttribute('stroke-width',String(glyph.font_size*.012));}
  layer.append(text);
 }
 host.append(svg);
}
function paintPageContent(slot,p,shell){
 const paper=document.createElement('div');paper.className='paper';
 paper.style.width=mm(p.width);paper.style.height=mm(p.height);paper.style.transform=`scale(${zoom})`;
 paper.addEventListener('click',e=>{if(!suppressPaperClick&&e.target===paper)placeCaretFromPoint(e,p);});
 const range=selectedRange();
 for(const c of p.columns){
  for(const item of c.placements){
   if(item.type==='table'){
    const node=document.createElement('div');node.className='table-object selectable-item';
    node.dataset.id=item.id;const itemIndex=itemIndexById.get(item.id);
    node.dataset.index=String(itemIndex);node.style.left=mm(item.x);node.style.top=mm(item.y);
    node.style.width=mm(item.width_mm);node.style.height=mm(item.height);
    node.setAttribute('role','group');node.setAttribute('aria-label','Hieroglyphic table');
    node.addEventListener('pointerdown',e=>beginNestedDrag(e,item,c,p,node));
    if(range&&itemIndex>=range.start&&itemIndex<range.end)node.classList.add('selected','in-range');
    const geometry=item.table;
    const borderStyle=geometry.border_style||'solid',borderColor=geometry.border_color||'#bba477';
    const borderWidth=geometry.border_width_mm??.3;
    node.style.border=borderStyle==='none'?'none':Math.max(1,borderWidth*pxmm)+'px '+borderStyle+' '+borderColor;
    for(const cell of geometry.cells){
     const box=document.createElement('div');box.className='table-cell-view';
     box.style.border=borderStyle==='none'?'none':Math.max(1,borderWidth*pxmm)+'px '+borderStyle+' '+borderColor;
     box.style.left=mm(cell.x);box.style.top=mm(cell.y);
     box.style.width=mm(cell.width);box.style.height=mm(cell.height);
     box.dataset.row=cell.row;box.dataset.column=cell.column;
     box.setAttribute('role','button');box.tabIndex=0;
     box.setAttribute('aria-label',`Table cell ${String.fromCharCode(65+cell.column)}${cell.row+1}`);
     const choose=()=>selectTableCell(item.id,cell.row,cell.column);
     box.addEventListener('click',e=>{e.stopPropagation();choose();if(activePanel!=='format')switchPanel('format');});
     box.addEventListener('dblclick',e=>{e.stopPropagation();choose();void beginInsertSheet('table',item.id);});
     box.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();if(activePanel!=='format')switchPanel('format');}});
     if(selectedTableCell?.tableId===item.id&&selectedTableCell.row===cell.row&&selectedTableCell.column===cell.column)box.classList.add('active');
     for(const w of cell.words){
      const wordNode=document.createElement('div');wordNode.className='table-cell-word';
      wordNode.style.left=mm(w.x);wordNode.style.top=mm(w.y);
      wordNode.style.width=mm(w.quadrat.width);wordNode.style.height=mm(w.height);
      drawQuadratInk(wordNode,w.quadrat,w.color,w.bold);
      box.append(wordNode);
     }
     if(cell.error){const err=document.createElement('span');err.className='table-cell-error';err.textContent='⚠';err.title=cell.error;box.append(err);}
     node.append(box);
    }
    paper.append(node);continue;
   }
   if(item.type==='cartouche'){
    const node=document.createElement('div');node.className='cartouche-object selectable-item';
    const itemIndex=itemIndexById.get(item.id);node.dataset.id=item.id;node.dataset.index=String(itemIndex);
    node.style.left=mm(item.x);node.style.top=mm(item.y);
    node.style.width=mm(item.width_mm);node.style.height=mm(item.height);
    if(range&&itemIndex>=range.start&&itemIndex<range.end)node.classList.add('selected','in-range');
    node.setAttribute('role','button');node.tabIndex=0;node.setAttribute('aria-label','Hieroglyphic cartouche');
    node.addEventListener('click',e=>{e.stopPropagation();selectWord(item.id,e.shiftKey);});
    node.addEventListener('dblclick',e=>{e.stopPropagation();void beginInsertSheet('cartouche',item.id);});
    node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectWord(item.id);if(activePanel!=='format')switchPanel('format');}});
    node.addEventListener('pointerdown',e=>beginNestedDrag(e,item,c,p,node));
    const geometry=item.cartouche;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('class','cartouche-outline');svg.setAttribute('viewBox',geometry.view_box);
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',geometry.outline_path);
    path.setAttribute('stroke-width',String(geometry.stroke_mm));
    svg.append(path);node.append(svg);
    for(const w of geometry.words){
     const wordNode=document.createElement('div');wordNode.className='cartouche-word';
     wordNode.style.left=mm(w.x);wordNode.style.top=mm(w.y);
     wordNode.style.width=mm(w.quadrat.width);wordNode.style.height=mm(w.height);
     drawQuadratInk(wordNode,w.quadrat,w.color,w.bold);
     node.append(wordNode);
    }
    paper.append(node);continue;
   }
   const isArt=item.type==='clipart'||item.type==='image';
   const node=document.createElement('div');node.className=isArt?'clipart-object selectable-item':'word selectable-item';node.dataset.id=item.id;
   const itemIndex=itemIndexById.get(item.id);
   node.dataset.index=String(itemIndex);
   node.style.left=mm(item.x);node.style.top=mm(item.y);
   node.style.width=mm(isArt?item.width_mm:c.width);node.style.height=mm(item.height);
   if(range&&itemIndex>=range.start&&itemIndex<range.end)node.classList.add('selected','in-range');
   node.setAttribute('role','button');node.setAttribute('tabindex','0');
   node.setAttribute('aria-label',isArt?(item.type==='image'?'Image '+(objectById(item.id)?.name||'Imported image'):'Clip art '+(artworkById.get(item.artwork_id)?.name||item.artwork_id)):'Word '+item.signs.join(''));
   node.addEventListener('click',e=>{e.stopPropagation();if(!suppressWordClick)selectWord(item.id,e.shiftKey);});
   if(isArt)node.addEventListener('pointerdown',e=>beginClipartDrag(e,item,c,p,node));
   else node.addEventListener('pointerdown',e=>beginMouseRangeDrag(e,item.id));
   node.addEventListener('dblclick',e=>{e.stopPropagation();if(!suppressWordClick){if(isArt)void beginInsertSheet(item.type,item.id);else openWord(item.id);}});
   node.addEventListener('keydown',e=>{
    if(e.key==='Enter'){if(isArt)void beginInsertSheet(item.type,item.id);else openWord(item.id);}
    if(e.key===' '){e.preventDefault();selectWord(item.id,e.shiftKey);}
   });
   if(isArt){
    const asset=artworkById.get(item.artwork_id);
    const img=document.createElement('img');img.className='clipart-image';
    // IDs are validated against the bundled catalog by the Python core.
    const original=objectById(item.id);
    img.src=item.type==='image'?(original?.data_url||(insertDraft?.object?.id===item.id?insertDraft.object.data_url:null)):'/artwork/'+(asset?.file||item.artwork_id+'.png');
    img.alt=item.type==='image'?(original?.name||'Imported image'):(asset?.name||item.artwork_id);img.draggable=false;
    // Python provides the same resolved orientation used for 2D clearance.
    const mirrored=(item.resolved_flip||item.flip)==='mirror';
    img.style.transform=mirrored?'scaleX(-1)':'';
    node.append(img);
    for(const edge of ['top-left','top','top-right','right','bottom-right','bottom','bottom-left','left']){
     const h=document.createElement('span');h.className='art-resize '+edge;h.dataset.handle=edge;
     h.setAttribute('aria-label','Resize '+(asset?.name||'clip art')+' '+edge);
     h.addEventListener('pointerdown',ev=>beginClipartResize(ev,item,node,edge));
     node.append(h);
    }
   }else{
    drawQuadratInk(node,item.quadrat,item.color,item.bold);
   }
   paper.append(node);
  }
 }
 for(const line of p.dividers){
  const el=document.createElement('div');el.className='divider-line';
  // CSS subpixel rounding made identical dividers look thin/thick at zoom.
  // Quantize both width and left edge to the same physical pixel grid.
  const thickness=line.thickness_mm??0.53;
  const physicalGrid=1/(Math.max(.01,zoom)*Math.max(1,window.devicePixelRatio||1));
  const widthPx=Math.max(physicalGrid,Math.round(thickness*pxmm/physicalGrid)*physicalGrid);
  const leftPx=Math.round((line.x*pxmm-widthPx/2)/physicalGrid)*physicalGrid;
  el.style.left=leftPx+'px';el.style.width=widthPx+'px';
  el.style.top=mm(line.y1);el.style.height=mm(line.y2-line.y1);
  paper.append(el);
 }
 shell.append(paper);
}
function showPageInViewport(index){
 renderPageDetails(index);drawInsertionCaret();drawSelectionHandles();
}
let libraryBusy=false;
const libraryScreen=$('library-screen');
const editorScreen=$('editor-screen');
// Exactly one floating inspector is visible at a time; panels never resize the page.
const PANELS={pages:'pages-panel',format:'format-panel',keyboard:'keyboard-panel'};
const TRIGGERS={pages:'pages-toggle',format:'format-toggle',keyboard:'keyboard-toggle'};
let activePanel=null;
let selectedColour='#1f4ba8';
function setFormatView(view='main'){
 $('format-panel').dataset.view=view;
 $('format-main').hidden=view!=='main';
 $('format-colors').hidden=view!=='colors';
 $('color-picker').setAttribute('aria-expanded',String(view==='colors'));
 $('format-panel').scrollTop=0;
}
function switchPanel(name=null){
 hideEditMenu();
 setFormatView('main');
 activePanel=activePanel===name?null:name;
 for(const kind of Object.keys(PANELS)){
  const opened=kind===activePanel;
  $(PANELS[kind]).hidden=!opened;
  $(TRIGGERS[kind]).setAttribute('aria-expanded',String(opened));
  $(TRIGGERS[kind]).classList.toggle('is-active',opened);
 }
 if(activePanel==='pages')renderPagesOverview();
 if(activePanel==='format')updateFormatState();
}
function closePanels(){if(activePanel)switchPanel(null);}
// Switch icons own their clicks. Any click/tap outside the active panel closes it.
for(const kind of Object.keys(TRIGGERS)){
 $(TRIGGERS[kind]).addEventListener('click',()=>{
  if(kind==='keyboard'&&keyboardWasDragged){keyboardWasDragged=false;return;}
  switchPanel(kind);
 });
}
document.addEventListener('pointerdown',e=>{
 if(!e.target.closest('#edit-menu'))hideEditMenu();
 if(!activePanel||editorScreen.hidden)return;
 if(e.target.closest('.panel-trigger')||e.target.closest('#'+PANELS[activePanel]))return;
 closePanels();
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
  if(!$('edit-menu').hidden){hideEditMenu();e.preventDefault();return;}
  if(activePanel==='format'&&$('format-panel').dataset.view==='colors'){
   setFormatView('main');$('color-picker').focus();e.preventDefault();
  }else if(activePanel)closePanels();
 }
});
// Physical key codes keep commands usable with Arabic, Coptic, or other
// active keyboard layouts. Do not capture native typing in text controls.
document.addEventListener('keydown',e=>{
 if(editorScreen.hidden||!doc||e.isComposing||e.repeat||e.altKey)return;
 const mod=e.ctrlKey||e.metaKey;
 const code=e.code||'';
 const textFocus=e.target instanceof Element &&
   Boolean(e.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],#dialog-backdrop'));
 if(mod&&e.shiftKey&&['Digit1','Digit2','Digit3','Numpad1','Numpad2','Numpad3'].includes(code)){
  e.preventDefault();
  const panel=code.endsWith('1')?'keyboard':code.endsWith('2')?'format':'pages';
  switchPanel(panel);return;
 }
 if(textFocus)return;
 if(mod&&!e.shiftKey&&code==='KeyB'){
  e.preventDefault();if(!$('bold').disabled)$('bold').click();return;
 }
});
let keyboardWasDragged=false;
// Optional draggable owl, with normal tap semantics preserved.
{
 const owl=$('keyboard-toggle');let drag=null;
 owl.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  const rect=owl.getBoundingClientRect();
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,moved:false};
 });
 owl.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.moved&&Math.hypot(dx,dy)<8)return;
  if(!drag.moved){drag.moved=true;owl.setPointerCapture(e.pointerId);}
  owl.style.left=Math.max(8,Math.min(innerWidth-owl.offsetWidth-8,drag.left+dx))+'px';
  owl.style.top=Math.max(8,Math.min(innerHeight-owl.offsetHeight-8,drag.top+dy))+'px';
  owl.style.bottom='auto';owl.style.right='auto';
 });
 owl.addEventListener('pointerup',e=>{
  if(drag?.id===e.pointerId){
   if(drag.moved){keyboardWasDragged=true;setTimeout(()=>{keyboardWasDragged=false;},0);}
   drag=null;
  }
 });
 owl.addEventListener('pointercancel',()=>{drag=null;});
}
function updateHistoryState(){
 $('undo').disabled=!canUndo||!doc;
 $('redo').disabled=!canRedo||!doc;
}
function editableStyleWords(selection=selectedItems()){
 const direct=selection.filter(item=>item.type==='word');
 if(direct.length)return direct;
 if(selection.length!==1)return [];
 const item=selection[0];
 if(item.type==='cartouche')return item.items;
 if(item.type==='table'&&selectedTableCell?.tableId===item.id){
  const cell=item.rows[selectedTableCell.row]?.[selectedTableCell.column];
  return cell?.mode==='text'?cell.items:[];
 }
 return [];
}
function updateFormatState(){
 updateHistoryState();
 const selection=selectedItems();
 const clip=selection.length===1&&['clipart','image'].includes(selection[0]?.type)?selection[0]:null;
 const currentTable=selection.length===1&&selection[0]?.type==='table'?selection[0]:null;
 renderTableControls(currentTable);
 const nested=currentTable||(selection.length===1&&selection[0]?.type==='cartouche'?selection[0]:null);
 $('nested-position-controls').hidden=!nested;
 if(nested){$('nested-horizontal').value=Math.round(100*(nested.x_align??0));
  $('nested-vertical').value=Math.round(100*(nested.y_align??0));
  $('nested-float').value=Number(nested.x_offset_mm??0).toFixed(1);}
 $('clipart-controls').hidden=!clip;
 const selectedCartouche=selection.length===1&&selection[0]?.type==='cartouche'?selection[0]:null;
 $('cartouche-controls').hidden=!selectedCartouche;
 if(selectedCartouche){
  $('cartouche-orientation').value=selectedCartouche.orientation;
  const marker=`${selectedCartouche.id}:${doc?.revision}`;
  if($('cartouche-words').dataset.source!==marker){
   $('cartouche-words').value=selectedCartouche.items.map(w=>w.signs.join('')).join(' ');
   $('cartouche-words').dataset.source=marker;
  }
 }
 if(clip){$('clipart-width').value=clip.width_mm;$('clipart-flip').value=clip.flip;
  $('clipart-horizontal').value=Math.round(100*(clip.x_align??0.5));
  $('clipart-float').value=Number(clip.x_offset_mm??0).toFixed(1);
  $('clipart-vertical').value=Math.round(100*(clip.y_align??0.5));}

 const words=editableStyleWords(selection);
 const hasWords=words.length>0;
 $('bold').disabled=!hasWords;$('delete').disabled=!selection.length;
 $('color-black').disabled=!hasWords;$('color-red').disabled=!hasWords;
 $('color-custom').disabled=!hasWords;$('color-picker').disabled=!hasWords;
 $('color-hex').disabled=!hasWords;
 if(hasWords)selectedColour=normalizeColour(words[0].color)||'#192433';
 refreshColourState();
 $('copy-selection').disabled=!selection.length;
 $('cut-selection').disabled=!selection.length;
 $('paste-selection').disabled=!doc;
 $('select-all').disabled=!doc?.items.length;
 $('selection-summary').textContent=selection.length
   ? selection.length+' selected' : 'No selection';
 $('bold').setAttribute('aria-pressed',String(hasWords&&words.every(w=>w.bold)));
 $('dir-rtl').classList.toggle('chosen',doc?.direction==='rtl');
 $('dir-ltr').classList.toggle('chosen',doc?.direction==='ltr');
 $('dir-rtl').setAttribute('aria-pressed',String(doc?.direction==='rtl'));
 $('dir-ltr').setAttribute('aria-pressed',String(doc?.direction==='ltr'));
}
function renderPagesOverview(){
 const container=$('pages-overview');container.replaceChildren();
 const panel=$('pages-panel'),version=++pageOverviewVersion;
 panel.onscroll=null;container.classList.remove('virtual-pages');container.style.height='';
 const total=pageSlots.length;
 $('page-total').textContent=total+' '+(total===1?'page':'pages');
 if(!total){const empty=document.createElement('p');empty.className='coming-soon';empty.textContent='No laid-out pages yet.';container.append(empty);return;}
 // Keep large documents bounded without adding controls to the page list.
 // The scroll position determines which single-column thumbnails exist.
 const pitch=144;
 const virtual=total>PAGE_OVERVIEW_LIMIT;
 container.classList.toggle('virtual-pages',virtual);
 container.style.height=virtual?(total*pitch+3)+'px':'';
 let paintedStart=-1,scheduled=false;
 function paintThumbnails(){
  scheduled=false;
  if(version!==pageOverviewVersion)return;
  const start=virtual?Math.min(total-PAGE_OVERVIEW_LIMIT,
   Math.max(0,Math.floor((panel.scrollTop-container.offsetTop)/pitch)-5)):0;
  if(start===paintedStart)return;
  paintedStart=start;container.replaceChildren();
  for(let idx=start;idx<Math.min(total,start+PAGE_OVERVIEW_LIMIT);idx++){
   const shell=pageSlots[idx].shell;
   const button=document.createElement('button');button.type='button';button.className='page-overview-item';
   button.setAttribute('aria-label','Go to page '+(idx+1));
   if(virtual)button.style.top=(15+idx*pitch)+'px';
   const shape=document.createElement('span');shape.className='page-miniature';
   // Bounded miniature uses positioned Python layout, not fake striped lines.
   for(const column of pageSlots[idx].summary?.preview_columns||[]){
    const mark=document.createElement('span');
    mark.className='page-mini-stroke '+(column.kind==='words'?'words':'object');
    mark.style.left=Math.round(column.x*100)+'%';
    mark.style.top=Math.round(column.y*100)+'%';
    mark.style.width=Math.max(1,Math.round(Math.min(column.w,1-column.x)*100))+'%';
    mark.style.height=Math.max(2,Math.round(column.h*100))+'%';
    shape.append(mark);
   }
   const label=document.createElement('span');label.textContent='Page '+(idx+1);
   button.append(shape,label);
   button.onclick=()=>{closePanels();shell.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});};
   container.append(button);
  }
 }
 panel.onscroll=virtual?()=>{if(!scheduled){scheduled=true;requestAnimationFrame(paintThumbnails);}}:null;
 paintThumbnails();
}
// Legacy v4 artwork is data only; the editor does not import any v4 code.
async function ensureArtworkCatalog(){
 if(artworkEntries)return artworkEntries;
 const response=await fetch('/artwork/catalog.json',{cache:'force-cache'});
 if(!response.ok)throw Error('Clip-art catalog missing');
 const data=await response.json();
 if(data.format!=='mdwnfr-artwork-v1'||data.count!==data.artworks?.length)throw Error('Invalid clip-art catalog');
 artworkEntries=data.artworks;artworkById=new Map(artworkEntries.map(a=>[a.id,a]));
 return artworkEntries;
}
function displayArtworkGrid(filter=''){
 const root=$('artwork-grid');root.replaceChildren();
 const term=filter.trim().toLowerCase();
 for(const art of artworkEntries||[]){
  if(term&&!`${art.name} ${art.category} ${art.id}`.toLowerCase().includes(term))continue;
  const button=document.createElement('button');button.type='button';button.className='artwork-choice';
  button.title=art.name;button.setAttribute('aria-label','Preview '+art.name);
  const img=document.createElement('img');img.src='/artwork/'+art.file;img.loading='lazy';img.alt='';
  const label=document.createElement('span');label.textContent=art.name;
  button.append(img,label);
  button.onclick=()=>chooseInsertArtwork(art);
  button.setAttribute('aria-pressed',String(insertDraft?.object?.artwork_id===art.id));
  root.append(button);
 }
}
$('insert-clipart').onclick=()=>beginInsertSheet('clipart');
$('artwork-search').addEventListener('input',e=>displayArtworkGrid(e.target.value));

// All four insert screens share ONE uncommitted Python document preview.
// No CSS-only text approximation, duplicate compositor or interim save.
let insertTicket=0,insertPreviewTimer=null,insertPreviewVersion=0;
function closeInsertSheet(){
 ++insertTicket;++insertPreviewVersion;
 if(insertPreviewTimer!==null)clearTimeout(insertPreviewTimer);
 insertPreviewTimer=null;insertDraft=null;
 $('insert-dialog-backdrop').hidden=true;
 $('insert-preview').replaceChildren();
 $('insert-sheet-confirm').disabled=true;
}
function insertIndex(){
 const range=selectedRange();
 return range?range.end:caretIndex;
}
async function insertPrototype(action,index){
 const response=await rpc('transact',{document:doc,action:{...action,index}});
 return response.document.items[index];
}
async function beginInsertSheet(kind,existingId=null){
 if(!doc||!ready)return;
 const original=existingId?objectById(existingId):null;
 if(original&&original.type!==kind)return;
 closeInsertSheet();closePanels();
 const token=insertTicket;
 const index=original?logicalIndexById.get(original.id):insertIndex();
 insertDraft={token,kind,index,existingId,object:original?structuredClone(original):null,
              busy:false,valid:false};
 $('insert-dialog-backdrop').hidden=false;
 $('insert-sheet-title').textContent=(original?'Edit ':'Insert ')+
  ({clipart:'Clip Art',image:'Image',table:'Table',cartouche:'Cartouche'}[kind]);
 $('insert-sheet-confirm').textContent=original?'Apply':'Insert';
 for(const name of ['clipart','image','table','cartouche'])
  $('insert-screen-'+name).hidden=name!==kind;
 // Prevent edits until the initial Python draft has been constructed.
 // Otherwise a late default can silently overwrite the user's choices.
 const initializing=!original&&(kind==='table'||kind==='cartouche');
 for(const id of ['insert-table-rows','insert-table-columns',
                  'insert-table-border','insert-table-color',
                  'insert-table-line','insert-table-padding'])
  $(id).disabled=initializing;
 for(const input of $('insert-screen-cartouche').querySelectorAll('input[type=radio]'))
  input.disabled=initializing;
 $('insert-placement').hidden=true;
 $('insert-preview-status').textContent='Preparing document preview…';
 $('insert-preview').replaceChildren();
 $('insert-sheet-confirm').disabled=true;
 try{
  if(kind==='clipart'){
   await ensureArtworkCatalog();
   if(insertDraft?.token!==token)return;
   displayArtworkGrid($('artwork-search').value);
  }else if(kind==='image'){
   if(original){$('insert-image-name').textContent=original.name||'Image';
    $('insert-image-thumbnail').src=original.data_url;
    $('insert-image-thumbnail').hidden=false;}
   else{$('insert-image-name').textContent='No picture selected';
    $('insert-image-thumbnail').hidden=true;}
  }else{
   if(!original){
    insertDraft.object=await insertPrototype(
     kind==='table'?{op:'insert_table',rows:2,columns:2}:
                   {op:'insert_cartouche',orientation:'vertical'},index);
   }
   if(insertDraft?.token!==token)return;
   if(kind==='table'){
    const table=insertDraft.object;
    $('insert-table-rows').value=table.rows.length;
    $('insert-table-columns').value=table.rows[0].length;
    $('insert-table-border').value=table.style?.border_style||'solid';
    $('insert-table-color').value=table.style?.border_color||'#bba477';
    $('insert-table-line').value=table.style?.border_width_mm??.3;
    $('insert-table-padding').value=table.style?.cell_padding_mm??1;
   }else{
    $('insert-screen-cartouche').querySelector(
     'input[value="'+insertDraft.object.orientation+'"]').checked=true;
   }
  }
  if(insertDraft?.token!==token)return;
  for(const id of ['insert-table-rows','insert-table-columns',
                   'insert-table-border','insert-table-color',
                   'insert-table-line','insert-table-padding'])$(id).disabled=false;
  for(const input of $('insert-screen-cartouche').querySelectorAll('input[type=radio]'))
   input.disabled=false;
  if(insertDraft?.object)requestInsertPreview();
  else $('insert-preview-status').textContent='Choose an item to preview it on the page';
 }catch(error){
  if(insertDraft?.token===token){
   $('insert-preview-status').textContent=error.message;
   $('insert-sheet-confirm').disabled=true;
  }
 }
 $('insert-sheet').focus();
}
async function chooseInsertArtwork(art){
 const draft=insertDraft;
 if(!draft||draft.kind!=='clipart'||draft.busy)return;
 draft.busy=true;
 try{
  const created=await insertPrototype({op:'insert_clipart',
    artwork_id:art.id},draft.index);
  if(insertDraft!==draft)return;
  draft.object=created;
  $('insert-artwork-name').textContent=art.name;
  displayArtworkGrid($('artwork-search').value);
  requestInsertPreview();
 }catch(err){$('insert-preview-status').textContent=err.message;}
 finally{draft.busy=false;}
}
function previewDocument(){
 const d=insertDraft;
 if(!d?.object||!doc)return null;
 const items=doc.items.slice();
 if(d.existingId)items[d.index]=d.object;
 else items.splice(d.index,0,d.object);
 // Preview revision lives only in this isolated worker call. The active
 // editor session never receives a speculative transaction.
 return {...doc,items,revision:doc.revision};
}
function requestInsertPreview(){
 const d=insertDraft;if(!d?.object)return;
 d.valid=false;$('insert-sheet-confirm').disabled=true;
 if(insertPreviewTimer!==null)clearTimeout(insertPreviewTimer);
 const version=++insertPreviewVersion;
 insertPreviewTimer=setTimeout(()=>{insertPreviewTimer=null;
   void runInsertPreview(d,version);},130);
}
async function runInsertPreview(d,version){
 if(insertDraft!==d)return;
 $('insert-preview-status').textContent='Calculating live text reflow…';
 try{
  const proposed=previewDocument();
  const response=await layoutRpc('layout',{document:proposed});
  if(insertDraft!==d||version!==insertPreviewVersion)return;
  const pages=response.layout.pages;
  const page=pages.find(p=>p.columns.some(c=>c.placements.some(
    pos=>pos.id===d.object.id)))||pages[0];
  const position=page.columns.flatMap(c=>c.placements).find(
    pos=>pos.id===d.object.id);
  if(!position)throw Error('Proposed object is not visible in its writing frame');
  const holder=$('insert-preview');
  holder.replaceChildren();
  const limitW=Math.max(150,holder.clientWidth-22),limitH=Math.max(130,holder.clientHeight-22);
  const scale=Math.min(.95,limitW/(page.width*pxmm),limitH/(page.height*pxmm));
  const shell=document.createElement('div');
  shell.className='insert-preview-shell';
  shell.style.width=mm(page.width*scale);shell.style.height=mm(page.height*scale);
  holder.append(shell);
  const oldZoom=zoom;
  try{zoom=scale;paintPageContent(null,page,shell);}
  finally{zoom=oldZoom;}
  const paper=shell.querySelector('.paper');
  if(paper)paper.style.pointerEvents='none';
  const selection=document.createElement('div');
  selection.className='insert-preview-selection';
  selection.style.left=mm(position.x*scale);
  selection.style.top=mm(position.y*scale);
  selection.style.width=mm(position.width_mm*scale);
  selection.style.height=mm(position.height*scale);
  selection.setAttribute('role','group');
  selection.setAttribute('aria-label','Move or resize preview object');
  const handle=document.createElement('span');
  handle.className='insert-preview-handle';
  handle.setAttribute('aria-label','Resize temporary object');
  selection.append(handle);shell.append(selection);
  enableInsertPreviewDrag(selection,d,scale,page,position);
  $('insert-preview-status').textContent='Live page preview · nothing saved until Confirm';
  $('insert-placement').hidden=false;
  $('insert-object-width').disabled=d.kind==='cartouche';
  $('insert-object-width').value=d.kind==='cartouche'?'':String(
    Math.round((d.object.width_mm||position.width_mm)*10)/10);
  $('insert-object-width').min=d.kind==='table'?'15':'6';
  $('insert-object-width').max=d.kind==='table'?'500':'300';
  $('insert-object-y').value=Math.round((d.object.y_align??.5)*100);
  d.valid=true;$('insert-sheet-confirm').disabled=false;
 }catch(err){
  if(insertDraft===d&&version===insertPreviewVersion){
   d.valid=false;
   $('insert-sheet-confirm').disabled=true;
   $('insert-preview-status').textContent='Cannot place object: '+err.message;
  }
 }
}
function enableInsertPreviewDrag(node,d,scale,page,pos){
 node.addEventListener('pointerdown',e=>{
  if(e.button!==0||insertDraft!==d)return;
  e.preventDefault();e.stopPropagation();
  const resize=Boolean(e.target.closest('.insert-preview-handle'));
  const startX=e.clientX,startY=e.clientY;
  const base=structuredClone(d.object);
  const baseWidth=pos.width_mm;
  const room=page.height-(doc.margins_mm?.top??18)-
   (doc.margins_mm?.bottom??18)-pos.height;
  node.setPointerCapture(e.pointerId);
  let changed=false;
  const move=ev=>{
   if(ev.pointerId!==e.pointerId)return;
   const dx=(ev.clientX-startX)/(scale*pxmm),
         dy=(ev.clientY-startY)/(scale*pxmm);
   if(Math.abs(dx)+Math.abs(dy)<.2)return;
   changed=true;
   if(resize){
    if(d.kind==='cartouche'){
     d.object.enclosure_padding_mm=Math.min(30,Math.max(0,
      Math.round(((base.enclosure_padding_mm||0)+dx/2)*10)/10));
    }else{
     const min=d.kind==='table'?15:6,max=d.kind==='table'?500:300;
     d.object.width_mm=Math.min(max,Math.max(min,
      Math.round((baseWidth+dx)*10)/10));
    }
   }else{
    const logical=doc.direction==='rtl'?-dx:dx;
    d.object.x_offset_mm=Math.min(2000,Math.max(-2000,
     Math.round(((base.x_offset_mm||0)+logical)*10)/10));
    d.object.y_align=Math.min(1,Math.max(0,(base.y_align??.5)+
     (room>0?dy/room:0)));
   }
   node.style.transform='translate('+(resize?0:ev.clientX-startX)+'px,'+
    (resize?0:ev.clientY-startY)+'px)';
  };
  const finish=ev=>{
   if(ev.pointerId!==e.pointerId)return;
   node.removeEventListener('pointermove',move);
   node.removeEventListener('pointerup',finish);
   node.removeEventListener('pointercancel',cancel);
   node.style.transform='';
   if(changed)requestInsertPreview();
  };
  const cancel=()=>{d.object=base;node.style.transform='';
   node.removeEventListener('pointermove',move);
   node.removeEventListener('pointerup',finish);
   node.removeEventListener('pointercancel',cancel);};
  node.addEventListener('pointermove',move);
  node.addEventListener('pointerup',finish);
  node.addEventListener('pointercancel',cancel);
 });
}
// One requested table specification per user event, queued in order.
// The Python transaction replaces dimensions and styling in one operation;
// later user input wins, and preview never shows an earlier stale request.
function scheduleInsertTableSpec(){
 const d=insertDraft;
 if(!d||d.kind!=='table'||!d.object)return;
 const rows=Number($('insert-table-rows').value);
 const cols=Number($('insert-table-columns').value);
 const style={
  border_style:$('insert-table-border').value,
  border_color:$('insert-table-color').value,
  border_width_mm:Number($('insert-table-line').value),
  cell_padding_mm:Number($('insert-table-padding').value)};
 const requestKey=JSON.stringify([rows,cols,style]);
 // When Confirm receives a pointer press, the currently focused field blurs
 // and fires change. Do not disable Confirm for that duplicate snapshot:
 // doing so between pointerdown and click silently eats the user's click.
 if(requestKey===d.lastRequestedSpec)return;
 d.lastRequestedSpec=requestKey;
 const version=d.specRequested=(d.specRequested||0)+1;
 // Invalidate any layout already in flight: otherwise its stale completion
 // can re-enable Confirm before this newer table specification is validated.
 ++insertPreviewVersion;
 if(insertPreviewTimer!==null){clearTimeout(insertPreviewTimer);insertPreviewTimer=null;}
 d.valid=false;$('insert-sheet-confirm').disabled=true;
 if(!Number.isInteger(rows)||rows<1||rows>24||
    !Number.isInteger(cols)||cols<1||cols>12||
    !Number.isFinite(style.border_width_mm)||!Number.isFinite(style.cell_padding_mm)){
  $('insert-preview-status').textContent='Choose a valid table size and style';
  return;
 }
 const previous=d.specQueue||Promise.resolve();
 d.specQueue=previous.catch(()=>{}).then(async()=>{
  if(insertDraft!==d||version!==d.specRequested)return;
  const sandbox={...doc,items:[d.object]};
  try{
   const response=await rpc('transact',{document:sandbox,action:{
    op:'set_table_spec',id:d.object.id,rows,columns:cols,style}});
   if(insertDraft!==d||version!==d.specRequested)return;
   d.object=response.document.items[0];
   d.specApplied=version;
   requestInsertPreview();
  }catch(err){
   if(insertDraft===d&&version===d.specRequested){
    d.valid=false;$('insert-sheet-confirm').disabled=true;
    $('insert-preview-status').textContent='Invalid table configuration: '+err.message;
   }
  }
 });
}
for(const id of ['insert-table-rows','insert-table-columns',
                  'insert-table-border','insert-table-color',
                  'insert-table-line','insert-table-padding']){
 $(id).addEventListener('change',scheduleInsertTableSpec);
}
// Apply typed values before blur so a Confirm press never initiates a new
// specification as a side effect of losing focus.
for(const id of ['insert-table-rows','insert-table-columns',
                  'insert-table-color','insert-table-line','insert-table-padding'])
 $(id).addEventListener('input',scheduleInsertTableSpec);
for(const input of $('insert-screen-cartouche').querySelectorAll('input[type=radio]'))
 input.addEventListener('change',()=>{
  if(insertDraft?.kind==='cartouche'&&input.checked){
   insertDraft.object.orientation=input.value;requestInsertPreview();
  }
 });
$('insert-object-width').addEventListener('change',e=>{
 const d=insertDraft;if(!d?.object||d.kind==='cartouche')return;
 const width=Number(e.target.value);
 if(!Number.isFinite(width)||width<(d.kind==='table'?15:6)||
    width>(d.kind==='table'?500:300))return;
 d.object.width_mm=width;requestInsertPreview();
});
$('insert-object-y').addEventListener('input',e=>{
 if(insertDraft?.object){insertDraft.object.y_align=Number(e.target.value)/100;
  requestInsertPreview();}
});
$('insert-image-choose').onclick=()=>$('insert-image-file').click();
$('insert-image-file').addEventListener('change',async e=>{
 const file=e.target.files?.[0];e.target.value='';
 const d=insertDraft;if(!file||d?.kind!=='image'||d.busy)return;
 d.busy=true;
 try{
  $('insert-preview-status').textContent='Preparing embedded image…';
  const image=await prepareImportedImage(file);
  const created=await insertPrototype({op:'insert_image',...image},d.index);
  if(insertDraft!==d)return;
  d.object=created;
  $('insert-image-name').textContent=file.name;
  $('insert-image-thumbnail').src=created.data_url;
  $('insert-image-thumbnail').hidden=false;
  requestInsertPreview();
 }catch(error){if(insertDraft===d)$('insert-preview-status').textContent=error.message;}
 finally{d.busy=false;}
});
$('insert-sheet-cancel').onclick=closeInsertSheet;
$('insert-sheet-cancel-top').onclick=closeInsertSheet;
$('insert-dialog-backdrop').addEventListener('pointerdown',e=>{
 if(e.target===$('insert-dialog-backdrop'))closeInsertSheet();
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!$('insert-dialog-backdrop').hidden){
  e.preventDefault();e.stopImmediatePropagation();closeInsertSheet();
 }
},true);
$('insert-sheet-confirm').onclick=async()=>{
 const d=insertDraft;
 if(!d?.object||!d.valid||d.busy)return;
 if(d.kind==='table' && (d.specApplied||0)!==(d.specRequested||0)){
  $('insert-preview-status').textContent='Updating table settings; confirm when the latest preview is ready…';
  return;
 }
 d.busy=true;$('insert-sheet-confirm').disabled=true;
 const action=d.existingId?{op:'splice',index:d.index,
  delete_count:1,objects:[d.object],fresh_ids:false}:
  {op:'insert_existing',index:d.index,object:d.object};
 const success=await apply(action);
 if(insertDraft!==d)return;
 if(success){closeInsertSheet();clearSelection();
  caretIndex=Math.min(doc.items.length,d.index+1);
  updateSelection();}
 else{
  d.busy=false;d.valid=true;$('insert-sheet-confirm').disabled=false;
  $('insert-preview-status').textContent='Could not commit the object. Check the editor status and try again.';
 }
};

// Convert local PNG/JPEG/WebP into a portable PNG plus a conservative alpha
// contour. No Blob URL or file-system path is persisted in the document.
async function prepareImportedImage(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose PNG, JPEG or WebP');
 if(file.size>8*1024*1024)throw Error('Image file exceeds the 8 MiB import limit');
 const url=URL.createObjectURL(file);
 let source;
 try {
  source=new Image();source.decoding='async';source.src=url;await source.decode();
  const naturalW=source.naturalWidth,naturalH=source.naturalHeight;
  if(!naturalW||!naturalH||naturalW>16000||naturalH>16000)throw Error('Unsupported image dimensions');
  const factor=Math.min(1,1600/Math.max(naturalW,naturalH),Math.sqrt(3_000_000/(naturalW*naturalH)));
  const w=Math.max(1,Math.round(naturalW*factor)),h=Math.max(1,Math.round(naturalH*factor));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('Canvas is unavailable');
  ctx.clearRect(0,0,w,h);ctx.drawImage(source,0,0,w,h);
  const pixels=ctx.getImageData(0,0,w,h).data;
  const bands=[];let occupied=false;
  for(let row=0;row<128;row++){
   const top=Math.floor(row*h/128),bottom=Math.max(top+1,Math.ceil((row+1)*h/128));
   let lo=w,hi=0;
   for(let y=top;y<Math.min(h,bottom);y++)for(let x=0;x<w;x++){
    if(pixels[(y*w+x)*4+3]>8){lo=Math.min(lo,x);hi=Math.max(hi,x+1);}
   }
   if(hi<=lo)bands.push(null);
   else {occupied=true;bands.push([Math.floor(lo*10000/w),Math.ceil(hi*10000/w)]);}
  }
  if(!occupied)throw Error('Image has no visible pixels');
  // Store a real two-dimensional alpha mask. A column queries its exact
  // occupied pixels; the renderer never calculates the silhouette.
  const maskCanvas=document.createElement('canvas');maskCanvas.width=256;maskCanvas.height=256;
  const maskContext=maskCanvas.getContext('2d',{willReadFrequently:true});
  if(!maskContext)throw Error('2D silhouette canvas unavailable');
  maskContext.clearRect(0,0,256,256);maskContext.drawImage(canvas,0,0,256,256);
  const maskPixels=maskContext.getImageData(0,0,256,256).data;
  const maskBytes=new Uint8Array(8192);
  for(let p=0;p<65536;p++)if(maskPixels[p*4+3]>8)maskBytes[p>>3]|=1<<(7-(p&7));
  const mask=btoa(String.fromCharCode(...maskBytes));
  const data_url=canvas.toDataURL('image/png');
  if(data_url.length>11_200_000)throw Error('Normalized PNG exceeds embedded image limit');
  return {data_url,pixel_width:w,pixel_height:h,bands,mask,
   name:(file.name||'Imported image').slice(0,120),width_mm:65};
 }finally{URL.revokeObjectURL(url);}
}
// Table data is a nested word list. All edits are sent as one Python
// transaction and the page only mirrors the resulting geometry.
$('insert-cartouche').onclick=()=>beginInsertSheet('cartouche');
function selectedCartoucheObject(){const selected=selectedItems();
 return selected.length===1&&selected[0]?.type==='cartouche'?selected[0]:null;}
$('cartouche-orientation').onchange=e=>{const item=selectedCartoucheObject();
 if(item)apply({op:'set_cartouche_orientation',id:item.id,orientation:e.target.value});};
$('cartouche-save').onclick=()=>{const item=selectedCartoucheObject();if(!item)return;
 const value=$('cartouche-words').value.trim();
 const parts=value?value.split(/\s+/u):[];
 const allowed=/^[\u{13000}-\u{1342F}]+$/u;
 if(parts.length>48||parts.some(s=>!allowed.test(s))){status('Cartouche accepts up to 48 hieroglyphic words',true);return;}
 apply({op:'set_cartouche_words',id:item.id,words:parts.map(s=>Array.from(s))});
};
$('cartouche-keyboard').onclick=()=>{if(selectedCartoucheObject()&&activePanel!=='keyboard')switchPanel('keyboard');};
$('insert-table').onclick=()=>beginInsertSheet('table');
function selectedTable(){
 const table=selectedItems();return table.length===1&&table[0]?.type==='table'?table[0]:null;
}
function selectTableCell(tableId,row,column){
 selectedTableCell={tableId,row,column};
 selectWord(tableId);
 updateFormatState();
 for(const box of $('pages').querySelectorAll('.table-cell-view')){
  const parent=box.closest('.table-object');
  box.classList.toggle('active',parent?.dataset.id===tableId&&
   Number(box.dataset.row)===row&&Number(box.dataset.column)===column);
 }
}
function tableCellText(entry){
 return entry.mode==='formula'?entry.formula:
  (entry.items||[]).map(w=>(w.signs||[]).join('')).join(' ');
}
function renderTableControls(table){
 const controls=$('table-controls');controls.hidden=!table;
 if(!table)return;
 const rows=table.rows.length,cols=table.rows[0].length;
 $('table-dimensions').textContent=`${rows} × ${cols}`;
 $('table-width').value=table.width_mm??'';
 if(!selectedTableCell||selectedTableCell.tableId!==table.id||
     selectedTableCell.row>=rows||selectedTableCell.column>=cols)
  selectedTableCell={tableId:table.id,row:0,column:0};
 const grid=$('table-grid-editor');grid.replaceChildren();
 grid.style.gridTemplateColumns=`repeat(${cols},minmax(0,1fr))`;
 for(let row=0;row<rows;row++)for(let column=0;column<cols;column++){
  const entry=table.rows[row][column];
  const button=document.createElement('button');button.type='button';
  const ref=String.fromCharCode(65+column)+(row+1);
  button.textContent=ref+' '+tableCellText(entry);
  button.setAttribute('aria-label','Edit '+ref);button.title=ref;
  const current=selectedTableCell.row===row&&selectedTableCell.column===column;
  button.classList.toggle('current',current);
  button.onclick=()=>selectTableCell(table.id,row,column);
  grid.append(button);
 }
 const {row,column}=selectedTableCell;
 // Avoid destroying in-progress input on format refresh for the SAME cell.
 const input=$('table-cell-value');const key=`${table.id}:${row}:${column}:${doc?.revision??''}`;
 if(input.dataset.cellKey!==key){input.value=tableCellText(table.rows[row][column]);input.dataset.cellKey=key;}
 $('table-row-delete').disabled=rows===1;
 $('table-column-delete').disabled=cols===1;
}
$('table-cell-keyboard').onclick=()=>{if(selectedTable()){renderComposer();if(activePanel!=='keyboard')switchPanel('keyboard');}};
$('table-cell-save').onclick=async()=>{
 const table=selectedTable();if(!table)return;
 const loc=selectedTableCell;if(!loc)return;
 const raw=$('table-cell-value').value.trim();
 const action={op:'set_table_cell',id:table.id,row:loc.row,column:loc.column};
 if(raw.startsWith('=')){action.mode='formula';action.formula=raw;}
 else{
  action.mode='text';action.words=raw?raw.split(/\s+/u).map(s=>Array.from(s)):[];
  if(action.words.some(word=>word.some(c=>!(c.codePointAt(0)>=0x13000&&c.codePointAt(0)<=0x1342f)))){
   status('Only hieroglyphic Unicode words are supported in table cells',true);return;
  }
 }
 await apply(action);
};
for(const [control,op,axis] of [
 ['table-row-add','table_insert_row','row'],['table-row-delete','table_delete_row','row'],
 ['table-column-add','table_insert_column','column'],['table-column-delete','table_delete_column','column']]){
 $(control).onclick=()=>{
  const table=selectedTable();if(!table)return;
  const loc=selectedTableCell||{row:0,column:0};
  const index=axis==='row'?loc.row:loc.column;
  apply({op,id:table.id,index:op.includes('insert')?index+1:index});
 };
}
$('table-width').onchange=e=>{
 const table=selectedTable();if(!table)return;
 const v=e.target.value.trim();
 apply({op:'set_table_width',id:table.id,width_mm:v===''?null:Number(v)});
};
$('insert-image').onclick=()=>beginInsertSheet('image');
for(const [control,field] of [['nested-horizontal','x_align'],['nested-vertical','y_align']]){
 $(control).onchange=e=>{
  const obj=selectedItems();const item=obj.length===1&&['table','cartouche'].includes(obj[0]?.type)?obj[0]:null;
  if(!item)return;
  const percent=Number(e.target.value);
  if(e.target.value.trim()===''||!Number.isFinite(percent)||percent<0||percent>100){updateFormatState();return;}
  apply({op:'set_nested_position',id:item.id,[field]:percent/100});
 };
}
$('nested-float').onchange=e=>{
 const obj=selectedItems();const item=obj.length===1&&['table','cartouche'].includes(obj[0]?.type)?obj[0]:null;
 if(!item)return;
 const mm=Number(e.target.value);
 if(e.target.value.trim()===''||!Number.isFinite(mm)||mm< -2000||mm>2000){updateFormatState();return;}
 apply({op:'set_nested_position',id:item.id,x_offset_mm:Math.round(mm*10)/10});
};
$('clipart-width').onchange=e=>{
 const item=selectedItems().length===1?selectedItems()[0]:null;
 if(item?.type==='clipart'||item?.type==='image')apply({op:item.type==='image'?'set_image':'set_clipart',id:item.id,width_mm:Number(e.target.value)});
};
$('clipart-flip').onchange=e=>{
 const item=selectedItems().length===1?selectedItems()[0]:null;
 if(item?.type==='clipart'||item?.type==='image')apply({op:item.type==='image'?'set_image':'set_clipart',id:item.id,flip:e.target.value});
};
for(const [element,property] of [['clipart-horizontal','x_align'],['clipart-vertical','y_align']]){
 $(element).onchange=e=>{
  const item=selectedItems().length===1?selectedItems()[0]:null;
  if((item?.type==='clipart'||item?.type==='image')&&e.target.value.trim()!==''){
   const percentage=Number(e.target.value);
   if(Number.isFinite(percentage)&&percentage>=0&&percentage<=100)
    apply({op:item.type==='image'?'set_image':'set_clipart',id:item.id,[property]:percentage/100,
      ...(property==='x_align'?{x_offset_mm:0}:{})});
   else updateFormatState();
  }
 };
}
$('clipart-float').onchange=e=>{
 const item=selectedItems().length===1?selectedItems()[0]:null;
 if((item?.type==='clipart'||item?.type==='image')&&e.target.value.trim()!==''){
  const mm=Number(e.target.value);
  if(Number.isFinite(mm)&&mm>=-2000&&mm<=2000)
   apply({op:item.type==='image'?'set_image':'set_clipart',id:item.id,x_offset_mm:Math.round(mm*10)/10});
  else updateFormatState();
 }
};
// Hit-test already-computed layout geometry. This is interaction mapping, not
// quadrat composition or visual-page layout. The Python engine owns the result.
function clipartDropIndex(page,clientX,clientY,excludeId){
 let targetPage=page;
 for(const slot of pageSlots){
  const candidate=slot.page, surface=slot.shell.querySelector('.paper');
  if(!candidate||!surface)continue;
  const r=surface.getBoundingClientRect();
  if(clientX>=r.left&&clientX<=r.right&&clientY>=r.top&&clientY<=r.bottom){
   targetPage=candidate;break;
  }
 }
 const paper=pageSlots[targetPage.index]?.shell.querySelector('.paper');
 if(!paper)return null;
 const bounds=paper.getBoundingClientRect();
 const x=(clientX-bounds.left)/(pxmm*zoom),y=(clientY-bounds.top)/(pxmm*zoom);
 const candidates=[];
 for(const col of targetPage.columns)for(const pos of col.placements){
  if(pos.id===excludeId)continue;
  const idx=itemIndexById.get(pos.id);
  if(idx===undefined)continue;
  const dx=x-Math.max(col.x,Math.min(x,col.x+col.width));
  const dy=y-Math.max(pos.y,Math.min(y,pos.y+pos.height));
  const gap=idx+(y>=pos.y+pos.height/2?1:0);
  candidates.push({gap,score:dx*dx*5+dy*dy});
 }
 candidates.sort((a,b)=>a.score-b.score||a.gap-b.gap);
 return {gap:candidates.length?candidates[0].gap:null,page:targetPage,paper};
}
function beginNestedDrag(e,placement,column,page,node){
 if(e.button!==0 || e.target.closest('.table-cell-view'))return;
 e.stopPropagation();
 const original=objectById(placement.id);
 if(!original)return;
 const source=itemIndexById.get(placement.id);
 const startX=e.clientX,startY=e.clientY;
 let moved=false,lastX=startX,lastY=startY;
 const onMove=event=>{
  if(event.pointerId!==e.pointerId)return;
  lastX=event.clientX;lastY=event.clientY;
  if(!moved&&Math.hypot(lastX-startX,lastY-startY)<6)return;
  moved=true;suppressWordClick=true;suppressPaperClick=true;
  node.classList.add('drag-preview');
  node.style.transform=`translate(${(lastX-startX)/zoom}px,${(lastY-startY)/zoom}px)`;
 };
 const cleanup=()=>{
  window.removeEventListener('pointermove',onMove);
  window.removeEventListener('pointerup',onUp);
  window.removeEventListener('pointercancel',onCancel);
  node.style.transform='';node.classList.remove('drag-preview');
  if(moved)setTimeout(()=>{suppressWordClick=false;suppressPaperClick=false;},0);
 };
 const onCancel=()=>cleanup();
 const onUp=event=>{
  if(event.pointerId!==e.pointerId)return;
  cleanup();
  if(!moved){selectWord(placement.id);return;}
  const unit=zoom*pxmm,deltaX=(lastX-startX)/unit,deltaY=(lastY-startY)/unit;
  const hit=clipartDropIndex(page,lastX,lastY,placement.id);
  const dstPage=hit?.page??page;
  let target=source;
  if(dstPage!==page||Math.abs(deltaX)>column.width*.45){
   if(hit?.gap!==null&&hit?.gap!==undefined)
    target=Math.max(0,Math.min(doc.items.length-1,hit.gap-(source<hit.gap?1:0)));
  }
  const margins=doc.margins_mm||{top:18,bottom:18};
  const room=Math.max(0,dstPage.height-margins.top-margins.bottom-placement.height);
  const newTop=Math.max(margins.top,Math.min(dstPage.height-margins.bottom-placement.height,placement.y+deltaY));
  const yAlign=room?Math.max(0,Math.min(1,(newTop-margins.top)/room)):0;
  const horizontalRoom=Math.max(0,column.width-placement.width_mm);
  const inDirection=doc.direction==='rtl'?-deltaX:deltaX;
  const xOffset=Math.max(-2000,Math.min(2000,(original.x_offset_mm||0)+inDirection));
  const xAlign=horizontalRoom?Math.max(0,Math.min(1,(placement.x+deltaX-column.x)/horizontalRoom)):0;
  selectWord(placement.id);
  apply({op:'relocate_nested',id:placement.id,index:target,
    x_offset_mm:Math.round(xOffset*10)/10,
    x_align:Math.round(xAlign*10000)/10000,y_align:Math.round(yAlign*10000)/10000});
 };
 window.addEventListener('pointermove',onMove);
 window.addEventListener('pointerup',onUp);
 window.addEventListener('pointercancel',onCancel);
}

function beginClipartDrag(e,placement,column,page,node){
 if(e.button!==0||e.target.closest('.art-resize'))return;
 // Touch devices share the same pointer workflow; a tap still selects.
 e.stopPropagation();
 const original=doc?.items.find(item=>item.id===placement.id);
 if(!original)return;
 const initialIndex=itemIndexById.get(placement.id);
 const startX=e.clientX,startY=e.clientY,unit=zoom*pxmm;
 let moved=false,lastX=startX,lastY=startY;
 const move=ev=>{
  if(ev.pointerId!==e.pointerId)return;
  lastX=ev.clientX;lastY=ev.clientY;
  if(!moved&&Math.hypot(lastX-startX,lastY-startY)<6)return;
  moved=true;suppressWordClick=true;suppressPaperClick=true;
  node.classList.add('drag-preview');
  node.style.transform=`translate(${(lastX-startX)/zoom}px,${(lastY-startY)/zoom}px)`;
 };
 const cleanup=()=>{
  window.removeEventListener('pointermove',move);
  window.removeEventListener('pointerup',done);
  window.removeEventListener('pointercancel',cancel);
  node.classList.remove('drag-preview');node.style.transform='';
  if(moved)setTimeout(()=>{suppressWordClick=false;suppressPaperClick=false;},0);
 };
 const cancel=()=>cleanup();
 const done=ev=>{
  if(ev.pointerId!==e.pointerId)return;
  cleanup();
  if(!moved){selectWord(placement.id);return;}
  const dx=(lastX-startX)/unit,dy=(lastY-startY)/unit;
  const target=clipartDropIndex(page,lastX,lastY,placement.id);
  const newPage=target?.page??page;
  const margins=doc.margins_mm||{top:18,bottom:18};
   const yRoom=Math.max(0,newPage.height-margins.top-margins.bottom-placement.height);
  const initialTop=node.getBoundingClientRect().top;
  // Node preview has been cleared; preserve the original pointer grab offset.
  const grabY=(startY-initialTop)/(unit);
  const destinationRect=target?.paper.getBoundingClientRect();
  const proposedTop=destinationRect?(lastY-destinationRect.top)/unit-grabY:placement.y+dy;
  const yAlign=yRoom?Math.max(0,Math.min(1,(proposedTop-margins.top)/yRoom)):0.5;
  // A float's horizontal position is a millimetre offset *forward in
  // reading order* from its document anchor, not an absolute page pixel.
  // Python reserves the crossed slots, then flows words through every safe
  // silhouette sector in those slots and derives the final position.
  const desiredX=placement.x+dx;
  const rawOffset=doc.direction==='rtl'
    ?column.x+column.width-desiredX-placement.width_mm
    :desiredX-column.x;
  const maximalOffset=newPage===page
    ?(doc.surface==='papyrus'?2000:Math.max(0,page.width-(doc.margins_mm?.left??18)-(doc.margins_mm?.right??18)-placement.width_mm))
    :0;
  // Negative values move the art back over preceding text columns; Python
  // alone reflows those columns, preserving logical object order.
  let xOffset=Math.round(Math.max(-2000,Math.min(2000,maximalOffset,rawOffset))*10)/10;
  let index=initialIndex;
  // Moving before the current anchor or crossing pages requires a logical
  // relocation. Floating forward inside a page never reorders document items.
  if(newPage!==page){
   if(target?.gap!==null&&target?.gap!==undefined)
    index=Math.max(0,Math.min(doc.items.length-1,
      target.gap-(initialIndex<target.gap?1:0)));
   xOffset=0;
  }
  selectWord(placement.id);
  apply({op:original.type==='image'?'relocate_image':'relocate_clipart',id:placement.id,index,
         x_offset_mm:xOffset,y_align:Math.round(yAlign*10000)/10000});
 };
 window.addEventListener('pointermove',move);
 window.addEventListener('pointerup',done);
 window.addEventListener('pointercancel',cancel);
}

function beginClipartResize(e,item,node,edge){
 if(e.button!==0)return;
 e.preventDefault();e.stopPropagation();suppressPaperClick=true;suppressWordClick=true;
 selectWord(item.id);
 const original=objectById(item.id);
 if(!original)return;
 const startX=e.clientX,startY=e.clientY;
 const ratio=item.width_mm/item.height;
 const unit=zoom*pxmm;
 let width=original.width_mm;
 const track=ev=>{
  const dx=(ev.clientX-startX)/unit*(edge.includes('left')?-1:edge.includes('right')?1:0);
  const dy=(ev.clientY-startY)/unit*ratio*(edge.includes('top')?-1:edge.includes('bottom')?1:0);
  const delta=Math.abs(dx)>=Math.abs(dy)?dx:dy;
  width=Math.min(300,Math.max(6,Math.round((original.width_mm+delta)*10)/10));
  node.style.outline='2px dashed #bb9150';
  node.title='Width: '+width+' mm';
 };
 const done=()=>{
  window.removeEventListener('pointermove',track);
  window.removeEventListener('pointerup',done);
  window.removeEventListener('pointercancel',cancel);
  if(width!==original.width_mm)apply({op:original.type==='image'?'set_image':'set_clipart',id:item.id,width_mm:width});
  node.style.outline='';node.title='';
  setTimeout(()=>{suppressPaperClick=false;suppressWordClick=false;},0);
 };
 const cancel=()=>{window.removeEventListener('pointermove',track);
  window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',cancel);
  node.style.outline='';suppressPaperClick=false;suppressWordClick=false;};
 window.addEventListener('pointermove',track);
 window.addEventListener('pointerup',done,{once:true});
 window.addEventListener('pointercancel',cancel,{once:true});
}
$('font-decrease').onclick=()=>doc&&apply({op:'set_document',font_size_pt:Math.max(6,Number(doc.font_size_pt)-1)});
$('font-increase').onclick=()=>doc&&apply({op:'set_document',font_size_pt:Math.min(72,Number(doc.font_size_pt)+1)});
$('dir-rtl').onclick=()=>doc&&apply({op:'set_document',direction:'rtl'});
$('dir-ltr').onclick=()=>doc&&apply({op:'set_document',direction:'ltr'});
buildEgyptianPalette($('egyptian-colors'),value=>chooseColour(value));
function refreshColourState(){
 $('color-custom').value=selectedColour;
 if(document.activeElement!==$('color-hex'))$('color-hex').value=selectedColour.toUpperCase();
 $('selected-color-chip').style.setProperty('--chip',selectedColour);
 for(const button of $('egyptian-colors').querySelectorAll('button')){
  button.setAttribute('aria-pressed',String(button.dataset.color===selectedColour));
  const rgb=button.dataset.color.slice(1).match(/../g).map(v=>parseInt(v,16));
  button.style.setProperty('--check',rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>160?'#102d51':'#fff');
 }
 $('color-black').setAttribute('aria-pressed',String(selectedColour==='#192433'));
 $('color-red').setAttribute('aria-pressed',String(selectedColour==='#ac2533'));
}
function chooseColour(value){
 const colour=normalizeColour(value);
 if(!colour||!editableStyleWords().length)return false;
 selectedColour=colour;$('color-hex').removeAttribute('aria-invalid');
 refreshColourState();styleSelected({color:colour});return true;
}
function setColourMode(mode){
 $('egyptian-colors').hidden=mode!=='egyptian';
 $('spectrum-controls').hidden=mode!=='spectrum';
 $('color-egyptian').setAttribute('aria-pressed',String(mode==='egyptian'));
 $('color-spectrum').setAttribute('aria-pressed',String(mode==='spectrum'));
}
$('color-picker').onclick=()=>{
 if($('color-picker').disabled)return;
 setColourMode('egyptian');setFormatView('colors');refreshColourState();
 $('color-back').focus({preventScroll:true});
};
$('color-back').onclick=()=>{setFormatView('main');$('color-picker').focus({preventScroll:true});};
$('color-close').onclick=()=>{closePanels();$('format-toggle').focus({preventScroll:true});};
$('color-egyptian').onclick=()=>setColourMode('egyptian');
$('color-spectrum').onclick=()=>setColourMode('spectrum');
$('color-custom').oninput=e=>chooseColour(e.target.value);
$('color-hex').onchange=e=>{
 const value=normalizeColour(e.target.value);
 if(!value){e.target.setAttribute('aria-invalid','true');return;}
 chooseColour(value);e.target.value=value.toUpperCase();
};
$('color-hex').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}});
function status(text,error=false){
 $('state').textContent=text;
 $('state').style.color=error?'#a72828':'#406c68';
 $('library-state').textContent=text;
 $('library-state').classList.toggle('error',error);
}
function showLibraryError(message=''){
 const el=$('library-error');el.hidden=!message;el.textContent=message;
}
function showLibrary(){
 ++layoutVersion;queuedLayout=null;repairedDetailRevisions.clear();libraryScreen.hidden=false;editorScreen.hidden=true;
 releaseLayoutWorker();
 for(const job of layoutPending.values())job.reject(new Error('Editor closed'));
 layoutPending.clear();
 $('export-unsaved').hidden=true;
 selectedId=null;selectionAnchorId=null;selectionFocusId=null;selectedTableCell=null;editingId=null;buffer=[];doc=null;caretIndex=0;layoutCache=null;canUndo=false;canRedo=false;updateHistoryState();
 clearPageVirtualization();$('pages').replaceChildren();closePanels();showLibraryError();
 document.title='MdwNfr — Documents';
}
function showEditor(){
 libraryScreen.hidden=true;editorScreen.hidden=false;closePanels();
 document.title='MdwNfr — '+doc.name;
}
function setLibraryBusy(value){
 libraryBusy=value;$('create-document').disabled=value||!ready;
 for(const btn of document.querySelectorAll('.document-grid button')){
  const needsEngine=btn.classList.contains('document-open')||btn.classList.contains('rename-action');
  btn.disabled=value||(needsEngine&&!ready);
 }
}

worker.onmessage=async ev=>{
 const m=ev.data;
 if(m.type==='fatal'){ready=false;setLibraryBusy(true);showLibraryError('Python runtime could not start: '+m.error);status('Python runtime unavailable',true);return;}
 if(m.type==='ready') {ready=true;status('Python '+m.python+' · Ready');setLibraryBusy(false);await initialize();return;}
 if(m.id!==undefined&&pending.has(m.id)) {const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.ok?resolve(m):reject(new Error(m.error));}
};
worker.onerror=e=>{ready=false;setLibraryBusy(true);showLibraryError('Python runtime error: '+e.message);status('Python runtime unavailable',true);};
function handleLayoutMessage(ev){
 const m=ev.data;
 if(m.type==='ready')return;
 if(m.type==='fatal'){handleLayoutError({message:m.error});return;}
 if(m.id!==undefined&&layoutPending.has(m.id)){
  const {resolve,reject}=layoutPending.get(m.id);layoutPending.delete(m.id);
  if(m.ok)resolve(m);
  else{const err=new Error(m.error);err.code=m.type;reject(err);}
  scheduleLayoutIdle();
 }
};
function handleLayoutError(e){
 status('Layout worker error: '+e.message,true);
 for(const {reject} of layoutPending.values())reject(new Error(e.message));
 layoutPending.clear();
 releaseLayoutWorker();
 if(doc&&!editorScreen.hidden&&++layoutRestarts<=2)void reflow();
}
function layoutRpc(method,payload){
 if(layoutIdleTimer!==null){clearTimeout(layoutIdleTimer);layoutIdleTimer=null;}
 return new Promise((resolve,reject)=>{
  const id=++nextLayoutReq;layoutPending.set(id,{resolve,reject});
  getLayoutWorker().postMessage({id,method,payload});
 });
}
function recordLayoutReceipt(outcome,documentId){
 if(!doc||doc.id!==documentId||outcome.document_id!==documentId)return;
 layoutSyncedId=documentId;
 layoutSyncedRevision=outcome.revision;
 layoutDeltas=layoutDeltas.filter(patch=>patch.document_id===documentId&&
                                        patch.revision>outcome.revision);
}
function requiredLayoutDeltas(documentId,revision){
 if(layoutSyncedId!==documentId||layoutSyncedRevision===null)return null;
 let next=layoutSyncedRevision;
 const batch=[];
 for(const patch of layoutDeltas){
  if(patch.document_id!==documentId || patch.revision<=next)continue;
  if(patch.base_revision!==next)return null;
  batch.push(patch);next=patch.revision;
 }
 return next===revision?batch:null;
}
async function sendLayoutRequest(snapshot){
 const id=snapshot.id;
 const batch=requiredLayoutDeltas(id,snapshot.revision);
 if(batch===null){
  // First open, worker restart or missing revision: resynchronize once.
  const opened=await layoutRpc('layout_open',{document:snapshot,summary_only:true});
  recordLayoutReceipt(opened,id);return opened;
 }
 try{
  const result=await layoutRpc('layout_sync',{
   document_id:id,base_revision:layoutSyncedRevision,changes:batch,summary_only:true});
  recordLayoutReceipt(result,id);return result;
 }catch(error){
  if(error.code!=='LayoutRevisionConflict')throw error;
  // Revision gap is a recoverable transport failure, not a user edit.
  const opened=await layoutRpc('layout_open',{document:snapshot,summary_only:true});
  recordLayoutReceipt(opened,id);return opened;
 }
}
function rpc(method,payload={}){
 if(!ready) return Promise.reject(new Error('Python core not ready'));
 return new Promise((resolve,reject)=>{const id=++nextReq;pending.set(id,{resolve,reject});worker.postMessage({id,method,payload});});
}
worker.postMessage({id:0,method:'boot'});
function setUiFromDoc(){
 logicalIndexById=new Map(doc.items.map((item,index)=>[item.id,index]));
 $('docname').value=doc.name;$('direction').value=doc.direction;
 const oldFacing=$('editor-screen').dataset.writingDirection;
 $('editor-screen').dataset.writingDirection=doc.direction;
 if(oldFacing&&oldFacing!==doc.direction){drawKeys();renderComposer();}
 $('surface').value=doc.surface;$('font-size').value=doc.font_size_pt;
 $('papyrus-height').value=doc.papyrus_height_mm;
 const papyrus=doc.surface==='papyrus';
 const margins=doc.margins_mm||{top:18,bottom:18,left:18,right:18};
 for(const edge of ['top','bottom','left','right'])$('margin-'+edge).value=margins[edge];
 $('papyrus-margin').value=margins.left;
 $('paper-margin-title').hidden=papyrus;
 $('paper-margin-controls').hidden=papyrus;
 $('papyrus-margin-group').hidden=!papyrus;
 $('papyrus-group').hidden=!papyrus;
 $('wordcount').textContent=doc.items.reduce((total,item)=>total+(
  item.type==='word'?1:
  item.type==='table'?item.rows.reduce((sum,row)=>sum+row.reduce((n,cell)=>n+(cell.mode==='text'?cell.items.length:0),0),0):
  item.type==='cartouche'?item.items.length:0),0)+' words';
 $('revision').textContent='Revision '+doc.revision;
 updateFormatState();
}
async function initialize(){
 try {
  writingProfile={...emptyProfile(),...(await loadProfile()||{})};
  if(!Array.isArray(writingProfile.personal_entries)) writingProfile.personal_entries=[];
  // Keyboard prediction loads lazily in its dedicated, independent API worker.
  lexiconMeta=null;
  // The independent keyboard API validates its pinned lexicon lazily.
  const notice=$('lexicon-notice');
  notice.hidden=true;
  notice.textContent='';
  // No implicit 'Untitled' document, and no last-document auto-open.
  await renderDocList();
 }catch(e){showLibraryError('Unable to load the documents library: '+e.message);status(String(e.message),true);}
}
async function openDocument(id){
 if(libraryBusy||!ready)return;
 setLibraryBusy(true);showLibraryError();
 try{
  const entry=await load(id);
  if(entry?.items?.some(item=>item.type==='clipart'))await ensureArtworkCatalog();
  if(!entry)throw new Error('Document not found. It may have been deleted.');
  await rpc('session_open',{document:entry});
  resetLayoutSynchronization();repairedDetailRevisions.clear();doc=entry;
  persistedDocumentId=entry.id;persistedRevision=entry.revision;selectedTableCell=null;selectedId=null;selectionAnchorId=null;selectionFocusId=null;editingId=null;buffer=[];canUndo=false;canRedo=false;layoutCache=null;
  caretIndex=doc.items.length;
  showEditor();refreshZoomOptions();setUiFromDoc();drawKeys();renderComposer();
  await reflow();
 }catch(e){
  showLibrary();showLibraryError('Unable to open document: '+e.message);
  status('Could not open document',true);
 }finally{setLibraryBusy(false);}
}
async function backToLibrary(){
 // Pending edits must be saved before leaving the editor.
 await txQueue;
 try{await flushAutosave();}catch(e){
  status('Save failed: '+e.message,true);
  const choice=await modal({title:'Unsaved document',
   description:'The document could not be saved. Download a separate copy of your edits before reopening. The editor will remain open.',
   action:'Download unsaved copy'});
  if(choice.confirmed)try{downloadUnsavedDocumentCopy();}
  catch(error){status('Backup failed: '+error.message,true);}
  return;
 }
 await profileSaveQueue.catch(()=>{});
 showLibrary();
 try{await renderDocList();}catch(e){showLibraryError('Could not load documents: '+e.message);}
}
async function createDocument(){
 if(libraryBusy||!ready)return;
 setLibraryBusy(true);showLibraryError();
 try{
  const names=new Set((await list()).map(d=>d.name));
  let name='Untitled';
  for(let i=2;names.has(name);i++)name='Untitled '+i;
  const entry=(await rpc('new',{name})).document;
  await save(entry,null);
  setLibraryBusy(false);
  await openDocument(entry.id);
 }catch(e){showLibraryError('Could not create document: '+e.message);status('Could not create document',true);setLibraryBusy(false);}
}
function finishDocumentChange(updated){
 doc=updated;
 if(selectionAnchorId&&!doc.items.some(i=>i.id===selectionAnchorId))selectionAnchorId=null;
 if(selectionFocusId&&!doc.items.some(i=>i.id===selectionFocusId))selectionFocusId=null;
 selectedId=selectionAnchorId&&selectionAnchorId===selectionFocusId?selectionAnchorId:null;
 if(editingId&&!doc.items.some(i=>i.id===editingId)){editingId=null;buffer=[];renderComposer();}
 caretIndex=Math.max(0,Math.min(caretIndex,doc.items.length));
 setUiFromDoc();
}
// The browser maintains only a read-only *mirror* of the Python session.
// Deltas below are canonical results returned by Python; no edit policy lives here.
function receiveSessionResult(answer){
 if(!doc || answer.document_id!==doc.id || answer.revision!==doc.revision+1)
  throw new Error('Document session out of sync; reopen the document');
 const change=answer.change;
 const previousRevision=doc.revision;
 const items=doc.items.slice();
 let properties={};
 if(change.kind==='splice'){
  // Never spread a 100,000-element paste into splice(...args): browser argument
  // counts are limited and may throw RangeError. Use concatenated slices.
  if(!Number.isInteger(change.index)||change.index<0||change.index+change.delete_count>items.length)
   throw new Error('Invalid document delta');
  const nextItems=items.slice(0,change.index).concat(change.objects,items.slice(change.index+change.delete_count));
  doc={...doc,items:nextItems,revision:answer.revision};
 }else if(change.kind==='update'){
  for(const entry of change.updates){
   if(!items[entry.index] || items[entry.index].id!==entry.object.id)
    throw new Error('Invalid word identity in document delta');
   items[entry.index]=entry.object;
  }
  doc={...doc,items,revision:answer.revision};
 }else if(change.kind==='relocate'){
  if(items[change.from_index]?.id!==change.object_id || change.object?.id!==change.object_id)
   throw new Error('Invalid relocation identity');
  items.splice(change.from_index,1);items.splice(change.to_index,0,change.object);
  doc={...doc,items,revision:answer.revision};
 }else if(change.kind==='move'){
  if(items[change.from_index]?.id!==change.object_id)throw new Error('Invalid move identity');
  const moved=items.splice(change.from_index,1)[0];
  items.splice(change.to_index,0,moved);
  doc={...doc,items,revision:answer.revision};
 }else if(change.kind==='properties'){
  properties=change.properties;
  doc={...doc,...properties,revision:answer.revision};
 }else throw new Error('Unknown document session delta');
 canUndo=answer.undo_available;canRedo=answer.redo_available;
 updateHistoryState();
 finishDocumentChange(doc);
 // The delta comes from the authoritative Python editing worker. It contains
 // complete canonical records, so layout replay never invents IDs or spellings.
 layoutDeltas.push({document_id:answer.document_id,base_revision:previousRevision,
                    revision:answer.revision,change});
}

// Coalesce rapid edits into one persisted document write. The last completed
// save is awaited when leaving the editor; these are NOT independent versions.
let autosaveTimer=null,autosaveWanted=null,autosaveQueue=Promise.resolve();
// Compare-and-swap token: advanced only after IndexedDB confirms a write.
let persistedDocumentId=null,persistedRevision=null;
function scheduleAutosave(){
 autosaveWanted=doc;
 if(autosaveTimer)clearTimeout(autosaveTimer);
 autosaveTimer=setTimeout(()=>{autosaveTimer=null;flushAutosave().catch(e=>status('Save failed: '+e.message,true));},300);
}
async function flushAutosave(){
 if(autosaveTimer){clearTimeout(autosaveTimer);autosaveTimer=null;}
 const snapshot=autosaveWanted;
 autosaveWanted=null;
 if(snapshot){
  const job=autosaveQueue.catch(()=>{}).then(async()=>{
   if(persistedDocumentId!==snapshot.id||persistedRevision===null)
    throw new Error('Save target changed; reopen the document');
   await save(snapshot,persistedRevision);
   persistedRevision=snapshot.revision;
  });
  autosaveQueue=job;
 }
 try{await autosaveQueue;
  if(snapshot&&doc&&doc.id===snapshot.id&&doc.revision===snapshot.revision){
   $('export-unsaved').hidden=true;
   status('Revision '+snapshot.revision+' · Saved locally');
  }
 }catch(error){
  if(snapshot && (!autosaveWanted||autosaveWanted.revision<snapshot.revision))autosaveWanted=snapshot;
  $('export-unsaved').hidden=false;
  throw error;
 }
 if(autosaveWanted)return flushAutosave();
}
function apply(action){
 const task=txQueue.then(async()=>{
  if(!doc)return false;
  try{
   const answer=await rpc('session_edit',{action:{...action,base_revision:doc.revision}});
   receiveSessionResult(answer);
   
   scheduleAutosave();reflow();return true;
  }catch(e){status('Edit failed: '+e.message,true);return false;}
 });
 txQueue=task.then(()=>undefined,()=>undefined);
 return task;
}
function replayHistory(kind){
 const task=txQueue.then(async()=>{
  if(!doc || !(kind==='undo'?canUndo:canRedo))return false;
  try{
   const answer=await rpc('session_history',{direction:kind});
   receiveSessionResult(answer);
   // Previous styles/signs may be restored during undo; the layout worker
   // measures any newly present signs when preparing the next snapshot.
   
   scheduleAutosave();reflow();return true;
  }catch(e){status((kind==='undo'?'Undo':'Redo')+' failed: '+e.message,true);return false;}
 });
 txQueue=task.then(()=>undefined,()=>undefined);
 return task;
}
// Document commands never override native text editing in titles, values, or dialogs.
function editingField(target){
 return target instanceof Element&&Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'));
}
document.addEventListener('keydown',e=>{
 if(editorScreen.hidden||!doc||e.isComposing||e.altKey||editingField(e.target))return;
 const mod=e.ctrlKey||e.metaKey;
 const code=e.code||'';
 if(!mod&&!e.shiftKey&&['Delete','Backspace'].includes(code||e.key)&&selectedItems().length){
  e.preventDefault();hideEditMenu();deleteSelection();return;
 }
 if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){
  e.preventDefault();const node=$('pages').querySelector('.selected')||$('pages').querySelector('.paper');
  if(node){const r=node.getBoundingClientRect();showEditMenu(r.left+r.width/2,r.top,node,true);}return;
 }
 if(!mod||e.shiftKey&&!['KeyZ'].includes(code))return;
 const key=(code.startsWith('Key')?code.slice(3):e.key).toLowerCase();
 const action={a:selectAll,c:copySelection,x:cutSelection,v:pasteSelection};
 if(action[key]){e.preventDefault();hideEditMenu();action[key]();}
 else if(key==='z'||key==='y'){
  e.preventDefault();hideEditMenu();replayHistory(key==='y'||e.shiftKey?'redo':'undo');
 }
});
for(const [kind,action] of [['copy',copySelection],['cut',cutSelection],['paste',pasteSelection]]){
 document.addEventListener(kind,e=>{
  if(editorScreen.hidden||!doc||editingField(e.target)||kind!=='paste'&&!selectedItems().length)return;
  hideEditMenu();action(e);
 });
}
$('undo').onclick=()=>replayHistory('undo');
$('redo').onclick=()=>replayHistory('redo');
// Only one geometry calculation is queued at a time. Edits stay on the
// independent document worker and new revisions replace obsolete queued jobs.
// The renderer never sees a half-computed layout.
function reflow(){
 if(!doc || editorScreen.hidden)return Promise.resolve();
 const request={version:++layoutVersion,snapshot:doc};
 queuedLayout=request;
 return pumpLayoutQueue();
}
async function pumpLayoutQueue(){
 if(layoutInFlight)return;
 layoutInFlight=true;
 try{
  while(queuedLayout){
   const {version,snapshot}=queuedLayout;queuedLayout=null;
   try{
    const outcome=await sendLayoutRequest(snapshot);
    if(version!==layoutVersion||!doc||snapshot.id!==doc.id||
       snapshot.revision!==doc.revision||editorScreen.hidden)continue;
    layoutCache=outcome.layout;paint(outcome.layout);layoutRestarts=0;
    status(outcome.layout.warnings.length?'Layout warning: '+outcome.layout.warnings[0]:
           'Revision '+doc.revision+' · Saving locally…',outcome.layout.warnings.length>0);
   }catch(e){
    if(version===layoutVersion)status('Layout: '+e.message,true);
   }
  }
 }finally{layoutInFlight=false;}
}
function repaintCurrentLayout(){
 // A zoom/resize while reflow is pending must preserve the last coherent
 // painted pages; rebuilding them from a superseded summary would blank them.
 if(layoutCache && doc && layoutCache.document_id===doc.id &&
    layoutCache.revision===doc.revision)paint(layoutCache);
}
function mm(v){return v*pxmm+'px';}
function resolveZoom(layout){
 const first=layout.pages?.[0];
 if(!first)return 1;
 if(!['fit-page','fit-width','fit-height'].includes(zoomChoice))return Number(zoomChoice)||1;
 const viewport=$('canvas-area');
 const availableWidth=Math.max(100,viewport.clientWidth-82);
 const availableHeight=Math.max(100,viewport.clientHeight-72);
 if(zoomChoice==='fit-width')return Math.min(2,availableWidth/(first.width*pxmm));
 if(zoomChoice==='fit-height')return Math.min(2,availableHeight/(first.height*pxmm));
 return Math.min(2,availableWidth/(first.width*pxmm),availableHeight/(first.height*pxmm));
}
function refreshZoomOptions(){
 const selector=$('zoom');
 const options=doc?.surface==='papyrus'
 ?[['fit-height','Fit Height'],['1','100%'],['1.5','150%'],['2','200%']]
 :[['fit-page','Fit Page'],['fit-width','Fit Page Width'],['1','100%'],['1.5','150%'],['2','200%']];
 selector.replaceChildren();for(const [value,label] of options){const opt=document.createElement('option');opt.value=value;opt.textContent=label;selector.append(opt);}
 if(!options.some(([value])=>value===zoomChoice))zoomChoice=options[0][0];
 selector.value=zoomChoice;
}
function paint(layout){
 zoom=resolveZoom(layout);
 clearPageVirtualization();
 const root=$('pages');
 // Preserve the editor viewport rather than jumping to document start on reflow.
 const scrollArea=$('canvas-area');
 const previousTop=scrollArea.scrollTop,previousLeft=scrollArea.scrollLeft;
 root.replaceChildren();
 itemIndexById=new Map(doc.items.map((item,index)=>[item.id,index]));
 const fragment=document.createDocumentFragment();
 for(const p of layout.pages){
  const shell=document.createElement('div');shell.className='page-shell';
  shell.dataset.pageIndex=String(p.index);
  shell.style.width=mm(p.width*zoom);shell.style.height=mm(p.height*zoom);
  pageSlots.push({summary:p,page:null,shell,pending:null,lastUsed:0});fragment.append(shell);
 }
 root.append(fragment);
 if(!('IntersectionObserver' in window)){
  // Old browsers use a bounded visible-range scroll check.
  const checkVisible=()=>{
   const viewport=scrollArea.getBoundingClientRect();
   for(let i=0;i<pageSlots.length;i++){
    const bounds=pageSlots[i].shell.getBoundingClientRect();
    if(bounds.bottom>viewport.top-400&&bounds.top<viewport.bottom+400)renderPageDetails(i);
    else if(pageSlots[i].page)unloadPageDetails(i);
   }
  };
  scrollArea.onscroll=checkVisible;
  queueMicrotask(checkVisible);
 }else{
  pageObserver=new IntersectionObserver(entries=>{
   if(editorScreen.hidden)return;
   for(const entry of entries){
    const index=Number(entry.target.dataset.pageIndex);
    if(entry.isIntersecting)showPageInViewport(index);
    else if(pageSlots[index]?.shell.querySelector('.paper')){
     // Release all glyph DOM for distant pages; their immutable layout remains cached.
     // Discard geometry and DOM together; revisioned worker retains authority.
     unloadPageDetails(index);
    }
   }
  },{root:scrollArea,rootMargin:'600px 600px'});
  for(const {shell} of pageSlots)pageObserver.observe(shell);
  // First page must be usable immediately, before the observer fires.
  renderPageDetails(0);
 }
 scrollArea.scrollTop=previousTop;scrollArea.scrollLeft=previousLeft;
 if(doc?.surface==='papyrus'&&doc.direction==='rtl'&&previousLeft===0&&previousTop===0){
  // The first RTL column is at the right-hand edge of the long papyrus.
  scrollArea.scrollLeft=scrollArea.scrollWidth;
 }
 if(doc?.surface==='papyrus')schedulePapyrusWindow();
 drawInsertionCaret();drawSelectionHandles();renderPagesOverview();
}
// A caret is a gap in the logical object sequence, never a screen coordinate.
// Rendering derives its visible position exclusively from the latest layout.
function drawInsertionCaret(){
 document.querySelectorAll('.insertion-caret').forEach(n=>n.remove());
 if(!doc||!layoutCache||selectedItems().length||editingId)return;
 const target=doc.items[caretIndex]||doc.items.at(-1);
 if(!target)return;
 const location=placementById.get(target.id);
 if(!location)return;
 const {placement,column:col,pageIndex}=location;
 const paper=pageSlots[pageIndex]?.shell.querySelector('.paper');
 if(!paper)return;
 const before=caretIndex<doc.items.length;
 let y=before?placement.y-4:placement.y+placement.height+4;
 if(before&&caretIndex>0){
  const preceding=doc.items[caretIndex-1];
  const inColumn=col.placements.find(it=>it.id===preceding.id);
  if(inColumn)y=(inColumn.y+inColumn.height+placement.y)/2;
 }
 const marker=document.createElement('div');marker.className='insertion-caret';
 marker.style.left=mm(placement.x+col.width*0.10);
 marker.style.top=mm(Math.max(1,y));
 marker.style.width=mm(col.width*.80);
 marker.setAttribute('aria-label','Insertion position '+caretIndex);
 paper.append(marker);
}
function placeCaretFromPoint(e,page){
 if(!doc||!layoutCache)return;
 const rect=e.currentTarget.getBoundingClientRect();
 const x=(e.clientX-rect.left)/(zoom*pxmm);
 const y=(e.clientY-rect.top)/(zoom*pxmm);
 const positions=[];
 for(const col of page.columns){
  const dx=Math.max(0,Math.abs(x-(col.x+col.width/2))-col.width/2);
  for(const placement of col.placements){
   const index=itemIndexById.get(placement.id)??-1;
   if(index<0)continue;
   positions.push({index,dist:dx*dx*6+(y-placement.y)**2});
   positions.push({index:index+1,dist:dx*dx*6+(y-placement.y-placement.height)**2});
  }
 }
 // On a blank page the logical insertion point is simply the document end.
 positions.sort((a,b)=>a.dist-b.dist||a.index-b.index);
 caretIndex=positions.length?positions[0].index:doc.items.length;
 clearSelection();editingId=null;buffer=[];
 updateSelection();renderComposer();
}
function selectedRange(){
 if(!doc||!selectionAnchorId||!selectionFocusId)return null;
 const a=logicalIndexById.get(selectionAnchorId);
 const b=logicalIndexById.get(selectionFocusId);
 return a===undefined||b===undefined?null:{start:Math.min(a,b),end:Math.max(a,b)+1};
}
function selectedItems(){
 const range=selectedRange();return range?doc.items.slice(range.start,range.end):[];
}
function isIndexSelected(index){
 const range=selectedRange();return !!range&&index>=range.start&&index<range.end;
}
function clearSelection(){
 selectedId=null;selectionAnchorId=null;selectionFocusId=null;
}
function selectWord(id,extend=false){
 if(!doc||!logicalIndexById.has(id))return;
 if(!extend||!selectionAnchorId)selectionAnchorId=id;
 selectionFocusId=id;
 selectedId=selectionAnchorId===selectionFocusId?id:null;
 editingId=null;buffer=[];
 const range=selectedRange();caretIndex=range.end;
 updateSelection();renderComposer();
}
function selectAll(){
 if(!doc?.items.length)return;
 selectionAnchorId=doc.items[0].id;selectionFocusId=doc.items.at(-1).id;
 selectedId=doc.items.length===1?selectionAnchorId:null;
 editingId=null;buffer=[];caretIndex=doc.items.length;
 updateSelection();renderComposer();
}
function drawSelectionHandles(){
 const indices=selectedRange();
 if(!indices||!layoutCache){
  document.querySelectorAll('.range-handle').forEach(n=>n.remove());return;
 }
 const limits=[['start',doc.items[indices.start]?.id],['end',doc.items[indices.end-1]?.id]];
 for(const [edge,id] of limits){
  let node=document.querySelector('.range-handle[data-edge="'+edge+'"]');
  const location=placementById.get(id);
  const placement=location?.placement;
  const columnWidth=location?.column.width||0;
  const paper=pageSlots[location?.pageIndex]?.shell.querySelector('.paper');
  if(!paper||!placement){node?.remove();continue;}
  if(!node){
   node=document.createElement('div');node.className='range-handle';node.dataset.edge=edge;
   node.setAttribute('role','slider');node.setAttribute('aria-label',edge==='start'?'Selection start handle':'Selection end handle');
   node.setAttribute('tabindex','0');
   node.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();e.stopPropagation();suppressPaperClick=true;
    const activeEdge=node.dataset.edge;
    const heldRange=selectedRange();
    // Fix the opposite endpoint for the entire gesture, including crossing.
    const fixedId=doc.items[activeEdge==='start'?heldRange.end-1:heldRange.start]?.id;
    function move(event){
     const id=nearestWordToScreenPoint(event.clientX,event.clientY);
     if(!id)return;
     if(activeEdge==='start'){
      selectionAnchorId=fixedId;selectionFocusId=id;
     }else{
      selectionAnchorId=fixedId;selectionFocusId=id;
     }
     selectedId=selectionAnchorId===selectionFocusId?selectionAnchorId:null;
     caretIndex=selectedRange().end;
     updateSelection();
    }
    function done(){window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',done);setTimeout(()=>suppressPaperClick=false,0);}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',done,{once:true});
    window.addEventListener('pointercancel',done,{once:true});
   });
  }
  if(node.parentElement!==paper)paper.append(node);
  node.style.left=mm(placement.x+columnWidth*.08);
  node.style.top=mm(edge==='start'?placement.y:placement.y+placement.height);
 }
}
// Desktop mouse drag extends the logical range; touch uses the two handles.
function beginMouseRangeDrag(e,id){
 if(e.pointerType!=='mouse'||e.button!==0||e.shiftKey)return;
 const startX=e.clientX,startY=e.clientY;
 let dragging=false;
 function move(ev){
  if(!(ev.buttons&1))return;
  if(!dragging&&Math.hypot(ev.clientX-startX,ev.clientY-startY)<7)return;
  if(!dragging){dragging=true;selectWord(id,false);}
  const nearest=nearestWordToScreenPoint(ev.clientX,ev.clientY);
  if(nearest)selectWord(nearest,true);
 }
 function done(){
  window.removeEventListener('pointermove',move);
  window.removeEventListener('pointerup',done);
  window.removeEventListener('pointercancel',done);
  if(dragging){suppressWordClick=true;setTimeout(()=>suppressWordClick=false,0);}
 }
 window.addEventListener('pointermove',move);
 window.addEventListener('pointerup',done,{once:true});
 window.addEventListener('pointercancel',done,{once:true});
}
function nearestWordToScreenPoint(x,y){
 let best=null,bestDist=Infinity;
 for(const node of $('pages').querySelectorAll('.selectable-item')){
  const rect=node.getBoundingClientRect();
  const dx=Math.max(rect.left-x,0,x-rect.right),dy=Math.max(rect.top-y,0,y-rect.bottom);
  const dist=dx*dx+dy*dy;
  if(dist<bestDist){bestDist=dist;best=node.dataset.id;}
 }
 return best;
}
async function copySelection(event=null){
 const items=selectedItems();if(!items.length)return false;
 const plain=items.filter(item=>item.type==='word').map(item=>item.signs.join('')).join(' ');
 const rich=JSON.stringify({format:'mdwnfr-fragment-v1',objects:items});
 internalClipboard={text:plain,objects:items,systemWritten:false};
 if(event?.clipboardData){
  event.clipboardData.setData('text/plain',plain);
  event.clipboardData.setData(RICH_MIME,rich);
  event.preventDefault();internalClipboard.systemWritten=true;
 }else{
  try{
   if(typeof ClipboardItem==='function'&&navigator.clipboard?.write){
    await navigator.clipboard.write([new ClipboardItem({
     'text/plain':new Blob([plain],{type:'text/plain'}),
     [RICH_MIME]:new Blob([rich],{type:RICH_MIME})
    })]);
   }else await navigator.clipboard.writeText(plain);
   internalClipboard.systemWritten=true;
  }catch(_){status('Copied inside MdwNfr; system clipboard unavailable');}
 }
 return true;
}
async function deleteSelection(){
 const range=selectedRange();if(!range)return false;
 const success=await apply({op:'splice',index:range.start,delete_count:range.end-range.start,objects:[]});
 if(success){clearSelection();editingId=null;buffer=[];caretIndex=range.start;updateSelection();renderComposer();}
 return success;
}
async function cutSelection(event=null){
 const identity=doc?.id,revision=doc?.revision;
 const ids=selectedItems().map(item=>item.id).join(',');
 if(!await copySelection(event))return false;
 // Clipboard permission can be asynchronous. Never cut a different selection.
 if(identity!==doc?.id||revision!==doc?.revision||ids!==selectedItems().map(item=>item.id).join(',')){
  status('Selection changed; cut canceled');return false;
 }
 return deleteSelection();
}
async function pasteSelection(event=null){
 if(!doc)return;
 let textValue=event?.clipboardData?.getData('text/plain')??null;
 let richValue=event?.clipboardData?.getData(RICH_MIME)||null;
 // A private MIME type proves rich-fragment provenance; text equality does not.
 let useInternal=false;
 if(event)event.preventDefault();
 if(textValue===null&&internalClipboard&&!internalClipboard.systemWritten){
  textValue=internalClipboard.text;useInternal=true;
 }
 if(textValue===null){
  try{
   if(navigator.clipboard.read){
    for(const item of await navigator.clipboard.read()){
     if(item.types.includes(RICH_MIME)){
      richValue=await (await item.getType(RICH_MIME)).text();break;
     }
    }
   }
   textValue=await navigator.clipboard.readText();
  }catch(_){
   if(internalClipboard){textValue=internalClipboard.text;useInternal=true;}
   else{
    const answer=await modal({title:'Paste',description:'Paste hieroglyphic Unicode from the clipboard.',action:'Paste',initialValue:''});
    if(!answer.confirmed)return false;
    textValue=answer.value;
   }
  }
 }
 let objects=[];
 if(richValue){
  try{
   if(richValue.length>60*1024*1024)throw Error('Fragment too large');
   const fragment=JSON.parse(richValue);
   if(fragment?.format!=='mdwnfr-fragment-v1'||!Array.isArray(fragment.objects))
    throw Error('Invalid MdwNfr fragment');
   objects=fragment.objects;
  }catch(e){status('Invalid rich clipboard fragment: '+e.message,true);return false;}
 }else if(useInternal&&internalClipboard&&textValue===internalClipboard.text){
  objects=internalClipboard.objects;
 }else{
  const tokens=(textValue||'').trim().split(/\s+/u).filter(Boolean);
  if(tokens.length>MAX_ATOMIC_OBJECTS){status('Paste exceeds 150,000-word limit',true);return;}
  objects=tokens.map(token=>({type:'word',signs:[...token],color:'#192433',bold:false,lexicon_ref:null}));
  if(objects.some(item=>item.signs.some(sign=>{
   const cp=sign.codePointAt(0);return !(cp>=0x13000&&cp<=0x1342f);
  }))){status('Paste only accepts hieroglyphic Unicode words',true);return;}
 }
 if(!objects.length)return;
 if(objects.length>MAX_ATOMIC_OBJECTS){status('Paste exceeds 150,000 objects',true);return false;}
 const range=selectedRange();
 const index=range?range.start:caretIndex;
 const count=range?range.end-range.start:0;
 const success=await apply({op:'splice',index,delete_count:count,objects});
 if(success){clearSelection();editingId=null;buffer=[];caretIndex=index+objects.length;updateSelection();renderComposer();}
}
for(const [id,action] of [['copy-selection',copySelection],['cut-selection',cutSelection],['paste-selection',pasteSelection],['select-all',selectAll]]){
 $(id).onclick=()=>{hideEditMenu();action();};
}
// Touch-and-hold and a contextual menu share the canonical clipboard commands.
let touchEditGesture=null,ignoreDocumentClickUntil=0;
function hideEditMenu(){
 $('edit-menu').hidden=true;
}
function showEditMenu(x,y,target,preserveSelection=false){
 if(editorScreen.hidden||!doc)return;
 const item=target?.closest('.selectable-item');
 if(item&&!preserveSelection){
  const index=Number(item.dataset.index);
  if(!isIndexSelected(index))selectWord(item.dataset.id);
 }else if(!item&&!preserveSelection){
  const paper=target?.closest('.paper');
  const slot=paper&&pageSlots.find(entry=>entry.shell.contains(paper));
  if(slot?.page)placeCaretFromPoint({clientX:x,clientY:y,currentTarget:paper},slot.page);
 }
 closePanels();updateFormatState();
 const menu=$('edit-menu');menu.hidden=false;
 const vv=window.visualViewport;
 const left=vv?.offsetLeft||0,top=vv?.offsetTop||0;
 const width=vv?.width||innerWidth,height=vv?.height||innerHeight;
 const r=menu.getBoundingClientRect();
 menu.style.left=Math.max(left+12,Math.min(x-r.width/2,left+width-r.width-12))+'px';
 const preferred=y-r.height-14>=top+12?y-r.height-14:y+18;
 menu.style.top=Math.max(top+12,Math.min(preferred,top+height-r.height-36))+'px';
 const first=menu.querySelector('button:not(:disabled)');
 first?.focus({preventScroll:true});
}
function cancelTouchEdit(){
 if(touchEditGesture)clearTimeout(touchEditGesture.timer);
 touchEditGesture=null;
}
$('pages').addEventListener('pointerdown',e=>{
 ignoreDocumentClickUntil=0;
 if(e.pointerType!=='touch'&&e.pointerType!=='pen')return;
 cancelTouchEdit();
 if(!e.isPrimary||e.button!==0||e.target.closest('.art-resize,input,textarea'))return;
 const target=e.target;
 const gesture={id:e.pointerId,x:e.clientX,y:e.clientY,target,timer:null};
 gesture.timer=setTimeout(()=>{
  if(touchEditGesture!==gesture)return;
  ignoreDocumentClickUntil=performance.now()+1000;
  showEditMenu(gesture.x,gesture.y,target,Boolean(target.closest('.range-handle')));
 },550);
 touchEditGesture=gesture;
},true);
window.addEventListener('pointermove',e=>{
 if(touchEditGesture?.id===e.pointerId&&Math.hypot(e.clientX-touchEditGesture.x,e.clientY-touchEditGesture.y)>8)cancelTouchEdit();
},{passive:true});
window.addEventListener('pointerup',e=>{if(touchEditGesture?.id===e.pointerId)cancelTouchEdit();});
window.addEventListener('pointercancel',cancelTouchEdit);
$('pages').addEventListener('click',e=>{
 if(performance.now()<ignoreDocumentClickUntil){e.preventDefault();e.stopImmediatePropagation();}
},true);
$('pages').addEventListener('contextmenu',e=>{
 if(e.target.closest('input,textarea'))return;
 e.preventDefault();cancelTouchEdit();
 showEditMenu(e.clientX,e.clientY,e.target);
});
$('canvas-area').addEventListener('scroll',()=>{cancelTouchEdit();hideEditMenu();},{passive:true});
$('edit-menu').addEventListener('keydown',e=>{
 const buttons=[...$('edit-menu').querySelectorAll('button:not(:disabled)')];
 const index=buttons.indexOf(document.activeElement);
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){
  e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
 }else if(e.key==='Home'||e.key==='End'){
  e.preventDefault();buttons[e.key==='Home'?0:buttons.length-1]?.focus();
 }
});
if(!/Mac|iPhone|iPad/.test(navigator.platform||'')){
 for(const kbd of $('edit-menu').querySelectorAll('kbd'))kbd.textContent=kbd.textContent.replace('⌘','Ctrl+');
}
window.addEventListener('resize',()=>{cancelTouchEdit();hideEditMenu();});
function updateSelection(){
 const range=selectedRange();
 for(const el of $('pages').querySelectorAll('.selectable-item')){
  const index=Number(el.dataset.index);
  const active=!!range&&index>=range.start&&index<range.end;
  el.classList.toggle('selected',active);
  el.classList.toggle('in-range',active);
 }
 drawInsertionCaret();drawSelectionHandles();updateFormatState();
}
function openWord(id){const target=objectById(id);if(!target||target.type!=='word')return;
 selectionAnchorId=id;selectionFocusId=id;selectedId=id;editingId=id;buffer=target.signs.slice();renderComposer();updateSelection();if(activePanel!=='keyboard')switchPanel('keyboard');}
// Glyphs change VISUAL facing only; logical input and codes never change.
function facingSignNode(sign,kind=''){
 const span=document.createElement('span');span.textContent=sign;
 span.className=kind?kind+' facing-sign':'facing-sign';
 span.setAttribute('dir','ltr');
 if(mirrorSign(doc?.direction||'ltr',sign))span.classList.add('mirrored-sign');
 return span;
}
function facingSequenceNode(signs){
 const sequence=document.createElement('span');sequence.className='facing-sequence';
 sequence.dataset.writingDirection=doc?.direction||'ltr';
 for(const glyph of signs)sequence.append(facingSignNode(glyph));
 return sequence;
}
function drawKeys(){
 const keys=$('keys');keys.replaceChildren();
 for(const sign of glyphGroups[activeGroup]){
  const button=document.createElement('button');button.className='key';
  const glyph=facingSignNode(sign.glyph,'key-glyph');
  const number=document.createElement('small');number.className='key-code';number.textContent=sign.code;
  button.append(glyph,number);button.title=sign.code+' · '+sign.name;
  button.setAttribute('aria-label',sign.code+' '+sign.name);
  button.type='button';button.onclick=()=>typeSign(sign.glyph);keys.append(button);
 }
 const row=$('numbers');row.replaceChildren();for(const n of numerals){const btn=document.createElement('button');btn.className='numkey';
  const glyph=facingSignNode(n.sign,'glyph');
  const value=document.createElement('small');value.textContent=n.value;btn.append(glyph,value);
  btn.setAttribute('aria-label','Egyptian numeral '+n.value);btn.onclick=()=>typeSign(n.sign);row.append(btn);}
 for(const t of document.querySelectorAll('.tab'))t.classList.toggle('active',t.dataset.tab===activeGroup);
 keys.scrollTop=0;
}

function typeSign(sign){if(commitPending)return;buffer.push(sign);renderComposer();}
let predVersion=0,previewTimer=null,commitPending=false;
// Prediction requests are handled by the headless keyboard worker.
function renderComposer(){
 const table=selectedTable();
 $('composer-title').textContent=table&&selectedTableCell?.tableId===table.id
  ? `Compose table cell ${String.fromCharCode(65+selectedTableCell.column)}${selectedTableCell.row+1}`
  : editingId?'Edit selected word':'Compose a word';
 const area=$('composer');area.replaceChildren();
 const preview=$('quadrat-preview');preview.hidden=true;preview.replaceChildren();
 if(previewTimer!==null){clearTimeout(previewTimer);previewTimer=null;}
 if(buffer.length)area.append(facingSequenceNode(buffer));
 $('suggestion-toolbar').hidden=!buffer.length;
 $('suggestions').hidden=!buffer.length;
 $('save-personal-word').disabled=!buffer.length;
 $('expand-predictions').disabled=!buffer.length;
 $('expand-predictions').textContent='More suggestions';
 expanded=false;expandedOffset=0;expandedLoading=false;expandedGeneration++;
 $('expanded-results').replaceChildren();$('more-predictions').hidden=true;
 $('expanded-predictions').hidden=true;
 $('expand-predictions').setAttribute('aria-expanded','false');
 showSuggestions([{signs:buffer,source:'user'}].filter(x=>x.signs.length));
 const current=++predVersion;
 if(!buffer.length)return;
 // The preview ONLY renders the coordinates produced by Python compose().
 if(buffer.length>1&&buffer.length<=64){
  const signs=buffer.slice();
  previewTimer=setTimeout(()=>{
   previewTimer=null;
   rpc('compose',{signs,width:20}).then(answer=>{
    if(current!==predVersion||!doc)return;
    const geometry=fitQuadrat(answer.quadrat);
    const word=document.createElement('div');word.className='quadrat-preview-word';
    word.style.width=geometry.width+'px';word.style.height=geometry.height+'px';
    drawQuadratInk(word,geometry,'#153f70',false);
    preview.replaceChildren(word);preview.hidden=false;
   }).catch(error=>{if(current===predVersion)status('Word preview: '+error.message,true);});
  },90);
 }
 keyboardSuggest(0,8).then(answer=>{
  if(current!==predVersion)return;
  showSuggestions(answer.suggestions);
  $('expand-predictions').textContent='Top suggestions ('+answer.total+' max)';
 }).catch(e=>{if(current===predVersion)status('Prediction: '+e.message,true);});
}
function suggestionButton(candidate){
 const button=document.createElement('button');button.append(facingSequenceNode(candidate.signs));
 if(candidate.source==='user')button.classList.add('user-choice');
 if(candidate.source==='personal')button.classList.add('personal-choice');
  if(candidate.source_tier==='ramses_corpus')button.classList.add('ramses-choice');
 if(candidate.source_tier==='unlinked_attestation')button.classList.add('unlinked-choice');
 const rtc=candidate.source_tier==='ramses_corpus';
 
 const provenance=candidate.source==='user'?'Use own spelling ':
  candidate.source==='personal'?'Use personal spelling ':
  rtc?'Use Ramses corpus word-model sequence (unlinked) ':
  candidate.source_tier==='unlinked_attestation'?'Use attested spelling with unresolved lemma ':
  candidate.source_tier==='lemma_linked'?'Use verified lemma-linked spelling ':'Use unverified spelling ';
 button.setAttribute('aria-label',provenance+candidate.signs.join(''));
 button.title=provenance.trim();
 button.onclick=()=>commit(candidate);
 return button;
}
function showSuggestions(candidates){
 const wrap=$('suggestions');wrap.replaceChildren();
 if(!candidates.length)return;
 for(const c of candidates)wrap.append(suggestionButton(c));
}
async function loadExpanded(reset){
 if(!buffer.length||!expanded||expandedLoading)return;
 const current=predVersion,epoch=expandedGeneration;
 const offset=reset?0:expandedOffset;
 expandedLoading=true;$('more-predictions').disabled=true;
 try{
  const answer=await keyboardSuggest(offset,40);
  if(current!==predVersion||epoch!==expandedGeneration||!expanded)return;
  const wrap=$('expanded-results');if(reset)wrap.replaceChildren();
  for(const candidate of answer.suggestions)wrap.append(suggestionButton(candidate));
  expandedOffset=offset+answer.suggestions.length;
  $('more-predictions').hidden=!answer.has_more;
 }catch(e){
  if(current===predVersion&&epoch===expandedGeneration)status('Expanded predictions: '+e.message,true);
 }finally{
  if(epoch===expandedGeneration){expandedLoading=false;$('more-predictions').disabled=false;}
 }
}
$('expand-predictions').onclick=()=>{
 if(!buffer.length)return;
 expanded=!expanded;expandedGeneration++;expandedLoading=false;
 $('expanded-predictions').hidden=!expanded;
 $('expand-predictions').setAttribute('aria-expanded',String(expanded));
 if(expanded)loadExpanded(true);
};
$('more-predictions').onclick=()=>loadExpanded(false);
$('manage-personal-words').onclick=()=>{
 const target=$('personal-words-list');target.hidden=!target.hidden;
 if(!target.hidden)renderPersonalWords();
};
function renderPersonalWords(){
 const target=$('personal-words-list');target.replaceChildren();
 if(!writingProfile.personal_entries.length){target.textContent='No saved personal words.';return;}
 for(const entry of writingProfile.personal_entries){
  const row=document.createElement('div');row.className='personal-item';
  const spelling=document.createElement('span');spelling.textContent=entry.signs;
  const editButton=document.createElement('button');editButton.type='button';editButton.textContent='Edit';
  editButton.setAttribute('aria-label','Edit personal word '+entry.signs);
  editButton.onclick=async()=>{
   const response=await modal({title:'Edit personal word',initialValue:entry.signs,action:'Save word'});
   if(!response.confirmed)return;
   if(!/^[\u{13000}-\u{1342F}]+$/u.test(response.value)){
    status('My Words accepts verified hieroglyphic Unicode only',true);return;
   }
   try{await queueProfileChange({op:'replace-word',previous:entry.signs,spelling:response.value});
    renderPersonalWords();renderComposer();}
   catch(e){status('My Words: '+e.message,true);}
  };
  const removeButton=document.createElement('button');removeButton.type='button';removeButton.textContent='Delete';
  removeButton.setAttribute('aria-label','Remove personal word '+entry.signs);
  removeButton.onclick=async()=>{
   try{await queueProfileChange({op:'delete-word',spelling:entry.signs});renderPersonalWords();renderComposer();}
   catch(e){status('My Words: '+e.message,true);}
  };
  row.append(spelling,editButton,removeButton);target.append(row);
 }
}
$('save-personal-word').onclick=async()=>{
 if(!buffer.length)return;
 const value=buffer.join('');
 try{await queueProfileChange({op:'add-word',spelling:value});}
 catch(e){status('Personal word not saved: '+e.message,true);return;}
 status('Saved to My Words');
 if(!$('personal-words-list').hidden)renderPersonalWords();
 renderComposer();
};
async function commit(candidate){
 if(commitPending||!doc||!candidate?.signs?.length)return;
 commitPending=true;
 try{
 const cart=selectedCartoucheObject();
 if(cart){
  const success=await apply({op:'set_cartouche_words',id:cart.id,
    words:[...cart.items.map(w=>w.signs),candidate.signs]});
  if(!success)return;
  await rememberChoice(candidate);buffer=[];editingId=null;renderComposer();return;
 }
 const table=selectedTable();
 if(table&&selectedTableCell?.tableId===table.id){
  const {row,column}=selectedTableCell,cell=table.rows[row]?.[column];
  if(!cell)return;
  const words=cell.mode==='text'?(cell.items||[]).map(w=>w.signs):[];
  const success=await apply({op:'set_table_cell',id:table.id,row,column,
                             words:[...words,candidate.signs]});
  if(!success)return;
  await rememberChoice(candidate);
  buffer=[];editingId=null;renderComposer();return;
 }
 let position=caretIndex;
 const editing=editingId;
 if(editing){const success=await apply({op:'replace_signs',id:editing,signs:candidate.signs,lexicon_ref:candidate.lexicon_ref||null});
  if(!success)return;selectionAnchorId=editing;selectionFocusId=editing;selectedId=editing;caretIndex=doc.items.findIndex(i=>i.id===editing)+1;
 }else{
  position=Math.max(0,Math.min(position,doc.items.length));
  const success=await apply({op:'insert_word',index:position,signs:candidate.signs,lexicon_ref:candidate.lexicon_ref||null});
  if(!success)return;caretIndex=position+1;clearSelection();
 }
 // Preference updates never change the chosen spelling or lexicon contents.
 await rememberChoice(candidate);
 editingId=null;buffer=[];renderComposer();
 }finally{commitPending=false;}
}
$('clear').onclick=()=>{if(commitPending)return;buffer=[];editingId=null;renderComposer();};
$('backspace').onclick=()=>{if(commitPending)return;buffer.pop();renderComposer();};
for(const tab of document.querySelectorAll('.tab'))tab.onclick=()=>{activeGroup=tab.dataset.tab;drawKeys();};
$('zoom').onchange=e=>{zoomChoice=e.target.value;repaintCurrentLayout();};
window.addEventListener('resize',()=>{if(!editorScreen.hidden&&zoomChoice.startsWith('fit-'))repaintCurrentLayout();});
$('docname').onchange=async e=>{const name=e.target.value.trim();if(!name){e.target.value=doc.name;return;}await apply({op:'set_document',name});if(doc)document.title='MdwNfr — '+doc.name;};
$('surface').onchange=async e=>{if(await apply({op:'set_document',surface:e.target.value})){refreshZoomOptions();repaintCurrentLayout();}};
$('font-size').onchange=e=>apply({op:'set_document',font_size_pt:Number(e.target.value)});
$('direction').onchange=e=>apply({op:'set_document',direction:e.target.value});
$('papyrus-height').onchange=e=>apply({op:'set_document',papyrus_height_mm:Number(e.target.value)});
$('papyrus-margin').onchange=e=>{
 if(!doc||doc.surface!=='papyrus')return;
 const value=Number(e.target.value);
 apply({op:'set_document',margins_mm:{top:value,bottom:value,left:value,right:value}});
};
for(const edge of ['top','bottom','left','right']){
 $('margin-'+edge).onchange=e=>{if(!doc)return;apply({op:'set_document',margins_mm:{top:18,bottom:18,left:18,right:18,...doc.margins_mm,[edge]:Number(e.target.value)}})};
}
function styleSelected(patch){
 const selected=selectedItems();
 const words=selected.filter(item=>item.type==='word');
 if(words.length)return apply({op:'set_styles',styles:words.map(item=>({id:item.id,...patch}))});
 if(selected.length!==1)return false;
 const owner=selected[0],copy=structuredClone(owner);
 if(owner.type==='cartouche'){
  copy.items=copy.items.map(word=>({...word,...patch}));
  return apply({op:'replace_cartouche',id:owner.id,object:copy});
 }
 if(owner.type==='table'&&selectedTableCell?.tableId===owner.id){
  const cell=copy.rows[selectedTableCell.row]?.[selectedTableCell.column];
  if(cell?.mode!=='text'||!cell.items.length)return false;
  cell.items=cell.items.map(word=>({...word,...patch}));
  return apply({op:'replace_table',id:owner.id,object:copy});
 }
 return false;
}
$('color-black').onclick=()=>styleSelected({color:'#192433'});
$('color-red').onclick=()=>styleSelected({color:'#ac2533'});
$('bold').onclick=()=>{
 const words=editableStyleWords();
 if(words.length)styleSelected({bold:!words.every(item=>item.bold)});
};
$('delete').onclick=()=>{hideEditMenu();deleteSelection();};
$('library').onclick=()=>{closePanels();backToLibrary();};
$('create-document').onclick=createDocument;
document.addEventListener('visibilitychange',()=>{if(document.hidden&&doc)flushAutosave().catch(()=>{});});
window.addEventListener('pagehide',()=>{if(doc)flushAutosave().catch(()=>{});});

// All modal completion paths settle the promise; cancel/outside/Escape never mutate the DB.
function modal({title,description='',action='Continue',initialValue=null,destructive=false}){
 return new Promise(resolve=>{
  const bg=$('dialog-backdrop'),ok=$('dialog-ok'),cancel=$('dialog-cancel'),input=$('dialog-input');
  const previousFocus=document.activeElement;
  $('dialog-title').textContent=title;$('dialog-desc').textContent=description;
  ok.textContent=action;ok.classList.toggle('danger',destructive);
  input.hidden=initialValue===null;input.value=initialValue??'';
  input.setAttribute('aria-label',title==='Paste'?'Paste hieroglyphic text':'Document name');
  bg.classList.remove('hidden');
  function finish(confirmed){
   if(confirmed&&initialValue!==null&&!input.value.trim()){
    input.setCustomValidity('Document name cannot be empty');input.reportValidity();return;
   }
   input.setCustomValidity('');bg.classList.add('hidden');
   ok.removeEventListener('click',yes);cancel.removeEventListener('click',no);
   input.removeEventListener('keydown',keys);bg.removeEventListener('click',outside);
   document.removeEventListener('keydown',escape);
   if(previousFocus?.isConnected)previousFocus.focus();
   resolve({confirmed,value:input.value.trim()});
  }
  const yes=()=>finish(true),no=()=>finish(false);
  const outside=e=>{if(e.target===bg)no();};
  const keys=e=>{if(e.key==='Enter'){e.preventDefault();yes();}};
  const escape=e=>{if(e.key==='Escape'){e.preventDefault();no();}};
  ok.addEventListener('click',yes);cancel.addEventListener('click',no);
  input.addEventListener('keydown',keys);bg.addEventListener('click',outside);
  document.addEventListener('keydown',escape);
  (initialValue!==null?input:cancel).focus();
  if(initialValue!==null)input.select();
 });
}
async function renameDocument(id){
 if(libraryBusy||!ready)return;
 const entry=await load(id);if(!entry){await renderDocList();return;}
 const decision=await modal({title:'Rename document',description:'Choose a name for this document.',action:'Rename',initialValue:entry.name});
 if(!decision.confirmed||decision.value===entry.name)return;
 setLibraryBusy(true);showLibraryError();
 try{
  // Rename through the authoritative Python transaction engine.
  const latest=await load(id);
  if(!latest)throw new Error('Document no longer exists');
  const result=await rpc('transact',{document:latest,action:{op:'set_document',name:decision.value,base_revision:latest.revision}});
  await save(result.document,latest.revision);
  await renderDocList();
 }catch(e){showLibraryError('Could not rename document: '+e.message);}
 finally{setLibraryBusy(false);}
}
async function deleteDocument(id){
 if(libraryBusy)return;
 const entry=await load(id);if(!entry){await renderDocList();return;}
 const decision=await modal({title:'Delete document?',description:'“'+entry.name+'” will be permanently deleted from this device. This action cannot be undone.',action:'Delete',destructive:true});
 if(!decision.confirmed)return;
 setLibraryBusy(true);showLibraryError();
 try{
   await remove(id,entry.revision);
   // Do not retain per-document spelling preferences for deleted documents.
   await queueProfileChange({op:'forget-document',document_id:id});
   await renderDocList();
  }
 catch(e){showLibraryError('Could not delete document: '+e.message);}
 finally{setLibraryBusy(false);}
}
async function renderDocList(){
 const root=$('doc-list');root.replaceChildren();
 const entries=(await list()).sort((a,b)=> (b.updated_at||b.created_at||'').localeCompare(a.updated_at||a.created_at||'') ||
   (b.revision||0)-(a.revision||0) || a.name.localeCompare(b.name));
 $('library-empty').hidden=entries.length>0;
 for(const entry of entries){
  const card=document.createElement('article');card.className='document-card';
  const open=document.createElement('button');open.className='document-open';open.type='button';
  const icon=document.createElement('span');icon.className='document-icon';icon.textContent='𓏞';icon.setAttribute('aria-hidden','true');
  const details=document.createElement('span');details.className='document-details';
  const name=document.createElement('strong');name.className='document-name';name.textContent=entry.name||'Untitled';
  const meta=document.createElement('span');meta.className='document-meta';
  const count=entry.word_count??(entry.items||[]).filter(i=>i.type==='word').length;
  meta.textContent=(entry.surface||'A4')+' · '+count+' words · '+(entry.direction||'rtl').toUpperCase();
  details.append(name,meta);open.append(icon,details);
  open.setAttribute('aria-label','Open '+(entry.name||'Untitled'));
  open.onclick=()=>openDocument(entry.id);
  const actions=document.createElement('div');actions.className='document-actions';
  const rename=document.createElement('button');rename.type='button';rename.className='document-action rename-action';rename.textContent='Rename';
  rename.setAttribute('aria-label','Rename '+(entry.name||'Untitled'));
  rename.onclick=()=>renameDocument(entry.id);
  const del=document.createElement('button');del.type='button';del.className='document-action delete-action';del.textContent='Delete';
  del.setAttribute('aria-label','Delete '+(entry.name||'Untitled'));
  del.onclick=()=>deleteDocument(entry.id);
  actions.append(rename,del);card.append(open,actions);root.append(card);
 }
 setLibraryBusy(libraryBusy);
}

// A cached shell is not proof that the Python editor runs without Internet.
async function showOfflineReadiness(){
 const notice=$('offline-notice');
 try{
  const response=await fetch('/runtime-status.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Missing runtime manifest');
  const state=await response.json();
  let installed=false;
  if(state.offline_ready===true&&navigator.serviceWorker?.controller&&'caches' in window){
   const names=(await caches.keys()).filter(name=>/^mdwnfr-offline-[a-f0-9]{16}$/.test(name));
   for(const name of names){
    const cache=await caches.open(name);
    const manifest=await cache.match('/offline-assets.json');
    if(!manifest)continue;
    const publication=await manifest.json();
    if(publication.complete!==true)continue;
    const critical=['/index.html','/app.js','/keyboard-prediction-worker.mjs',
     '/keyboard-release-pin.json','/vendor/pyodide/pyodide.asm.wasm',
     '/assets/fonts/hieroglyphs.woff2'];
    const assets=new Set(publication.assets.map(item=>item.path));
    if(critical.every(path=>assets.has(path)&&publication.assets.some(entry=>entry.path===path))&&
       (await Promise.all(critical.map(path=>cache.match(path)))).every(Boolean)){
      installed=true;break;
    }
   }
  }
  notice.hidden=installed;
  if(!installed)notice.textContent=state.offline_ready===true
   ?'Offline editing is not yet confirmed on this device. Let the installation finish before relying on offline use.'
   :'Offline editing is not installed: the local Python runtime or hieroglyph font is incomplete.';
 }catch(error){
  notice.hidden=false;
  notice.textContent='Could not verify the offline editor installation. Do not clear this app’s site data.';
 }
}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('controllerchange',()=>{void showOfflineReadiness();});

// Export an unsaved conflict copy with a new document ID so it can be
// reimported without overwriting the newer persisted document.
function downloadUnsavedDocumentCopy(){
 if(!doc)throw new Error('No document to export');
 const copy={...structuredClone(doc),id:crypto.randomUUID().replaceAll('-',''),
  name:(doc.name+' (recovered)').slice(0,120),revision:0};
 const url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;
 link.download='mdwnfr-recovery-'+copy.id+'.mdwnfr.json';
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('export-unsaved').onclick=()=>{try{downloadUnsavedDocumentCopy();}catch(e){status('Recovery export failed: '+e.message,true);}};
window.addEventListener('beforeunload',event=>{
 if(doc&&doc.id===persistedDocumentId&&doc.revision!==persistedRevision){
  event.preventDefault();event.returnValue='';
 }
});
// Library appears immediately, even if the Python engine is still loading.
showLibrary();
showOfflineReadiness();
renderDocList().catch(e=>showLibraryError('Unable to read local documents: '+e.message));

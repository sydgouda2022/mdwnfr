import {chromium,webkit} from 'playwright';
const base=process.env.AUDIT_BASE_URL||'https://mdwnfr.sydgouda.workers.dev/';
const configurations=[
  {name:'small-phone',engine:'webkit',width:375,height:667,mobile:true},
  {name:'phone',engine:'chromium',width:390,height:844,mobile:true},
  {name:'tablet',engine:'webkit',width:1024,height:768,mobile:true},
  {name:'desktop',engine:'chromium',width:1440,height:900,mobile:false}
];
const all=[];
const record=(config,scenario,status,detail={})=>{
  const entry={configuration:config.name,engine:config.engine,scenario,status,...detail};
  all.push(entry);
  console.log('AUDIT '+JSON.stringify(entry));
};
const wait=async(page,predicate,timeout=90000)=>
  page.waitForFunction(predicate,null,{timeout});
const sleep=(n)=>new Promise(resolve=>setTimeout(resolve,n));
for(const config of configurations.filter(c=>!process.env.AUDIT_VARIANT||c.name===process.env.AUDIT_VARIANT)){
 const browser=await (config.engine==='webkit'?webkit:chromium).launch({headless:true,args:config.engine==='chromium'?['--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({
  viewport:{width:config.width,height:config.height},
  isMobile:config.mobile,hasTouch:config.mobile,
  deviceScaleFactor:config.mobile?2:1,
  serviceWorkers:'allow'
 });
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 page.setDefaultTimeout(20000);
 let documentCreated=false;
 const check=async(label,fn)=>{
  const begin=Date.now();
  try{
   const detail=await fn();
   record(config,label,'PASS',{elapsed_ms:Date.now()-begin,...(detail||{})});
   return true;
  }catch(e){
   record(config,label,'FAIL',{elapsed_ms:Date.now()-begin,error:String(e.message||e).slice(0,650)});
   return false;
  }
 };
 const visible=async(id)=>page.locator(id).isVisible();
 const openFormat=async()=>{if(!await visible('#format-panel'))await page.locator('#format-toggle').click();};
 const closeDialog=async()=>{if(await visible('#insert-dialog-backdrop'))await page.locator('#insert-sheet-cancel').click();};
 const enterSheet=async(type)=>{
  await closeDialog();
  await openFormat();
  await page.locator('#insert-'+type).click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'visible',timeout:30000});
 };
 const readyPreview=async()=>{
  await wait(page,()=>!document.getElementById('insert-sheet-confirm')?.disabled,100000);
  return page.locator('#insert-preview .paper').count();
 };
 const screenshot=async(name)=>{
  await page.screenshot({path:'/tmp/mdwnfr-audit-'+config.name+'-'+name+'.png',fullPage:false}).catch(()=>{});
 };
 await check('production-boot',async()=>{
  const time=Date.now();
  const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});
  if(!response?.ok())throw Error('HTTP '+response?.status());
  await wait(page,()=>document.getElementById('create-document')?.disabled===false,180000);
  return{load_ms:Date.now()-time,title:await page.title()};
 });
 await check('library-responsive',async()=>{
  const detail=await page.evaluate(()=>{
   const b=document.querySelector('.library-toolbar').getBoundingClientRect();
   const c=document.querySelector('#create-document').getBoundingClientRect();
   return{body_scroll:document.documentElement.scrollWidth-innerWidth,
    toolbar:{left:b.left,right:b.right,bottom:b.bottom},
    new_document:{left:c.left,right:c.right,width:c.width,height:c.height}};
  });
  if(detail.body_scroll>3)throw Error('Document library overflows horizontally by '+detail.body_scroll+'px');
  if(detail.new_document.right>config.width+3)throw Error('New Document is outside viewport');
  return detail;
 });
 await check('new-document',async()=>{
  await page.locator('#create-document').click();
  await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
  documentCreated=true;
  return{title:await page.title()};
 });
 if(!documentCreated){await browser.close();continue;}
 await check('editor-responsive',async()=>{
  const details=await page.evaluate(()=>{
   const a=document.querySelector('#format-toggle').getBoundingClientRect();
   const b=document.querySelector('.canvas-area').getBoundingClientRect();
   return{format_toggle:{x:a.x,y:a.y,w:a.width,h:a.height},
    canvas:{x:b.x,y:b.y,w:b.width,h:b.height},
    document_scroll:document.documentElement.scrollWidth-innerWidth};
  });
  if(details.document_scroll>3)throw Error('Editor overflows browser horizontally');
  return details;
 });
 await check('format-and-insert-visibility',async()=>{
  await openFormat();
  const ids=['clipart','image','table','cartouche'];
  const detail=await page.evaluate(ids=>Object.fromEntries(ids.map(id=>{
    const node=document.getElementById('insert-'+id);
    const r=node.getBoundingClientRect();
    const container=document.getElementById('format-panel').getBoundingClientRect();
    return[id,{width:r.width,height:r.height,hidden:getComputedStyle(node).display==='none',
      panelRight:container.right,panelBottom:container.bottom}];
  })),ids);
  for(const k of ids)if(detail[k].width<42||detail[k].height<42)
   throw Error(k+' touch target below 42px');
  return detail;
 });
 const defaultHeight=async()=>page.locator('#insert-sheet').evaluate(el=>{
  const r=el.getBoundingClientRect(),foot=el.querySelector('.insert-sheet-footer').getBoundingClientRect();
  return{top:r.top,bottom:r.bottom,height:r.height,footer_visible:foot.top>=0&&foot.bottom<=innerHeight,
   content_height:el.scrollHeight,client_height:el.clientHeight};
 });
 await check('clipart-browser-search-preview-cancel',async()=>{
  await enterSheet('clipart');
  await page.locator('#artwork-grid .artwork-choice').first().waitFor({state:'visible',timeout:30000});
  const count=await page.locator('#artwork-grid .artwork-choice').count();
  await page.locator('#artwork-search').fill('falcon');
  const filtered=await page.locator('#artwork-grid .artwork-choice').count();
  await page.locator('#artwork-search').fill('');
  await page.locator('#artwork-grid .artwork-choice').first().click();
  const n=await readyPreview();
  if(!n)throw Error('No on-page clip art preview');
  const dims=await defaultHeight();
  await screenshot('clipart');
  await closeDialog();
  const persisted=await page.locator('.clipart-object').count();
  if(persisted)throw Error('Cancel persisted '+persisted+' clip art');
  return{catalog_count:count,search_falcon:filtered,preview_papers:n,sheet:dims};
 });
 await check('image-upload-preview-cancel',async()=>{
  await enterSheet('image');
  await page.locator('#insert-image-file').setInputFiles({
   name:'audit.png',mimeType:'image/png',
   buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGOUcOr9z4AEmBjQAGEBAHwtAe6/I+HPAAAAAElFTkSuQmCC','base64')
  });
  const n=await readyPreview();
  const visibleThumbnail=await visible('#insert-image-thumbnail');
  if(!visibleThumbnail||!n)throw Error('Image does not preview on the page');
  await screenshot('image');
  await closeDialog();
  return{thumbnail:visibleThumbnail,preview_papers:n,committed_after_cancel:await page.locator('.clipart-object').count()};
 });
 await check('table-config-style-preview-confirm',async()=>{
  await enterSheet('table');
  await page.locator('#insert-table-rows').fill('3');
  await page.locator('#insert-table-rows').dispatchEvent('change');
  await page.locator('#insert-table-columns').fill('4');
  await page.locator('#insert-table-columns').dispatchEvent('change');
  await page.locator('#insert-table-border').selectOption('dashed');
  await page.locator('#insert-table-color').fill('#217acc');
  await page.locator('#insert-table-line').fill('1');
  await page.locator('#insert-table-line').dispatchEvent('change');
  const n=await readyPreview();
  if(!n)throw Error('Table preview missing');
  const dimensions=await defaultHeight();
  await screenshot('table');
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden',timeout:90000});
  await page.locator('.table-object').first().waitFor({state:'visible',timeout:90000});
  const cells=await page.locator('.table-object').first().locator('.table-cell-view').count();
  if(cells!==12)throw Error('Expected 12 cells, got '+cells);
  const tableStyle=await page.locator('.table-object').first().evaluate(el=>getComputedStyle(el).borderTopStyle);
  return{preview_papers:n,cells,table_border_style:tableStyle,sheet:dimensions};
 });
 await check('table-cell-edit-open',async()=>{
  const table=page.locator('.table-object').first();
  await table.locator('.table-cell-view').first().click();
  await page.locator('#table-controls').waitFor({state:'visible',timeout:30000});
  await page.locator('#table-cell-value').fill('𓅓𓏏');
  await page.locator('#table-cell-save').click();
  await wait(page,()=>document.querySelectorAll('.table-cell-word .glyph-ink-svg text').length>=2,90000);
  return{cell_glyphs:await page.locator('.table-cell-word .glyph-ink-svg text').count()};
 });
 await check('table-reopen-editor',async()=>{
  const table=page.locator('.table-object').first();
  await table.dblclick({position:{x:15,y:15}});
  await page.locator('#insert-screen-table').waitFor({state:'visible',timeout:30000});
  const rows=await page.locator('#insert-table-rows').inputValue();
  const cols=await page.locator('#insert-table-columns').inputValue();
  const border=await page.locator('#insert-table-border').inputValue();
  await closeDialog();
  return{rows,columns:cols,border};
 });
 await check('cartouche-horizontal-preview-confirm-reopen',async()=>{
  await enterSheet('cartouche');
  await page.locator('input[name="insert-cartouche-direction"][value="horizontal"]').check();
  await readyPreview();
  await page.locator('#insert-sheet-confirm').click();
  await page.locator('#insert-dialog-backdrop').waitFor({state:'hidden',timeout:90000});
  const cart=page.locator('.cartouche-object').first();
  await cart.waitFor({state:'visible',timeout:90000});
  await cart.dblclick();
  await page.locator('#insert-screen-cartouche').waitFor({state:'visible',timeout:30000});
  const direction=await page.locator('input[name="insert-cartouche-direction"]:checked').inputValue();
  await screenshot('cartouche');
  await closeDialog();
  if(direction!=='horizontal')throw Error('Cartouche orientation did not survive commit');
  return{direction};
 });
 await check('artwork-preview-drag',async()=>{
  await enterSheet('clipart');
  await page.locator('#artwork-grid .artwork-choice').first().click();
  await readyPreview();
  const box=await page.locator('.insert-preview-selection').boundingBox();
  if(!box)throw Error('No drag target');
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.5+24,box.y+box.height*.5+19,{steps:7});
  await page.mouse.up();
  await readyPreview();
  const state=await page.locator('#insert-object-y').inputValue();
  await closeDialog();
  return{height_position_percent:state};
 });
 await check('artwork-preview-resize',async()=>{
  await enterSheet('clipart');
  await page.locator('#artwork-grid .artwork-choice').first().click();
  await readyPreview();
  const original=Number(await page.locator('#insert-object-width').inputValue());
  const box=await page.locator('.insert-preview-handle').boundingBox();
  if(!box)throw Error('No resize handle');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+20,{steps:6});
  await page.mouse.up();
  await readyPreview();
  const changed=Number(await page.locator('#insert-object-width').inputValue());
  await closeDialog();
  if(changed<=original)throw Error('Drag resize did not enlarge width');
  return{before_mm:original,after_mm:changed};
 });
 await check('save-leave-reopen',async()=>{
  await closeDialog();
  await page.locator('#library').click();
  await page.locator('#library-screen').waitFor({state:'visible',timeout:90000});
  const card=page.locator('#doc-list .document-open').first();
  await card.waitFor({state:'visible',timeout:30000});
  await card.click();
  await page.locator('#editor-screen').waitFor({state:'visible',timeout:90000});
  await page.locator('.table-object').first().waitFor({state:'visible',timeout:90000});
  await page.locator('.cartouche-object').first().waitFor({state:'visible',timeout:90000});
  return{tables:await page.locator('.table-object').count(),
    cartouches:await page.locator('.cartouche-object').count()};
 });
 await check('browser-console-and-unhandled-errors',async()=>{
  if(errors.length)throw Error(errors.join(' | ').slice(0,550));
  return{page_errors:errors.length};
 });
 await context.close();
 await browser.close();
}
const failures=all.filter(a=>a.status==='FAIL');
console.log('AUDIT_SUMMARY '+JSON.stringify({
  total:all.length,passed:all.length-failures.length,failed:failures.length,
  failures:failures.map(f=>({configuration:f.configuration,scenario:f.scenario,error:f.error}))
}));
if(failures.length)process.exitCode=1;


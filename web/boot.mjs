// Start one verified release. An older controlling service worker may otherwise
// combine fresh HTML with its cached app, stylesheet, and Python modules.
async function activate(worker) {
  if(!worker||worker.state==='activated')return;
  if(worker.state==='redundant')throw new Error('Update installation failed');
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('Update installation timed out'));},60000);
    function changed(){
      if(worker.state!=='activated'&&worker.state!=='redundant')return;
      clearTimeout(timer);worker.removeEventListener('statechange',changed);
      worker.state==='activated'?resolve():reject(new Error('Update installation failed'));
    }
    worker.addEventListener('statechange',changed);changed();
  });
}

async function boot() {
  if('serviceWorker' in navigator){
    let updateError=null;
    try{
      const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
      await registration.update().catch(error=>{updateError=error;});
      await activate(registration.installing||registration.waiting||registration.active);
    }catch(error){updateError=error;}
    if(navigator.serviceWorker.controller){
      // A normal fetch of index.html (not a navigation) comes from the active
      // cache even with the older worker. It proves which HTML its assets match.
      const installed=await fetch('/index.html',{cache:'no-store'});
      if(!installed.ok)throw new Error('Installed release is unavailable');
      const html=new DOMParser().parseFromString(await installed.text(),'text/html');
      const current=document.querySelector('meta[name="mdwnfr-build"]')?.content;
      const complete=html.querySelector('meta[name="mdwnfr-build"]')?.content;
      if(current!==complete){
        if(updateError)throw updateError;
        location.reload();return;
      }
      // An unavailable update server must not block a coherent offline release.
    }
  }
  // Re-request CSS after activation as well; its initial request may have been
  // fulfilled by the previous worker. Cache keys intentionally ignore queries.
  const stylesheet=document.querySelector('link[rel="stylesheet"]');
  if(stylesheet)await new Promise(resolve=>{
    stylesheet.onload=resolve;stylesheet.onerror=resolve;
    stylesheet.href='/style.css?boot='+Date.now();
  });
  await import('./app.js');
}

boot().catch(error=>{
  const message=document.getElementById('library-error');
  message.hidden=false;message.textContent='MdwNfr could not finish loading. Reopen the app to retry. '+error.message;
  document.getElementById('library-state').textContent='Could not start';
});

// Start one verified release. An older controlling service worker may otherwise
// combine fresh HTML with its cached app, stylesheet, and Python modules.
async function activate(worker) {
  if(!worker||worker.state==='activated')return;
  if(worker.state==='redundant')throw new Error('Update installation failed');
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('Update installation timed out'));},15000);
    function changed(){
      if(worker.state!=='activated'&&worker.state!=='redundant')return;
      clearTimeout(timer);worker.removeEventListener('statechange',changed);
      worker.state==='activated'?resolve():reject(new Error('Update installation failed'));
    }
    worker.addEventListener('statechange',changed);changed();
  });
}

async function boot() {
  const swDiagnostics={supported:'serviceWorker' in navigator,secureContext:isSecureContext,
    origin:location.origin,registrationScope:null,registrationError:null,updateError:null,
    activeScriptURL:null,installingScriptURL:null,waitingScriptURL:null};
  window.__mdwnfrServiceWorkerDiagnostics=swDiagnostics;
  if('serviceWorker' in navigator){
    let updateError=null;
    try{
      const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
      swDiagnostics.registrationScope=registration.scope;
      swDiagnostics.activeScriptURL=registration.active?.scriptURL||null;
      swDiagnostics.installingScriptURL=registration.installing?.scriptURL||null;
      swDiagnostics.waitingScriptURL=registration.waiting?.scriptURL||null;
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        if(worker)worker.addEventListener('statechange',()=>{
          swDiagnostics.activeScriptURL=registration.active?.scriptURL||null;
          swDiagnostics.installingScriptURL=registration.installing?.scriptURL||null;
          swDiagnostics.waitingScriptURL=registration.waiting?.scriptURL||null;
          swDiagnostics.workerState=worker.state;
        });
      });
      // An already-coherent offline release must not wait for a network update.
      // New releases still use the existing atomic activation path.
      let coherent=false;
      if(navigator.serviceWorker.controller){
        try{
          const current=document.querySelector('meta[name="mdwnfr-build"]')?.content;
          const response=await fetch('/index.html',{cache:'no-store'});
          if(response.ok){
           const html=new DOMParser().parseFromString(await response.text(),'text/html');
           coherent=html.querySelector('meta[name="mdwnfr-build"]')?.content===current;
          }
        }catch(_){}
      }
      if(coherent)void registration.update().catch(()=>{});
      else{
       await registration.update().catch(error=>{updateError=error;});
       await activate(registration.installing||registration.waiting||registration.active);
      }
    }catch(error){updateError=error;swDiagnostics.registrationError=String(error?.stack||error);}
    swDiagnostics.updateError=updateError?String(updateError?.stack||updateError):null;
    // A freshly installed worker can activate before clients.claim() has
    // assigned a controller to this tab. Never import new JS into HTML from
    // the previous release during that window.
    if(!navigator.serviceWorker.controller){
      await new Promise(resolve=>{
        if(navigator.serviceWorker.controller)return resolve();
        let finish=()=>{};
        const timeout=setTimeout(()=>finish(),5000);
        finish=()=>{
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('controllerchange',finish);
          resolve();
        };
        navigator.serviceWorker.addEventListener('controllerchange',finish);
        if(navigator.serviceWorker.controller)finish();
      });
    }
    // Check against the active release even on the *first* installation.
    // On a controlled page this fetch comes from the worker's verified cache.
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

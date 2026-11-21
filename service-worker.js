const CACHE_NAME="bela-vendedor-standalone-v3";
const APP_SHELL=["./","./index.html","./manifest.webmanifest","./sync.js","./icone-avatar-app.svg"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("bela-vendedor-standalone-")&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
 const req=event.request;if(req.method!=="GET")return;
 const url=new URL(req.url);if(url.origin!==self.location.origin)return;
 if(req.mode==="navigate"){event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME);try{const response=await fetch(req);if(response&&response.ok)cache.put(req,response.clone());return response;}catch(_){return (await cache.match(req))||(await cache.match("./index.html"))||Response.error();}})());return;}
 if(APP_SHELL.some(p=>new URL(p,self.location.href).pathname===url.pathname)){event.respondWith(fetch(req).then(response=>{if(response&&response.ok){caches.open(CACHE_NAME).then(cache=>cache.put(req,response.clone()));}return response;}).catch(()=>caches.match(req)));}
});
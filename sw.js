/* Cambiar V en cada nueva publicación, junto con VERSION en app.js. */
const V='citas-v2.3.0';
const FILES=['./','./index.html','./styles.css','./app.js','./push-config.js','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(V).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(
 caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('citas-v')&&key!==V).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('message',event=>{if(event.data==='skip')self.skipWaiting()});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(caches.match(event.request,{ignoreSearch:true}).then(cached=>cached||fetch(event.request)));
});

// El push NO contiene nombres ni teléfonos. La información se consulta del IndexedDB local.
self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let title='Mis Citas · Mel 💗',body='Tienes un recordatorio de tu agenda.';
 try{const db=await new Promise((ok,fail)=>{const req=indexedDB.open('citas',1);req.onsuccess=()=>ok(req.result);req.onerror=()=>fail(req.error)});
 const data=await new Promise((ok,fail)=>{const tx=db.transaction('kv','readonly');const req=tx.objectStore('kv').get('db');req.onsuccess=()=>ok(req.result);req.onerror=()=>fail(req.error)});db.close();
 const now=Date.now();if((data?.ajustes?.pushTestPendingUntil||0)>now){body='¡Prueba recibida! Los avisos están funcionando. ✨';}
 else{const eligible=(data?.eventos||[]).filter(e=>e.ini&&e.recordatorioMin>0&&e.estado!=='cancelada').map(e=>({...e,notifyAt:new Date(e.fecha+'T'+e.ini+':00').getTime()-e.recordatorioMin*60000})).filter(e=>Math.abs(e.notifyAt-now)<8*60000).sort((a,b)=>Math.abs(a.notifyAt-now)-Math.abs(b.notifyAt-now));
 if(eligible.length>1){body=`Tienes ${eligible.length} compromisos próximos. Revisa tu agenda.`;}else if(eligible.length){const e=eligible[0],mins=Number(e.recordatorioMin);body=mins>=1440?`Tienes ${e.tipo==='cita'?'una cita':'un compromiso'} mañana.`:`En ${mins} minutos: ${e.tipo==='cita'?(e.clienta||'una clienta'):(e.titulo||'un compromiso')}.`;}}
 }catch(err){console.error('No se pudo leer agenda local en push',err)}
 await self.registration.showNotification(title,{body,icon:'./icon-192.png',badge:'./icon-192.png',tag:'mel-reminder-'+Math.floor(Date.now()/30000),data:{url:'./'},renotify:false});
})())});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const home=new URL('./',self.registration.scope).href;for(const w of windows){if(w.url.startsWith(self.registration.scope))return w.focus()}return self.clients.openWindow(home)})())});

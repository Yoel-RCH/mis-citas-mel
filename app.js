'use strict';
/* Mis Citas · Mel v2.3.0 — mantiene la misma base de datos «citas», almacén «kv», clave «db». */
const VERSION='2.3.0', DATA_VERSION=4;
const $=s=>document.querySelector(s);
const pad=n=>String(n).padStart(2,'0');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('es-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(n)||0);
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDate=s=>{const [y,m,d]=String(s).split('-').map(Number);return new Date(y,m-1,d)};
const today=()=>ymd(new Date());
const advance=(date,n)=>{const d=parseDate(date);d.setDate(d.getDate()+n);return ymd(d)};
const startOfWeek=f=>{const d=parseDate(f);d.setDate(d.getDate()-(d.getDay()+6)%7);return ymd(d)};
const minutes=t=>{const [h,m]=String(t).split(':').map(Number);return h*60+m};
const addMinutes=(t,n)=>{const total=minutes(t)+Number(n);return (total>=1440||total<0)?'':`${pad(Math.floor(total/60))}:${pad(total%60)}`};
const fmt=(f,opt={day:'numeric',month:'long'})=>new Intl.DateTimeFormat('es-ES',opt).format(parseDate(f));
const fmtFull=f=>new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(parseDate(f));
const sameMonth=(f,month)=>f?.slice(0,7)===month.slice(0,7);
const id=prefix=>prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const ico=(name,size)=>`<svg class="ico" aria-hidden="true"${size?` style="width:${size}px;height:${size}px"`:''}><use href="#i-${name}"></use></svg>`;
const eventTitle=e=>e.tipo==='cita'?(e.clienta||'Cita sin nombre'):(e.titulo||'Evento');
const fmtTime=t=>{if(!/^\d{2}:\d{2}$/.test(t||''))return '—';const h=+t.slice(0,2),m=t.slice(3);return `${h%12||12}:${m} ${h<12?'AM':'PM'}`};
const eventTime=e=>e.ini?`${fmtTime(e.ini)} – ${e.fin?fmtTime(e.fin):'—'}`:'Todo el día';
const typeLabel={cita:'Cita',personal:'Personal',festivo:'Festivo',bloqueo:'No disponible'};
const DEFAULT_TYPES=[{id:'cita',nombre:'Cita',color:'#793348'},{id:'personal',nombre:'Personal',color:'#746397'},{id:'festivo',nombre:'Festivo',color:'#A77835'},{id:'bloqueo',nombre:'No disponible',color:'#4E7C70'}];
const cleanName=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
const cleanPhone=s=>String(s||'').replace(/\D/g,'');
const clientKey=(n,t)=>cleanName(n)+'|'+cleanPhone(t);
const typeFor=t=>DB?.tiposEvento?.find(x=>x.id===t)||DEFAULT_TYPES.find(x=>x.id===t)||{id:t,nombre:t,color:'#793348'};
const typeColor=t=>typeFor(t).color;
const typeName=t=>typeFor(t).nombre;
const stateLabel={agendada:'Agendada',confirmada:'Confirmada',realizada:'Realizada',cancelada:'Cancelada'};
const NAV=[['inicio','home','Inicio'],['cal','calendar','Calendario'],['clientes','users','Clientas'],['resumen','chart','Resumen'],['aj','settings','Ajustes']];
let pushSyncQueue=Promise.resolve(),pushSyncStatus='sin-configurar';
let DB=null,dbPromise=null,writeQueue=Promise.resolve(),page='inicio',currentMonth=today().slice(0,7)+'-01',selectedDay=today(),reportMonth=currentMonth,clientQuery='',updateRegistration=null,forceReload=false,showingSheet=false,toastTimer=null,activeTimeField=null;

function defaults(){return{v:DATA_VERSION,eventos:[],clientas:[],tiposEvento:DEFAULT_TYPES.map(t=>({...t})),ajustes:{lastBackup:null},servicios:[
 {id:'s1',nombre:'Semipermanente',precioBase:20,duracionMin:60},
 {id:'s2',nombre:'Acrílicas',precioBase:35,duracionMin:120},
 {id:'s3',nombre:'Gel',precioBase:30,duracionMin:90},
 {id:'s4',nombre:'Manicura clásica',precioBase:15,duracionMin:45},
 {id:'s5',nombre:'Pedicura',precioBase:20,duracionMin:60},
 {id:'s6',nombre:'Retoque / relleno',precioBase:25,duracionMin:90}]};}
function normalizeData(data){
 const base=defaults(); if(!data||typeof data!=='object')return base;
 // Preservar TODOS los campos anteriores y los precios editados por Melissa.
 const result={...base,...data,ajustes:{...base.ajustes,...(data.ajustes||{})},servicios:Array.isArray(data.servicios)?data.servicios:base.servicios,eventos:Array.isArray(data.eventos)?data.eventos:[],clientas:Array.isArray(data.clientas)?data.clientas:[],tiposEvento:Array.isArray(data.tiposEvento)?data.tiposEvento:DEFAULT_TYPES.map(t=>({...t}))};
 if(Number(data.v||1)<2){for(const e of result.eventos){if(e.tipo==='cita'){
   if(e.estado===undefined)e.estado='agendada';
   if(e.servicioNombre===undefined)e.servicioNombre=result.servicios.find(s=>s.id===e.servicioId)?.nombre||'';
  }}}
 // Migración no destructiva: se crea un registro por pareja nombre + teléfono, incluso desde citas anteriores.
 for(const e of result.eventos){if(e.tipo!=='cita'||!cleanName(e.clienta))continue;const match=result.clientas.find(c=>clientKey(c.nombre,c.tel)===clientKey(e.clienta,e.tel));if(!match)result.clientas.push({id:id('c'),nombre:e.clienta.trim(),tel:(e.tel||'').trim()});}
 for(const t of DEFAULT_TYPES){if(!result.tiposEvento.some(x=>x.id===t.id))result.tiposEvento.unshift({...t});}
 // No activar automáticamente avisos de citas antiguas: solo los que Melissa elija desde v2.3.
 for(const e of result.eventos){if(e.recordatorioMin===undefined)e.recordatorioMin=0;}
 result.v=DATA_VERSION;
 return result;
}
function openDB(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
 const request=indexedDB.open('citas',1);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('kv'))request.result.createObjectStore('kv')};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB no disponible'));
 });return dbPromise;}
async function readDB(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('kv','readonly');const r=tx.objectStore('kv').get('db');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function persistDB(){
 const snapshot=JSON.parse(JSON.stringify(DB));
 const write=async()=>{const db=await openDB();return new Promise((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('No se pudo guardar'));tx.onabort=()=>reject(tx.error||new Error('Guardado cancelado'));
   tx.objectStore('kv').put(snapshot,'db');
  });};
 writeQueue=writeQueue.catch(()=>{}).then(write);return writeQueue;
}
async function changeData(fn,success){const before=JSON.stringify(DB);try{fn();await persistDB();if(DB.ajustes.pushEnabled){pushSyncStatus='pendiente';queuePushSync();}render();if(success)toast(success);return true}catch(err){DB=JSON.parse(before);render();alert('No se pudo guardar. Tus datos anteriores se conservan. Comprueba el espacio del iPhone.');console.error(err);return false}}
function listDay(f){return DB.eventos.filter(e=>e.fecha===f).sort((a,b)=>(a.ini||'').localeCompare(b.ini||'')||eventTitle(a).localeCompare(eventTitle(b)))}
function serviceFor(e){return DB.servicios.find(s=>s.id===e.servicioId)}
function serviceName(e){return e.servicioNombre||serviceFor(e)?.nombre||(e.servicioId?'Servicio anterior':'Otro servicio')}
function appointmentActive(e){return e.tipo==='cita'&&e.estado!=='cancelada'}
function sumPlanned(events){return events.filter(appointmentActive).reduce((s,e)=>s+(Number(e.precio)||0),0)}
function timeValid(e){return !e.ini||!!(e.fin&&e.fin>e.ini)}
function overlaps(a,b){if(a.id===b.id||a.fecha!==b.fecha||a.estado==='cancelada'||b.estado==='cancelada'||a.tipo==='festivo'||b.tipo==='festivo')return false;
 if(!a.ini||!b.ini)return(a.tipo==='bloqueo'||b.tipo==='bloqueo');
 return a.ini<b.fin&&b.ini<a.fin;}
function h(title,action){return`<button type="button" class="text-action" data-action="${action}">${title}</button>`}
function topBar(label='Mis Citas · Mel'){return`<header class="main-heading"><div class="brand-chip"><span class="brand-dot">M</span>${escapeHtml(label)}</div><span class="small muted">hecha con ♡</span></header>`}
function empty(text='No hay eventos por aquí.',symbol='calendar'){return`<div class="empty">${ico(symbol)}<p>${escapeHtml(text)}</p></div>`}
function isSame(f){return f===today()}
function warningBackup(){const last=DB.ajustes.lastBackup;
 if(!DB.eventos.length||last&&Date.now()-last<30*86400e3)return'';
 return`<button type="button" class="notice" style="width:100%;text-align:left;border-style:solid;cursor:pointer" data-action="backup-go">${ico('alert')}<span>Protege tus citas: guarda una copia en Ajustes.</span>${ico('right')}</button>`;}
function appointmentRow(e){const canceled=e.estado==='cancelada';const price=e.tipo==='cita'&&e.precio!==undefined&&e.precio!==null?money(e.precio):'';
 return`<button type="button" style="--event-color:${escapeHtml(typeColor(e.tipo))}" class="appointment ${escapeHtml(e.tipo)} ${canceled?'cancelada':''}" data-action="view-event" data-id="${escapeHtml(e.id)}"><span class="bar"></span><span class="appointment-main"><span class="appointment-title">${escapeHtml(eventTitle(e))}</span><span class="appointment-meta">${escapeHtml(eventTime(e))}${e.tipo==='cita'?' · '+escapeHtml(serviceName(e)):''}${canceled?' · Cancelada':''}</span></span>${price?`<span class="appointment-price">${price}</span>`:''}${ico('right')}</button>`;}
function showEventList(events,emptyText){return events.length?events.map(appointmentRow).join(''):empty(emptyText)}
function navigation(){return NAV.map(([name,icon,label])=>`<button type="button" class="nav-link ${page===name?'active':''}" data-action="page" data-page="${name}" ${page===name?'aria-current="page"':''}><span class="nav-icon">${ico(icon)}</span><span>${label}</span></button>`).join('')}
function render(){if(!DB)return;$('#bottom-nav').innerHTML=navigation();$('#fab').innerHTML=ico('plus');$('#fab').hidden=page==='aj';$('#fab').style.display=page==='aj'?'none':'grid';$('#content').innerHTML=({inicio:renderHome,cal:renderCalendar,clientes:renderClients,resumen:renderReport,aj:renderSettings})[page]();}
function openPage(p){if(!NAV.some(n=>n[0]===p))return;page=p;render();$('#content').scrollTop=0;window.scrollTo({top:0,behavior:'instant'})}
function renderHome(){const f=today(),t=advance(f,1),start=startOfWeek(f),end=advance(start,6);
 const todayEvents=listDay(f),tomorrow=listDay(t).filter(appointmentActive),weekEvents=DB.eventos.filter(e=>e.fecha>=start&&e.fecha<=end&&appointmentActive(e));
 return`<div class="page">${topBar()}<section class="hero"><div class="hero-water" aria-hidden="true"><span class="hero-blob blob-one"></span><span class="hero-blob blob-two"></span><span class="hero-blob blob-three"></span><span class="hero-ripple ripple-one"></span><span class="hero-ripple ripple-two"></span></div><h1 class="greeting">Hola, Melissa <span>♡</span></h1><div class="hero-bottom"><span class="small subtle">${escapeHtml(fmtFull(f))}</span><span class="heart-mark">✦ ♡</span></div></section>
 <div class="stats"><div class="stat">${ico('calendar')}<div class="stat-value">${todayEvents.filter(appointmentActive).length}</div><div class="stat-label">Citas de hoy</div></div><div class="stat">${ico('heart')}<div class="stat-value">${weekEvents.length}</div><div class="stat-label">Esta semana</div></div><div class="stat">${ico('chart')}<div class="stat-value" style="font-size:18px">${money(sumPlanned(weekEvents))}</div><div class="stat-label">Agendado esta semana</div></div></div>
 <div class="actions-row"><button class="btn" data-action="new-event">${ico('plus')} Nueva cita</button><button class="btn secondary" data-action="new-block">${ico('block')} Bloquear horario</button></div>
 ${warningBackup()}<div class="notice rose">${ico('heart')}<span>${tomorrow.length?`Mañana tienes <b>${tomorrow.length} cita${tomorrow.length===1?'':'s'}</b>. Consulta sus horarios aquí.`:'Mañana no tienes citas agendadas.'} Los avisos con la app cerrada se configuran en Calendario de Apple.</span></div>
 <div class="section-heading"><h2>Agenda de hoy</h2>${h('Ver calendario','cal-go')}</div>${showEventList(todayEvents,'Hoy no tienes eventos. ¡Tu agenda está lista!')}
 <div class="section-heading"><h2>Mañana · ${escapeHtml(fmt(t))}</h2></div>${showEventList(listDay(t),'No hay eventos para mañana.')}</div>`;}
function monthMove(value,inc){const d=parseDate(value);d.setMonth(d.getMonth()+inc);return ymd(d)}
function monthControls(month,prev,next){return`<div class="month-controls"><button class="month-nav" data-action="${prev}" aria-label="Mes anterior">${ico('left')}</button><div class="month-center"><strong>${escapeHtml(fmt(month,{month:'long',year:'numeric'}))}</strong></div><button class="month-nav" data-action="${next}" aria-label="Mes siguiente">${ico('right')}</button></div>`}
function renderCalendar(){const d=parseDate(currentMonth),y=d.getFullYear(),m=d.getMonth(),offset=(d.getDay()+6)%7,n=new Date(y,m+1,0).getDate(),count=Math.ceil((offset+n)/7)*7;
 let cells='';for(let i=0;i<count;i++){
  const date=new Date(y,m,1-offset+i),f=ymd(date),all=listDay(f),visible=all.slice(0,6);
  const dots=visible.map(e=>`<span class="event-dot" style="--dot-color:${escapeHtml(typeColor(e.tipo))}" aria-hidden="true"></span>`).join('');
  cells+=`<button type="button" class="day ${date.getMonth()!==m?'out':''} ${isSame(f)?'today':''} ${selectedDay===f?'selected':''}" data-action="select-day" data-date="${f}" aria-label="${escapeHtml(fmtFull(f))}, ${all.length} evento${all.length===1?'':'s'}. Ver agenda"><span class="day-number">${date.getDate()}</span><span class="day-dots">${dots}${all.length>6?'<span class="dot-extra">+</span>':''}</span></button>`;
 }
 const upcoming=DB.eventos.filter(e=>e.fecha>=today()).slice().sort((a,b)=>a.fecha.localeCompare(b.fecha)||(a.ini||'').localeCompare(b.ini||'')).slice(0,3);
 return`<div class="page">${topBar()}<div class="page-title"><div><div class="eyebrow">Organiza tus días</div><h1>Calendario</h1></div><button class="icon-btn" data-action="today" title="Ir a hoy">Hoy</button></div>
 <div class="calendar-cta"><span>${ico('heart')} Toca un día para ver todas sus citas.</span><button class="btn calendar-create" data-action="new-event">${ico('plus')} Agendar</button></div>
 ${monthControls(currentMonth,'month-prev','month-next')}
 <div class="calendar"><div class="weekdays">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(x=>`<span>${x}</span>`).join('')}</div><div class="month-grid">${cells}</div></div><div class="legend">${DB.tiposEvento.map(t=>`<span><i style="background:${escapeHtml(t.color)}"></i>${escapeHtml(t.nombre)}</span>`).join('')}</div>
 <div class="calendar-footnote">${ico('calendar')} Los puntos indican los eventos de cada día. Puedes tener varios en una misma fecha.</div>
 ${upcoming.length?`<div class="section-heading"><h2>Próximos eventos</h2></div>${upcoming.map(e=>`<div class="tiny muted" style="margin-top:10px">${escapeHtml(fmt(e.fecha,{weekday:'short',day:'numeric',month:'short'}))}</div>${appointmentRow(e)}`).join('')}`:''}</div>`;
}
function dayAgendaCard(e){const canceled=e.estado==='cancelada',type=typeName(e.tipo);
 return`<button type="button" class="day-agenda-card ${canceled?'is-canceled':''}" style="--event-color:${escapeHtml(typeColor(e.tipo))}" data-action="view-event" data-id="${escapeHtml(e.id)}">
 <span class="day-agenda-color"></span><span class="day-agenda-body"><span class="agenda-category"><i></i>${escapeHtml(type)}${canceled?' · Cancelada':''}</span><strong>${escapeHtml(eventTitle(e))}</strong><span class="agenda-time">${ico('clock',14)} ${escapeHtml(eventTime(e))}</span>${e.tipo==='cita'?`<span class="agenda-service">${escapeHtml(serviceName(e))}${e.precio!=null?' · '+money(e.precio):''}</span>`:''}${e.notas?`<span class="agenda-note">${escapeHtml(e.notas.length>90?e.notas.slice(0,90)+'…':e.notas)}</span>`:''}</span>${ico('right')}</button>`;
}
function openDayView(f){selectedDay=f;currentMonth=f.slice(0,7)+'-01';if(page==='cal')render();
 const events=listDay(f),active=events.filter(e=>e.tipo==='cita'&&e.estado!=='cancelada');
 openSheet(`<div class="sheet-header"><div><div class="eyebrow">Agenda del día</div><h2>${escapeHtml(fmtFull(f))}</h2></div><button class="icon-btn" data-action="close" aria-label="Cerrar agenda">${ico('x')}</button></div>
 <div class="day-overview"><span><b>${events.length}</b> evento${events.length===1?'':'s'}</span><span><b>${active.length}</b> cita${active.length===1?'':'s'} activa${active.length===1?'':'s'}</span></div>
 <div class="day-list">${events.length?events.map(dayAgendaCard).join(''):empty('Este día está libre. Puedes agendar lo que necesites.','calendar')}</div>
 <button class="btn block" data-action="new-event" style="margin-top:16px">${ico('plus')} Agregar cita o evento</button>${active.length?`<p class="muted-note">Valor agendado: ${money(sumPlanned(active))}. No equivale a dinero cobrado.</p>`:''}
 <p class="form-hint" style="margin-top:12px;text-align:center">Selecciona cualquier tarjeta para ver todos sus detalles.</p>`, `Agenda del ${fmt(f)}`, 'day-sheet');
}

function clientsData(){return DB.clientas.map(c=>({...c,key:c.id,citas:DB.eventos.filter(e=>e.tipo==='cita'&&(e.clientaId===c.id||(!e.clientaId&&clientKey(e.clienta,e.tel)===clientKey(c.nombre,c.tel))))})).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));}
function clientCard(c){return`<button class="client-card" data-action="open-client" data-key="${escapeHtml(c.id)}"><span class="avatar">${escapeHtml(c.nombre.slice(0,1).toUpperCase())}</span><span class="client-details"><strong>${escapeHtml(c.nombre)}</strong><small>${c.citas.length} cita${c.citas.length===1?'':'s'}${c.tel?' · '+escapeHtml(c.tel):''}</small></span>${ico('right')}</button>`;}
function clientsHTML(){const term=clientQuery.toLocaleLowerCase('es').trim(),list=clientsData().filter(c=>c.nombre.toLocaleLowerCase('es').includes(term)||c.tel.includes(term));return list.length?list.map(clientCard).join(''):empty(term?'No encontré clientas con ese nombre o teléfono.':'Agrega una clienta o crea tu primera cita.','users')}
function renderClients(){return`<div class="page">${topBar()}<div class="page-title"><div><div class="eyebrow">Tus clientas</div><h1>Clientas</h1></div></div><button class="btn block" data-action="add-client">${ico('plus')} Agregar clienta</button><label class="search-field" style="margin-top:14px">${ico('search')}<input id="client-search" type="search" value="${escapeHtml(clientQuery)}" placeholder="Buscar por nombre o teléfono" aria-label="Buscar clientas" autocomplete="off"></label><p class="muted-note">Puedes guardarlas manualmente o al crear una cita. Nombre y teléfono iguales no se duplican.</p><div id="clients-list">${clientsHTML()}</div></div>`;}
function clientForm(existing=null){openSheet(`<div class="sheet-header"><h2>${existing?'Editar clienta':'Nueva clienta'}</h2><button class="icon-btn" data-action="close">${ico('x')}</button></div><form id="client-form" data-id="${escapeHtml(existing?.id||'')}"><div class="field"><label>Nombre *</label><input id="client-name" required maxlength="120" value="${escapeHtml(existing?.nombre||'')}" placeholder="Nombre de la clienta"></div><div class="field"><label>Teléfono (opcional)</label><input id="client-phone" type="tel" value="${escapeHtml(existing?.tel||'')}" placeholder="Número de teléfono"></div><button class="btn block" type="submit">${ico('check')} Guardar clienta</button></form>`,'Clienta');}
async function saveClient(){const name=$('#client-name').value.trim().replace(/\s+/g,' '),phone=$('#client-phone').value.trim(),editId=$('#client-form').dataset.id;if(!name)return alert('Escribe un nombre.');const found=DB.clientas.find(c=>c.id!==editId&&clientKey(c.nombre,c.tel)===clientKey(name,phone));if(found){alert('Esta clienta ya está registrada con el mismo nombre y teléfono.');return;}const ok=await changeData(()=>{const c=DB.clientas.find(c=>c.id===editId);if(c){c.nombre=name;c.tel=phone;for(const e of DB.eventos){if(e.clientaId===c.id){e.clienta=name;e.tel=phone}}}else DB.clientas.push({id:id('c'),nombre:name,tel:phone});},'Clienta guardada');if(ok)closeSheet();}
function typeForm(existing=null){openSheet(`<div class="sheet-header"><h2>${existing?'Editar tipo':'Nuevo tipo de evento'}</h2><button class="icon-btn" data-action="close">${ico('x')}</button></div><form id="type-form" data-id="${escapeHtml(existing?.id||'')}"><div class="field"><label>Nombre *</label><input id="type-name" required maxlength="40" value="${escapeHtml(existing?.nombre||'')}" placeholder="Ej. Capacitación"></div><div class="field"><label>Color en el calendario</label><input id="type-color" type="color" value="${escapeHtml(existing?.color||'#746397')}" style="height:52px"></div><button class="btn block" type="submit">Guardar tipo</button></form>`,'Tipo de evento');}
async function saveType(){const name=$('#type-name').value.trim(),color=$('#type-color').value,editId=$('#type-form').dataset.id;if(!name)return alert('Escribe un nombre.');if(DB.tiposEvento.some(t=>t.id!==editId&&cleanName(t.nombre)===cleanName(name)))return alert('Ya existe un tipo con ese nombre.');const ok=await changeData(()=>{const t=DB.tiposEvento.find(t=>t.id===editId);if(t){t.nombre=name;t.color=color;}else DB.tiposEvento.push({id:id('tipo'),nombre:name,color});},'Tipo de evento guardado');if(ok)closeSheet();}
function renderReport(){const y=reportMonth.slice(0,7),booked=DB.eventos.filter(e=>e.tipo==='cita'&&sameMonth(e.fecha,reportMonth));const active=booked.filter(appointmentActive),canceled=booked.filter(e=>e.estado==='cancelada'),realized=booked.filter(e=>e.estado==='realizada'),amount=sumPlanned(booked),average=active.length?amount/active.length:0;
 const byDay=new Map();active.forEach(e=>{const v=byDay.get(e.fecha)||{n:0,amount:0};v.n++;v.amount+=Number(e.precio)||0;byDay.set(e.fecha,v)});
 const days=[...byDay].sort((a,b)=>a[0].localeCompare(b[0]));
 return`<div class="page">${topBar()}<div class="page-title"><div><div class="eyebrow">Un vistazo a tu agenda</div><h1>Resumen</h1></div></div>${monthControls(reportMonth,'report-prev','report-next')}
 <div class="summary-feature"><div class="eyebrow">Valor de citas agendadas</div><div class="big">${money(amount)}</div><p>Estimación según precios guardados; no son pagos ni ingresos cobrados.</p></div>
 <div class="stats" style="margin-top:12px"><div class="stat"><div class="stat-value">${active.length}</div><div class="stat-label">Citas activas</div></div><div class="stat"><div class="stat-value">${realized.length}</div><div class="stat-label">Marcadas realizadas</div></div><div class="stat"><div class="stat-value">${canceled.length}</div><div class="stat-label">Canceladas</div></div></div>
 <div class="card" style="margin-top:15px"><div class="summary-row"><span>Precio promedio agendado</span><strong>${money(average)}</strong></div><div class="summary-row"><span>Días con citas</span><strong>${days.length}</strong></div></div>
 <div class="section-heading"><h2>Citas por día</h2></div>${days.length?`<div class="card">${days.map(([f,v])=>`<button class="summary-row" style="background:none;border-left:0;border-right:0;border-top:0;width:100%;color:var(--ink);text-align:left" data-action="report-day" data-date="${f}"><span><strong>${escapeHtml(fmt(f,{weekday:'short',day:'numeric',month:'short'}))}</strong><br><span class="subtle">${v.n} cita${v.n===1?'':'s'}</span></span><strong>${money(v.amount)} ${ico('right')}</strong></button>`).join('')}</div>`:empty('Todavía no hay citas en este mes.','chart')}</div>`;}
function renderSettings(){return`<div class="page">${topBar()}<div class="page-title"><div><div class="eyebrow">Todo a tu manera</div><h1>Ajustes</h1></div></div>
 <section class="settings-group"><h3>Servicios y precios</h3><p class="muted-note">Los cambios de precio y duración se aplican a las citas nuevas, no a las ya guardadas.</p>${DB.servicios.map(s=>`<div class="service-row"><div class="service-fields"><div><label for="name-${escapeHtml(s.id)}">Servicio</label><input id="name-${escapeHtml(s.id)}" data-service="${escapeHtml(s.id)}" data-field="nombre" value="${escapeHtml(s.nombre)}" aria-label="Nombre del servicio"></div><div><label>Precio ($)</label><input type="number" min="0" step="0.01" inputmode="decimal" data-service="${escapeHtml(s.id)}" data-field="precioBase" value="${escapeHtml(s.precioBase)}" aria-label="Precio base"></div><div><label>Minutos</label><input type="number" min="5" max="1440" step="5" inputmode="numeric" data-service="${escapeHtml(s.id)}" data-field="duracionMin" value="${escapeHtml(s.duracionMin)}" aria-label="Duración en minutos"></div></div><button class="icon-btn" data-action="delete-service" data-id="${escapeHtml(s.id)}" title="Eliminar servicio" aria-label="Eliminar ${escapeHtml(s.nombre)}">${ico('trash')}</button></div>`).join('')}
 <button class="btn secondary block" data-action="add-service">${ico('plus')} Añadir servicio</button></section>
 <section class="settings-group"><h3>Tipos de eventos</h3><p class="muted-note">Crea categorías y asigna un color para distinguirlas en el calendario. Las cuatro categorías iniciales se conservan.</p>${DB.tiposEvento.map(t=>`<div class="service-row"><span class="type-dot" style="background:${escapeHtml(t.color)}"></span><strong style="flex:1">${escapeHtml(t.nombre)}</strong><button class="icon-btn" data-action="edit-type" data-id="${escapeHtml(t.id)}" aria-label="Editar tipo">${ico('edit')}</button>${DEFAULT_TYPES.some(x=>x.id===t.id)?'':`<button class="icon-btn" data-action="delete-type" data-id="${escapeHtml(t.id)}" aria-label="Eliminar tipo">${ico('trash')}</button>`}</div>`).join('')}<button class="btn secondary block" data-action="add-type">${ico('plus')} Crear tipo de evento</button></section>
 <section class="settings-group"><h3>Copia de seguridad</h3><div class="setting-card"><h3>Guarda tus recuerdos y citas ♡</h3><p>Última copia: ${DB.ajustes.lastBackup?escapeHtml(new Date(DB.ajustes.lastBackup).toLocaleDateString('es-ES')):'ninguna'}. Guarda el archivo JSON en Archivos o iCloud Drive. Se recomienda una copia cada semana.</p><div class="btn-group"><button class="btn" data-action="export">${ico('download')} Guardar</button><button class="btn secondary" data-action="import">${ico('upload')} Restaurar</button></div></div>
 <div class="notice">${ico('alert')}<span>Safari y la app instalada pueden guardar agendas separadas. Usa siempre el icono del iPhone. Borrar la app o los datos de Safari puede eliminar la información local.</span></div></section>
 <section class="settings-group"><h3>Recordatorios automáticos</h3><div class="setting-card"><h3>${ico('clock')} Avisos en el iPhone</h3><p id="push-description">${escapeHtml(pushDescription())}</p><div class="btn-group"><button class="btn" data-action="push-enable">${ico('check')} ${DB.ajustes.pushEnabled?'Reconectar':'Activar avisos'}</button><button class="btn secondary" data-action="push-test" ${!DB.ajustes.pushEnabled?'disabled':''}>Enviar prueba</button></div><button class="btn secondary block" style="margin-top:10px" data-action="push-sync" ${!DB.ajustes.pushEnabled?'disabled':''}>Sincronizar recordatorios</button>${DB.ajustes.pushEnabled?'<button class="text-action" style="margin-top:12px" data-action="push-disable">Desactivar avisos</button>':''}<p class="form-hint">Necesita estar instalada desde Safari en la pantalla de inicio. La primera vez, permite las notificaciones del iPhone. Los avisos necesitan internet y podrían retrasarse. La agenda sigue siendo local.</p></div></section>
 <section class="settings-group"><h3>Aplicación</h3><div class="setting-card"><h3>Mis Citas · Mel</h3><p>Hecha con mucho cariño para Melissa. Versión ${VERSION}. Funciona sin conexión después de instalarla correctamente.</p><button class="btn secondary block" data-action="check-updates">Buscar actualizaciones</button></div></section></div>`;}
function toast(text){const node=$('#toast');node.textContent=text;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,3100)}
function openSheet(content,title,kind=''){const sheet=$('#sheet');sheet.className='sheet'+(kind?' '+kind:'');sheet.setAttribute('aria-label',title||'Ventana de la agenda');sheet.innerHTML=`<div class="sheet-handle"></div>${content}`;$('#overlay').hidden=false;showingSheet=true;document.body.style.overflow='hidden';$('#sheet').scrollTop=0;}
function closeSheet(){showingSheet=false;$('#overlay').hidden=true;document.body.style.overflow='';}
function detail(e){const d=f=>escapeHtml(f??''),pair=(label,value)=>value!==''&&value!=null?`<div class="detail-row"><span class="subtle">${label}</span><b>${d(value)}</b></div>`:'';
 const price=e.tipo==='cita'?pair('Precio',money(e.precio)):'';
 const status=e.tipo==='cita'?pair('Estado',stateLabel[e.estado]||stateLabel.agendada):'';
 const reminder=e.ini&&e.recordatorioMin>0?pair('Recordatorio',e.recordatorioMin>=1440?`${e.recordatorioMin/1440} día(s) antes`:`${e.recordatorioMin} minutos antes`):'';
 openSheet(`<div class="sheet-header"><div class="eyebrow">${page==='cal'?`<button class="back-to-day" data-action="back-day">${ico('left',14)} Volver al día</button>`:escapeHtml(typeName(e.tipo))}</div><button class="icon-btn" data-action="close" aria-label="Cerrar">${ico('x')}</button></div>
 <div class="detail-icon">${ico(e.tipo==='cita'?'flower':e.tipo==='bloqueo'?'block':'calendar')}</div><div class="detail-title"><h2>${d(eventTitle(e))}</h2><p class="muted">${d(fmtFull(e.fecha))}</p></div>
 ${pair('Horario',eventTime(e))}${reminder}${e.tipo==='cita'?pair('Servicio',serviceName(e))+price+status+pair('Clienta',e.clienta)+pair('Teléfono',e.tel):''}${pair('Notas',e.notas)}
 <div class="notice rose" style="margin-top:14px">${ico('clock')} ${e.recordatorioMin>0?(DB.ajustes.pushEnabled?(pushSyncStatus==='conectado'?'Aviso configurado en el servidor; su llegada depende de internet.':'Aviso pendiente de sincronizar con el servidor.'):'Aviso elegido, pero primero activa las notificaciones en Ajustes.'):'No hay avisos programados para este evento.'}</div>
 ${e.tipo==='cita'?`<button class="btn secondary block repeat-btn" data-action="repeat-event" data-id="${d(e.id)}">${ico('calendar')} Repetir esta cita</button>`:''}
 <div class="detail-actions"><button class="btn secondary" data-action="edit-event" data-id="${d(e.id)}">${ico('edit')} Editar</button><button class="btn danger" data-action="delete-event" data-id="${d(e.id)}">${ico('trash')} Eliminar</button></div>`,eventTitle(e));}
function eventForm(existing=null,initialDate=selectedDay,type='cita',client='',seed=null){
 const e=existing||seed||{tipo:type,fecha:initialDate||today(),ini:'10:00',fin:'11:00',servicioId:DB.servicios[0]?.id||'',precio:DB.servicios[0]?.precioBase||0,clienta:client,estado:'agendada',notas:'',tel:'',titulo:'',recordatorioMin:30};
 const clients=clientsData(),d=x=>escapeHtml(x??''),known=DB.servicios.some(s=>s.id===e.servicioId),selected=known?e.servicioId:'__custom';
 openSheet(`<div class="sheet-header"><h2>${existing?'Editar evento':seed?'Repetir cita':'Nueva cita'}</h2><button class="icon-btn" data-action="close" aria-label="Cerrar">${ico('x')}</button></div>
 ${seed?'<p class="notice rose">Datos copiados. Se sugiere una fecha 3 semanas después, que puedes cambiar antes de guardar.</p>':''}
 <form id="event-form" data-edit-id="${d(existing?.id||'')}" novalidate><div class="type-picker">${DB.tiposEvento.map(t=>`<label><input type="radio" name="tipo" value="${d(t.id)}" ${e.tipo===t.id?'checked':''}><span class="type-choice" style="--event-color:${d(t.color)}">${ico(t.id==='cita'?'flower':'calendar')}${d(t.nombre)}</span></label>`).join('')}</div>
 <div id="form-cita"><div class="field"><label for="f-client">Nombre de la clienta *</label><input id="f-client" list="known-clients" value="${d(e.clienta)}" placeholder="Ej. Ana Pérez" autocomplete="off"><datalist id="known-clients">${clients.map(c=>`<option value="${d(c.nombre)}"></option>`).join('')}</datalist></div>
 <div class="field"><label for="f-service">Servicio *</label><select id="f-service">${DB.servicios.map(s=>`<option value="${d(s.id)}" ${selected===s.id?'selected':''}>${d(s.nombre)}</option>`).join('')}<option value="__custom" ${selected==='__custom'?'selected':''}>✎ Escribir un servicio nuevo…</option></select><p class="form-hint">Elige uno guardado o escríbelo al agendar.</p></div>
 <div class="field is-hidden custom-service" id="form-custom-service"><label for="f-service-custom">Nombre del servicio *</label><input id="f-service-custom" maxlength="100" value="${d(selected==='__custom'?(e.servicioNombre||''):'')}" placeholder="Ej. Builder gel con diseño" autocomplete="off"><label class="check-field"><input type="checkbox" id="f-save-service"> Guardar en Mis servicios para futuras citas</label></div></div>
 <div class="field is-hidden" id="form-other"><label for="f-title">Título *</label><input id="f-title" value="${d(e.titulo)}" placeholder="Ej. Cita médica, vacaciones…"></div>
 <div class="field"><label for="f-date">Fecha *</label><input id="f-date" type="date" value="${d(e.fecha)}" required></div>
 <label class="check-field is-hidden" id="form-allday"><input type="checkbox" id="f-all-day" ${e.tipo!=='cita'&&!e.ini?'checked':''}> Todo el día</label>
 <div id="form-time" class="field-row"><div class="field"><label for="f-start-trigger">Hora de inicio *</label><button type="button" class="time-trigger" id="f-start-trigger" data-action="open-time" data-field="f-start">${ico('clock')} <span id="f-start-label">${fmtTime(e.ini||'10:00')}</span> ${ico('right',16)}</button><input type="hidden" id="f-start" value="${d(e.ini||'10:00')}"></div>
 <div class="field"><label for="f-end-trigger">Hora de fin *</label><button type="button" class="time-trigger" id="f-end-trigger" data-action="open-time" data-field="f-end">${ico('clock')} <span id="f-end-label">${fmtTime(e.fin||'11:00')}</span> ${ico('right',16)}</button><input type="hidden" id="f-end" value="${d(e.fin||'11:00')}"></div></div><p id="time-hint" class="form-hint">Desliza las ruedas para elegir la hora en formato AM/PM.</p>
 <div class="field" id="form-reminder"><label for="f-reminder">${ico('clock')} Recordarme antes</label><select id="f-reminder">${[[0,'Sin recordatorio'],[5,'5 minutos antes'],[10,'10 minutos antes'],[15,'15 minutos antes'],[30,'30 minutos antes'],[60,'1 hora antes'],[1440,'1 día antes'],['custom','Otro tiempo…']].map(([v,label])=>`<option value="${v}" ${Number.isInteger(+v)&&+v===Number(e.recordatorioMin||0)||v==='custom'&&!([0,5,10,15,30,60,1440].includes(Number(e.recordatorioMin||0)))?'selected':''}>${label}</option>`).join('')}</select><div class="field ${[0,5,10,15,30,60,1440].includes(Number(e.recordatorioMin||0))?'is-hidden':''}" id="custom-reminder"><label for="f-reminder-custom">Minutos antes (1 a 10080)</label><input id="f-reminder-custom" type="number" inputmode="numeric" min="1" max="10080" step="1" value="${d(e.recordatorioMin||45)}"></div><p class="form-hint">Al guardar se programará automáticamente si activaste los avisos en Ajustes.</p></div>
 <div id="form-price"><div class="field-row"><div class="field"><label for="f-price">Precio ($)</label><input type="number" id="f-price" step="0.01" min="0" inputmode="decimal" value="${d(e.precio??'')}"></div><div class="field"><label for="f-status">Estado</label><select id="f-status">${Object.entries(stateLabel).map(([key,label])=>`<option value="${key}" ${key===(e.estado||'agendada')?'selected':''}>${label}</option>`).join('')}</select></div></div>
 <div class="field"><label for="f-phone">Teléfono (opcional)</label><input type="tel" id="f-phone" value="${d(e.tel)}" placeholder="Ej. (832) 555-0101"></div></div>
 <div class="field"><label for="f-notes">Notas (opcional)</label><textarea id="f-notes" placeholder="Diseño, color, recordatorio especial…">${d(e.notas)}</textarea></div>
 <div class="form-actions"><button class="btn block" type="submit">${ico('check')} Guardar ${existing?'cambios':'evento'}</button></div></form>`,existing?'Editar evento':'Nueva cita');
 refreshFormVisibility();
}
function refreshFormVisibility(){const form=$('#event-form');if(!form)return;const type=form.querySelector('input[name=tipo]:checked')?.value||'cita',c=type==='cita',all=$('#f-all-day').checked;
 $('#form-cita').classList.toggle('is-hidden',!c);$('#form-other').classList.toggle('is-hidden',c);$('#form-price').classList.toggle('is-hidden',!c);
 $('#form-allday').classList.toggle('is-hidden',c);$('#form-time').classList.toggle('is-hidden',!c&&all);$('#time-hint').classList.toggle('is-hidden',!c&&all);
 $('#form-custom-service').classList.toggle('is-hidden',!c||$('#f-service').value!=='__custom');
 $('#form-reminder').classList.toggle('is-hidden',!c&&all);
}
function updateTimeLabel(field){const label=$(`#${field}-label`);if(label)label.textContent=fmtTime($(`#${field}`).value)}
function syncService(){const s=DB.servicios.find(v=>v.id===$('#f-service').value);refreshFormVisibility();if(!s){if($('#f-service').value==='__custom')$('#f-price').value='';return;}$('#f-price').value=s.precioBase;syncEndTime()}
function syncEndTime(){const s=DB.servicios.find(v=>v.id===$('#f-service').value);if(s&&$('#f-start').value){const end=addMinutes($('#f-start').value,s.duracionMin);if(end){$('#f-end').value=end;updateTimeLabel('f-end')}else toast('La duración supera la medianoche: ajusta la hora de fin.')}}
// Ruedas con desplazamiento táctil, que muestran formato 12 horas y guardan HH:MM en IndexedDB.
const WHEEL_HEIGHT=44;
function wheelColumn(name,options,selected){return`<div class="wheel-column"><div class="wheel-scroll" id="wheel-${name}" data-wheel="${name}" role="listbox" aria-label="${name==='hour'?'Hora':name==='minute'?'Minutos':'AM o PM'}">${options.map((text,index)=>`<button type="button" class="wheel-option ${index===selected?'wheel-selected':''}" data-action="wheel-choice" data-wheel="${name}" data-index="${index}" role="option" aria-selected="${index===selected}">${text}</button>`).join('')}</div></div>`}
function openTimePicker(field){const input=$(`#${field}`);if(!input)return;activeTimeField=field;const value=/^\d\d:\d\d$/.test(input.value)?input.value:'10:00',hh=+value.slice(0,2),mm=+value.slice(3),hour=(hh%12||12),ampm=hh>=12?1:0;
 const modal=$('#time-overlay');modal.innerHTML=`<div class="time-panel" role="dialog" aria-modal="true" aria-label="Selecciona la hora"><div class="sheet-handle"></div><div class="sheet-header"><div><div class="eyebrow">Seleccionar hora</div><h2>${field==='f-start'?'Hora de inicio':'Hora de fin'}</h2></div><button type="button" class="icon-btn" data-action="time-cancel" aria-label="Cerrar">${ico('x')}</button></div><div class="time-preview" id="time-preview">${fmtTime(value)}</div><div class="time-wheel-labels"><span>Hora</span><span>Minutos</span><span>Período</span></div><div class="time-wheels">${wheelColumn('hour',Array.from({length:12},(_,i)=>String(i+1)),hour-1)}${wheelColumn('minute',Array.from({length:60},(_,i)=>pad(i)),mm)}${wheelColumn('ampm',['AM','PM'],ampm)}</div><button class="btn block" data-action="time-save" type="button">${ico('check')} Elegir hora</button><p class="form-hint" style="text-align:center;margin-top:9px">Desliza hacia arriba o abajo para ajustar.</p></div>`;
 modal.hidden=false;requestAnimationFrame(()=>{for(const [wheel,index] of [['hour',hour-1],['minute',mm],['ampm',ampm]]){const el=$(`#wheel-${wheel}`);el.scrollTop=index*WHEEL_HEIGHT;el.dataset.index=index;paintWheel(el)}updateTimePreview()});
}
function paintWheel(el){const index=Math.max(0,Math.min(el.children.length-1,Math.round(el.scrollTop/WHEEL_HEIGHT)));el.dataset.index=index;for(let i=0;i<el.children.length;i++){const active=i===index;el.children[i].classList.toggle('wheel-selected',active);el.children[i].setAttribute('aria-selected',active)}updateTimePreview()}
function readWheel(name){const el=$(`#wheel-${name}`);return Math.max(0,Math.min(el.children.length-1,Math.round(el.scrollTop/WHEEL_HEIGHT)))}
function currentTimeWheel(){const h=readWheel('hour')+1,m=readWheel('minute'),pm=readWheel('ampm')===1;return `${pad(h%12+(pm?12:0))}:${pad(m)}`}
function updateTimePreview(){if($('#time-preview')&&!$('#time-overlay').hidden&&$('#wheel-hour'))$('#time-preview').textContent=fmtTime(currentTimeWheel())}
function closeTimePicker(){activeTimeField=null;$('#time-overlay').hidden=true;$('#time-overlay').innerHTML=''}
function saveTimePicker(){if(!activeTimeField)return;const field=activeTimeField,value=currentTimeWheel();$(`#${field}`).value=value;updateTimeLabel(field);closeTimePicker();if(field==='f-start')syncEndTime()}
async function saveEvent(){const form=$('#event-form');if(!form)return;const idBefore=form.dataset.editId,old=idBefore?DB.eventos.find(e=>e.id===idBefore):null;const type=form.querySelector('input[name=tipo]:checked').value,c=type==='cita',all=!c&&$('#f-all-day').checked,service=DB.servicios.find(s=>s.id===$('#f-service').value),customName=$('#f-service').value==='__custom'?$('#f-service-custom').value.trim().replace(/\s+/g,' '):'',saveCustom=c&&$('#f-service').value==='__custom'&&$('#f-save-service').checked;
 const selectedReminder=$('#f-reminder').value;const reminderMin=all?0:Number(selectedReminder==='custom'?$('#f-reminder-custom').value:selectedReminder);
 if(!Number.isSafeInteger(reminderMin)||reminderMin<0||reminderMin>10080)return alert('Los minutos del recordatorio deben estar entre 1 y 10080, o desactivados.');
 const e={...(old||{}),recordatorioMin:reminderMin,id:old?.id||id('e'),tipo:type,fecha:$('#f-date').value,ini:all?'':$('#f-start').value,fin:all?'':$('#f-end').value,
 clienta:c?$('#f-client').value.trim():'',servicioId:c?(service?.id||''):'',servicioNombre:c?(service?.nombre||customName):'',precio:c?Number($('#f-price').value||0):0,
 estado:c?$('#f-status').value:'',tel:c?$('#f-phone').value.trim():'',titulo:c?'':$('#f-title').value.trim(),notas:$('#f-notes').value.trim()};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(e.fecha)||Number.isNaN(parseDate(e.fecha).valueOf()))return alert('Selecciona una fecha válida.');
 if(c&&!e.clienta)return alert('Escribe el nombre de la clienta.');if(c&&!e.servicioNombre)return alert('Selecciona un servicio o escribe el nombre del nuevo servicio.');if(!c&&!e.titulo)return alert('Escribe un título.');
 if(!all&&(!e.ini||!e.fin||!timeValid(e)))return alert('Comprueba las horas: el fin debe ser posterior al inicio, en el mismo día.');
 if(c&&($('#f-price').value.trim()===''||!Number.isFinite(e.precio)||e.precio<0))return alert('Escribe el precio del servicio (puede ser 0).');
 if(e.recordatorioMin>0&&e.ini&&new Date(e.fecha+'T'+e.ini+':00').getTime()-e.recordatorioMin*60000<Date.now()+60000)return alert('La hora del recordatorio ya ha pasado o está a menos de un minuto. Selecciona menos tiempo de antelación o desactívalo.');
 const conflicts=DB.eventos.filter(other=>overlaps(e,other));if(conflicts.length&&!confirm(`Este horario se cruza con ${conflicts.map(eventTitle).join(', ')}. ¿Guardar de todos modos?`))return;
 const ok=await changeData(()=>{if(saveCustom){let existingService=DB.servicios.find(x=>cleanName(x.nombre)===cleanName(customName));if(!existingService){existingService={id:id('s'),nombre:customName,precioBase:e.precio,duracionMin:minutes(e.fin)-minutes(e.ini)};DB.servicios.push(existingService)}e.servicioId=existingService.id;}if(c){let person=DB.clientas.find(x=>clientKey(x.nombre,x.tel)===clientKey(e.clienta,e.tel));if(!person){person={id:id('c'),nombre:e.clienta,tel:e.tel};DB.clientas.push(person);}e.clientaId=person.id;}const i=DB.eventos.findIndex(x=>x.id===e.id);if(i===-1)DB.eventos.push(e);else DB.eventos[i]=e;},old?'Cambios guardados':'Evento guardado con cariño ♡');
 if(ok){selectedDay=e.fecha;currentMonth=e.fecha.slice(0,7)+'-01';closeSheet();if(page==='cal')openDayView(e.fecha);}
}
function openClient(key){const c=clientsData().find(v=>v.id===key);if(!c)return;const future=c.citas.filter(e=>e.fecha>=today()).sort((a,b)=>a.fecha.localeCompare(b.fecha));const past=c.citas.filter(e=>e.fecha<today()).sort((a,b)=>b.fecha.localeCompare(a.fecha));
 openSheet(`<div class="sheet-header"><h2>${escapeHtml(c.nombre)}</h2><button class="icon-btn" data-action="close">${ico('x')}</button></div><p class="muted">${c.citas.length} cita${c.citas.length===1?'':'s'} registradas ${c.tel?'· '+escapeHtml(c.tel):''}</p><button class="btn secondary block" data-action="edit-client" data-key="${escapeHtml(c.id)}">${ico('edit')} Editar clienta</button><button class="btn block" style="margin-top:15px" data-action="client-new" data-key="${escapeHtml(c.key)}">${ico('plus')} Nueva cita con ${escapeHtml(c.nombre)}</button><div class="section-heading"><h3>Próximas citas</h3></div>${future.length?future.map(e=>`<div class="tiny muted">${escapeHtml(fmt(e.fecha,{day:'numeric',month:'long',year:'numeric'}))}</div>${appointmentRow(e)}`).join(''):empty('Sin citas futuras.')}
 <div class="section-heading"><h3>Historial</h3></div>${past.length?past.map(e=>`<div class="tiny muted">${escapeHtml(fmt(e.fecha,{day:'numeric',month:'long',year:'numeric'}))}</div>${appointmentRow(e)}`).join(''):empty('Sin citas anteriores.')}`,c.nombre);
}
async function editService(node){const s=DB.servicios.find(x=>x.id===node.dataset.service);if(!s)return;const field=node.dataset.field;let value=node.value.trim();if(field==='nombre'){if(!value)return alert('Escribe el nombre del servicio.');}
 if(field==='precioBase'){value=Number(value);if(!Number.isFinite(value)||value<0)return alert('El precio debe ser mayor o igual a cero.');}
 if(field==='duracionMin'){value=Number(value);if(!Number.isFinite(value)||value<5||value>1440)return alert('La duración debe estar entre 5 y 1440 minutos.');}
 await changeData(()=>{s[field]=value;},'Servicio actualizado');}
async function removeEvent(eventId){const e=DB.eventos.find(v=>v.id===eventId);if(!e||!confirm(`¿Quieres eliminar «${eventTitle(e)}»? Esta acción no se puede deshacer.`))return;
 const ok=await changeData(()=>{DB.eventos=DB.eventos.filter(v=>v.id!==eventId)},'Evento eliminado');if(ok)closeSheet();}
async function removeService(serviceId){const s=DB.servicios.find(v=>v.id===serviceId);if(!s||!confirm(`¿Eliminar el servicio «${s.nombre}»? Las citas antiguas no se borrarán.`))return;
 await changeData(()=>{for(const e of DB.eventos){if(e.servicioId===serviceId&&!e.servicioNombre)e.servicioNombre=s.nombre;}DB.servicios=DB.servicios.filter(v=>v.id!==serviceId)},'Servicio eliminado');}

async function shareFile(filename,mime,text){const file=new File([text],filename,{type:mime});if(navigator.canShare?.({files:[file]})){
 try{await navigator.share({files:[file],title:filename});return true}catch(err){if(err.name==='AbortError')return false;console.warn('Compartir no disponible, se intentará descargar',err)}
 }
 const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return true;
}
async function exportBackup(){const backed=JSON.parse(JSON.stringify(DB));delete backed.ajustes.pushDeviceSecret;delete backed.ajustes.pushDeviceId;delete backed.ajustes.pushEnabled;delete backed.ajustes.pushTestPendingUntil;const snapshot=JSON.stringify(backed,null,2);try{const done=await shareFile(`mis-citas-mel-copia-${today()}.json`,'application/json',snapshot);
 if(done)await changeData(()=>{DB.ajustes.lastBackup=Date.now()},'Copia preparada. Confirma que se guardó en Archivos o iCloud.');
 }catch(err){console.error(err);alert('No se pudo crear la copia. Intenta de nuevo.')}}
async function importBackup(file){if(!file)return;try{
 const raw=JSON.parse(await file.text());if(!raw||!Array.isArray(raw.eventos)||!Array.isArray(raw.servicios))throw new Error('Formato no válido');
 const restored=normalizeData(raw);for(const k of ['pushDeviceId','pushDeviceSecret','pushEnabled']){if(DB.ajustes[k]!==undefined)restored.ajustes[k]=DB.ajustes[k];else delete restored.ajustes[k];}if(!confirm(`La copia contiene ${raw.eventos.length} eventos y ${raw.servicios.length} servicios. Reemplazará la agenda actual. ¿Ya guardaste una copia de los datos actuales? ¿Continuar?`))return;
 const ok=await changeData(()=>{DB=restored},'Copia restaurada correctamente');if(ok){closeSheet();openPage('inicio')}
 }catch(err){console.error(err);alert('No se pudo restaurar. Selecciona una copia JSON válida de Mis Citas.')}finally{$('#restore-input').value=''}}
const icsEscape=s=>String(s??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
function icalText(e){const d=e.fecha.replaceAll('-','');const dtstamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const alarm=trigger=>['BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Recordatorio de Mis Citas','TRIGGER:'+trigger,'END:VALARM'];
 let dates;if(e.ini){dates=[`DTSTART:${d}T${e.ini.replace(':','')}00`,`DTEND:${d}T${e.fin.replace(':','')}00`]}else{dates=[`DTSTART;VALUE=DATE:${d}`,`DTEND;VALUE=DATE:${advance(e.fecha,1).replaceAll('-','')}`]}
 const desc=[e.tipo==='cita'?serviceName(e):typeName(e.tipo),e.tipo==='cita'?money(e.precio):'',e.tel||'',e.notas||''].filter(Boolean).join(' · ');
 return['BEGIN:VCALENDAR','VERSION:2.0','CALSCALE:GREGORIAN','PRODID:-//Mis Citas Mel//ES','BEGIN:VEVENT',`UID:${e.id}@mis-citas-mel`,`DTSTAMP:${dtstamp}`,...dates,`SUMMARY:${icsEscape(eventTitle(e))}`,`DESCRIPTION:${icsEscape(desc)}`,...alarm(e.ini?'-P1D':'-PT15H'),...(e.ini?alarm('-PT1H'):[]),'END:VEVENT','END:VCALENDAR',''].join('\r\n');}
async function exportIcs(eventId){const e=DB.eventos.find(v=>v.id===eventId);if(!e)return;try{const ok=await shareFile(`mel-${e.fecha}.ics`,'text/calendar',icalText(e));if(ok)toast('Abre el archivo y confirma su incorporación a Calendario.')}
 catch(err){console.error(err);alert('No se pudo preparar el calendario.')}}
function showUpdate(worker){$('#update-banner').hidden=false;$('#update-button').onclick=()=>{forceReload=true;worker.postMessage('skip')};}
async function checkUpdates(){if(!updateRegistration){toast('La actualización se comprueba al instalar la app desde HTTPS.');return;}try{await updateRegistration.update();toast(updateRegistration.waiting?'Nueva versión lista para instalar.':'Búsqueda completada. Si hay una versión nueva, aparecerá arriba.')}catch{toast('No se pudo comprobar. Revisa tu conexión.')}}
async function registerWorker(){if(!('serviceWorker'in navigator))return;try{
 const reg=await navigator.serviceWorker.register('./sw.js');updateRegistration=reg;
 if(reg.waiting&&navigator.serviceWorker.controller)showUpdate(reg.waiting);
 reg.addEventListener('updatefound',()=>{const sw=reg.installing;if(sw)sw.addEventListener('statechange',()=>{if(sw.state==='installed'&&navigator.serviceWorker.controller)showUpdate(sw)})});
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(forceReload)location.reload()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){reg.update().catch(()=>{});if(DB?.ajustes?.pushEnabled)queuePushSync();}});
 }catch(err){console.warn('Sin service worker',err)}}


// ─── Notificaciones Push: sin Calendario de Apple, solo fechas/horas en Cloudflare ───
function pushConfig(){const c=window.MEL_PUSH_CONFIG||{};return {url:String(c.apiUrl||'').trim().replace(/\/$/,''),key:String(c.vapidPublicKey||'').trim()}}
function pushIsConfigured(){const c=pushConfig();return /^https:\/\/[^ ]+\.workers\.dev$/.test(c.url)&&/^[A-Za-z0-9_-]{80,100}$/.test(c.key)}
function pushDescription(){if(!pushIsConfigured())return 'Falta configurar el servicio gratuito. Consulta la guía para quien publicó la app.';if(!DB.ajustes.pushEnabled)return 'Avisos desactivados. Toca «Activar avisos» desde el icono de la pantalla de inicio.';if(Notification.permission!=='granted')return 'El iPhone tiene bloqueado el permiso de notificaciones; reactívalo en Ajustes del iPhone.';return pushSyncStatus==='conectado'?'Avisos conectados. Las horas ya están sincronizadas.':pushSyncStatus==='pendiente'?'Guardado localmente; avisos pendientes de conexión.':'Avisos activados; comprobando conexión.'}
function pushRandom(){const b=crypto.getRandomValues(new Uint8Array(32));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
function decodePublicKey(raw){const base64=raw.replace(/-/g,'+').replace(/_/g,'/');const bytes=atob(base64+'='.repeat((4-base64.length%4)%4));return Uint8Array.from(bytes,c=>c.charCodeAt(0))}
async function pushAPI(path,data){const res=await fetch(pushConfig().url+'/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});let ans={};try{ans=await res.json()}catch{}if(!res.ok)throw new Error(ans.error||'Fallo del servicio de recordatorios (HTTP '+res.status+')');return ans}
function pushIdentity(){return {deviceId:DB.ajustes.pushDeviceId,deviceSecret:DB.ajustes.pushDeviceSecret}}
function wantedReminders(){const now=Date.now();return DB.eventos.filter(e=>e.ini&&e.recordatorioMin>0&&e.estado!=='cancelada').map(e=>({id:e.id,notifyAt:new Date(e.fecha+'T'+e.ini+':00').getTime()-e.recordatorioMin*60000})).filter(r=>Number.isFinite(r.notifyAt)&&r.notifyAt>now+2000&&r.notifyAt<now+120*86400000).slice(0,400)}
function queuePushSync(showMessage=false){if(!DB?.ajustes?.pushEnabled||!pushIsConfigured()){if(showMessage)toast('Activa las notificaciones antes de sincronizar.');return Promise.resolve(false)}
 pushSyncQueue=pushSyncQueue.catch(()=>{}).then(async()=>{try{const res=await pushAPI('sync',{...pushIdentity(),reminders:wantedReminders()});pushSyncStatus='conectado';if(showMessage)toast(`Listo: ${res.programados} avisos sincronizados.`);if(page==='aj')render();return true}catch(err){pushSyncStatus='pendiente';if(showMessage)alert('No se pudo sincronizar: '+err.message);if(page==='aj')render();return false}});return pushSyncQueue;
}
async function enablePush(){if(!pushIsConfigured())return alert('Todavía falta configurar el servidor de avisos. Pide a quien instaló la app que complete push-config.js.');
 if(!updateRegistration||!('PushManager' in window)||!('Notification' in window))return alert('Este navegador no permite avisos Push. Abre Mis Citas desde el icono instalado en el iPhone.');
 if(!window.matchMedia('(display-mode: standalone)').matches&&!navigator.standalone)return alert('En iPhone, abre primero la aplicación desde el icono añadido a la pantalla de inicio.');
 try{const promise=updateRegistration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodePublicKey(pushConfig().key)});const subscription=await promise;
 const existing=pushIdentity();DB.ajustes.pushDeviceId=existing.deviceId||pushRandom();DB.ajustes.pushDeviceSecret=existing.deviceSecret||pushRandom();await persistDB();
 await pushAPI('subscribe',{...pushIdentity(),endpoint:subscription.endpoint});await changeData(()=>{DB.ajustes.pushEnabled=true},'¡Avisos activados!');await queuePushSync(true);
 }catch(err){console.error('No pudo activar avisos',err);alert('No se pudieron activar los avisos: '+err.message+'. Si denegaste el permiso, revísalo en Ajustes del iPhone.');}}
async function testPush(){if(!DB.ajustes.pushEnabled)return alert('Activa los avisos antes de probarlos.');try{await changeData(()=>{DB.ajustes.pushTestPendingUntil=Date.now()+120000});await pushAPI('test',pushIdentity());toast('Prueba enviada; espera unos segundos. Comprueba las notificaciones del iPhone.')}catch(err){alert('No se pudo enviar la prueba: '+err.message)}}
async function disablePush(){if(!confirm('¿Dejar de recibir avisos de esta agenda? Las citas se conservarán.'))return;try{await pushAPI('disable',pushIdentity());await (await updateRegistration?.pushManager?.getSubscription())?.unsubscribe();await changeData(()=>{DB.ajustes.pushEnabled=false},'Avisos desactivados');pushSyncStatus='sin-configurar'}catch(err){alert('No se pudieron desactivar en el servidor. Inténtalo con conexión: '+err.message)}}

// Delegación de eventos: elimina la fragilidad de onclick="..." de la versión anterior.
document.addEventListener('click',async event=>{
 if(event.target===$('#time-overlay')){closeTimePicker();return}if(event.target===$('#overlay')){closeSheet();return}
 const target=event.target.closest('[data-action]');if(!target)return;
 const action=target.dataset.action,datum=target.dataset;
 switch(action){
  case 'page':openPage(datum.page);break;
  case 'cal-go':openPage('cal');break;
  case 'backup-go':openPage('aj');break;
  case 'today':selectedDay=today();currentMonth=today().slice(0,7)+'-01';render();break;
  case 'month-prev':currentMonth=monthMove(currentMonth,-1);selectedDay=currentMonth;render();break;
  case 'month-next':currentMonth=monthMove(currentMonth,1);selectedDay=currentMonth;render();break;
  case 'select-day':openDayView(datum.date);break;
  case 'back-day':openDayView(selectedDay);break;
  case 'report-prev':reportMonth=monthMove(reportMonth,-1);render();break;
  case 'report-next':reportMonth=monthMove(reportMonth,1);render();break;
  case 'report-day':selectedDay=datum.date;currentMonth=datum.date.slice(0,7)+'-01';openPage('cal');openDayView(datum.date);break;
  case 'new-event':eventForm(null,page==='cal'?selectedDay:today());break;
  case 'new-block':eventForm(null,today(),'bloqueo');break;
  case 'view-event':{const e=DB.eventos.find(e=>e.id===datum.id);if(e){selectedDay=e.fecha;detail(e);}break;}
  case 'repeat-event':{const e=DB.eventos.find(e=>e.id===datum.id);if(e&&e.tipo==='cita'){const nextDate=advance(e.fecha,21);eventForm(null,nextDate,'cita',e.clienta,{...e,id:'',fecha:nextDate,estado:'agendada'});}break;}
  case 'open-time':openTimePicker(datum.field);break;
  case 'time-cancel':closeTimePicker();break;
  case 'time-save':saveTimePicker();break;
  case 'wheel-choice':{const wheel=$(`#wheel-${datum.wheel}`);if(wheel){wheel.scrollTop=Number(datum.index)*WHEEL_HEIGHT;paintWheel(wheel);}break;}
  case 'edit-event':{const e=DB.eventos.find(e=>e.id===datum.id);if(e)eventForm(e);break;}
  case 'delete-event':await removeEvent(datum.id);break;
  case 'close':closeSheet();break;
  case 'ics':await exportIcs(datum.id);break;
  case 'open-client':openClient(datum.key);break;
  case 'client-new':{const c=clientsData().find(v=>v.id===datum.key);if(c){eventForm(null,today(),'cita',c.nombre);$('#f-phone').value=c.tel||'';}break;}
  case 'add-client':clientForm();break;
  case 'edit-client':{const c=DB.clientas.find(x=>x.id===datum.key);if(c)clientForm(c);break;}
  case 'add-type':typeForm();break;
  case 'edit-type':{const t=DB.tiposEvento.find(x=>x.id===datum.id);if(t)typeForm(t);break;}
  case 'delete-type':{const t=DB.tiposEvento.find(x=>x.id===datum.id);if(t&&!DB.eventos.some(e=>e.tipo===t.id)&&confirm('¿Eliminar este tipo de evento?'))await changeData(()=>DB.tiposEvento=DB.tiposEvento.filter(x=>x.id!==t.id),'Tipo eliminado');else if(t&&DB.eventos.some(e=>e.tipo===t.id))alert('Este tipo tiene eventos guardados. No puede eliminarse.');break;}
  case 'add-service':await changeData(()=>DB.servicios.push({id:id('s'),nombre:'Nuevo servicio',precioBase:0,duracionMin:60}),'Nuevo servicio añadido');break;
  case 'delete-service':await removeService(datum.id);break;
  case 'export':await exportBackup();break;
  case 'import':$('#restore-input').click();break;
  case 'check-updates':await checkUpdates();break;
  case 'push-enable':await enablePush();break;
  case 'push-test':await testPush();break;
  case 'push-sync':await queuePushSync(true);break;
  case 'push-disable':await disablePush();break;
 }
});
document.addEventListener('change',async event=>{
 const target=event.target;
 if(target.matches('[data-service][data-field]')){await editService(target);return}
 if(target.id==='restore-input'){await importBackup(target.files?.[0]);return}
 if(!target.closest('#event-form'))return;
 if(target.name==='tipo'){if(target.value==='festivo')$('#f-all-day').checked=true;refreshFormVisibility();return}
 if(target.id==='f-all-day'){refreshFormVisibility();return}
 if(target.id==='f-client'){const matches=DB.clientas.filter(c=>cleanName(c.nombre)===cleanName(target.value));if(matches.length===1&&!$('#f-phone').value.trim())$('#f-phone').value=matches[0].tel||'';return}
 if(target.id==='f-service'){syncService();return}
 if(target.id==='f-reminder'){$('#custom-reminder').classList.toggle('is-hidden',target.value!=='custom');return}
 if(target.id==='f-start'){syncEndTime()}
});
document.addEventListener('input',event=>{if(event.target.id==='client-search'){clientQuery=event.target.value;$('#clients-list').innerHTML=clientsHTML();}});
document.addEventListener('scroll',event=>{const el=event.target;if(el?.classList?.contains('wheel-scroll'))paintWheel(el)},true);
document.addEventListener('submit',async event=>{if(event.target.id==='client-form'){event.preventDefault();await saveClient();return;}if(event.target.id==='type-form'){event.preventDefault();await saveType();return;}if(event.target.id!=='event-form')return;event.preventDefault();const button=event.target.querySelector('button[type=submit]');button.disabled=true;try{await saveEvent()}finally{if(button.isConnected)button.disabled=false}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('#time-overlay').hidden)closeTimePicker();else if(showingSheet)closeSheet()}});
(async function boot(){try{
 const stored=await readDB();DB=normalizeData(stored);if(stored&&Number(stored.v||1)<DATA_VERSION)await persistDB();
 // Solicitar protección adicional sin asumir que iOS la concede.
 try{await navigator.storage?.persist?.()}catch{}
 render();await registerWorker();if(DB.ajustes.pushEnabled)queuePushSync();
 }catch(err){console.error(err);$('#storage-warning').hidden=false;$('#content').innerHTML=`<div class="empty" style="margin-top:40px">${ico('alert')}<h2>No se puede abrir la agenda local</h2><p>Comprueba los permisos de almacenamiento del navegador. No se han borrado tus datos.</p></div>`}})();

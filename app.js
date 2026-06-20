import { cloudEnabled, getSession, loadCloudState, signIn, signOut, syncCloudState } from "./cloud.js";

const STORAGE_KEY = "janos-control-v1";
const MANAGED_SALONS = ["Quinta", "Pilar Hotel"];
const STATUS_LABELS = { pending: "Pendiente", waiting: "Esperando cliente", progress: "En proceso", done: "Terminado", na: "No corresponde" };
const RENDITION_STATUS = { pending: "Pendiente", submitted: "Rendido", approved: "Aprobado", paid: "Pagado" };

const ADDONS = [
  ["pant", "Pantalla"], ["pixel", "Pixel"], ["miniflex", "Mini Flex"], ["flex", "Flex"],
  ["libro", "Libro Combo"], ["maqui", "Maquillaje"], ["moda", "Producción de Moda"],
  ["drone", "Drone"], ["vipExtras", "Extras VIP"]
];

const FLEX_SERVICES = [
  ["church", "Iglesia o templo"], ["civil", "Civil"], ["droneEvent", "Drone en recepción"],
  ["droneBook", "Drone en sesión"], ["photoExtra", "Fotógrafo extra"], ["videoExtra", "Videógrafo extra"],
  ["signatureBook", "Libro de firmas"], ["partyBook", "Libro de fiesta"], ["liveEditor", "Editor en vivo"],
  ["friendsVideo", "Video con amigos"], ["extraSession", "Sesión extra"]
];

const BASE_RATES = {
  gold: 325000, silver: 227500, book: 97500, eventCoverage: 160000, eventEdit: 67500,
  bookCoverage: 68000, bookEdit: 29500, informal: 160000, informalRecording: 110000,
  ceremony: 25000, ceremonyRecording: 14000, ceremonyEdit: 11000, drone: 37000,
  photoExtra: 160000, videoExtra: 160000, liveEditor: 160000, signatureDesign: 30000,
  partyBookDesign: 40000, videoExtraClip: 25000, albumInteractive: 16000, droneEdit: 20000,
  assistant: 18000, extraSheet: 6000, churchUpgrade: 60000, totemDigital: 10000,
  bookModa: 30000
};

const CORE_TASKS = [
  task("contact", "Contactar al cliente y explicar el servicio", "Preparación"),
  task("verify", "Verificar pack, upgrades y elecciones", "Preparación"),
  task("coverage", "Realizar cobertura del evento", "Evento", true, "PERSONAL FOTOGRAFIA", "Fiesta (cobertura y edicion)", "silver"),
  task("backup", "Completar backup del salón", "Evento"),
  task("photoEdit", "Editar fotografías del evento", "Post-evento"),
  task("video20", "Editar video principal de aproximadamente 20 minutos", "Post-evento"),
  task("videoSummary", "Editar video resumen", "Post-evento"),
  task("sendPhotos", "Enviar link de fotografías por e-mail", "Entrega"),
  task("sendVideo", "Enviar link de videos por e-mail", "Entrega")
];

const GOLD_TASKS = [
  task("coordinateSession", "Coordinar y reservar sesión de fotos", "Pre-evento"),
  task("bookCoverage", "Realizar sesión de fotos y video", "Pre-evento", true, "PERSONAL FOTOGRAFIA", "Sesion de fotos (cobertura + edicion)", "book"),
  task("backstage", "Editar video backstage", "Pre-evento"),
  task("mural", "Preparar mural digital", "Pre-evento")
];

const VIP_TASKS = [
  task("vipDrone", "Realizar drone en exteriores", "Servicios VIP", true, "COMPLEMENTOS", "Drone en evento", "drone"),
  task("vipLive", "Realizar edición en vivo", "Servicios VIP", true, "COMPLEMENTOS", "Edicion en vivo video", "liveEditor"),
  task("vipPhotoExtra", "Cubrir como fotógrafo adicional, si fue el elegido", "Servicios VIP", true, "COMPLEMENTOS", "Fiesta (segundo fotografo)", "photoExtra"),
  task("vipVideoExtra", "Cubrir como videógrafo adicional, si fue el elegido", "Servicios VIP", true, "COMPLEMENTOS", "Fiesta (segundo videógrafo)", "videoExtra")
];

const FLEX_TASKS = {
  church: task("flexChurch", "Cubrir iglesia o templo", "Servicios elegidos", true, "PERSONAL FOTOGRAFIA", "Iglesia (servicio extra por upgrade)", "churchUpgrade"),
  civil: task("flexCivil", "Cubrir ceremonia civil", "Servicios elegidos", true, "PERSONAL FOTOGRAFIA", "Civil", "book"),
  droneEvent: task("flexDroneEvent", "Realizar drone en recepción", "Servicios elegidos", true, "COMPLEMENTOS", "Drone en evento", "drone"),
  droneBook: task("flexDroneBook", "Realizar drone en sesión", "Servicios elegidos", true, "COMPLEMENTOS", "Drone en sesión de fotos", "drone"),
  photoExtra: task("flexPhotoExtra", "Cubrir evento como fotógrafo extra", "Servicios elegidos", true, "COMPLEMENTOS", "Fiesta (segundo fotografo)", "photoExtra"),
  videoExtra: task("flexVideoExtra", "Cubrir evento como videógrafo extra", "Servicios elegidos", true, "COMPLEMENTOS", "Fiesta (segundo videógrafo)", "videoExtra"),
  signatureBook: task("flexSignature", "Diseñar libro de firmas y mural", "Servicios elegidos", true, "COMPLEMENTOS", "Libro firmas (Fotografia Digital)", "signatureDesign"),
  partyBook: task("flexPartyBook", "Diseñar libro de fotos de la fiesta", "Servicios elegidos", true, "COMPLEMENTOS", "Libro Fiesta (Fotografia Digital)", "partyBookDesign"),
  liveEditor: task("flexLive", "Realizar edición en vivo", "Servicios elegidos", true, "COMPLEMENTOS", "Edicion en vivo video", "liveEditor"),
  friendsVideo: task("flexFriends", "Realizar video con amigos", "Servicios elegidos", true, "COMPLEMENTOS", "Video con amigos", "book"),
  extraSession: task("flexSession", "Realizar sesión extra con entrega digital", "Servicios elegidos", true, "PERSONAL FOTOGRAFIA", "Sesion de fotos (cobertura + edicion)", "book")
};

function task(key, title, phase, payable = false, category = "", work = "", rateKey = "") {
  return { key, title, phase, payable, category, work, rateKey };
}

function initialState() {
  return { clients: [], renditions: [], rates: { ...BASE_RATES }, settings: { currency: "ARS" }, seeded: false };
}

let state = loadState();
let activeView = "dashboard";
let currentUser = null;
let cloudTimer = null;
let cloudSyncing = false;

function loadState() {
  try { return { ...initialState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; }
  catch { return initialState(); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); render(); scheduleCloudSync(); }
function uid() { return crypto.randomUUID(); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c])); }
function parseDate(value) { return value ? new Date(`${value}T12:00:00`) : new Date(); }
function dateText(value) { return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parseDate(value)); }
function monthText(value) { return new Intl.DateTimeFormat("es-AR", { month: "short" }).format(parseDate(value)).replace(".", ""); }
function money(value) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0); }
function daysUntil(value) { return Math.ceil((parseDate(value) - new Date()) / 86400000); }
function packLabel(pack) { return ({ silver: "Silver", gold: "Golden / All Inclusive", vip: "VIP", informal: "Informal" })[pack] || pack; }

function createTasks(client) {
  let definitions = [];
  if (client.pack === "informal") {
    definitions = [task("contact", "Contactar al cliente y confirmar cobertura", "Preparación"), task("informal", "Realizar evento informal", "Evento", true, "PERSONAL FOTOGRAFIA", "Evento Informal", "informal"), task("backup", "Completar backup del salón", "Evento"), task("sendPhotos", "Editar y enviar fotografías", "Entrega")];
  } else {
    definitions = [...CORE_TASKS];
    if (["gold", "vip"].includes(client.pack)) definitions.splice(2, 0, ...GOLD_TASKS);
    if (client.pack === "vip") definitions.push(...VIP_TASKS);
  }
  if (client.addons.includes("pant")) definitions.push(task("screenVideo", "Preparar video de entrada para pantalla", "Pre-evento", true, "COMPLEMENTOS", "Video de entrada para pantalla", "videoExtraClip"));
  if (client.addons.includes("pixel")) definitions.push(task("pixelCheck", "Confirmar contenido y funcionamiento de Pixel", "Pre-evento"));
  if (client.addons.includes("moda")) definitions.push(task("bookModa", "Realizar adicional de book con producción de moda", "Pre-evento", true, "PERSONAL FOTOGRAFIA", "Adicional book con Moda", "bookModa"));
  if (client.addons.includes("libro")) definitions.push(
    task("signatureBook", "Diseñar libro de firmas", "Pre-evento", true, "COMPLEMENTOS", "Libro firmas (Fotografia Digital)", "signatureDesign"),
    task("partyBook", "Diseñar y enviar libro de fiesta al laboratorio", "Entrega", true, "COMPLEMENTOS", "Libro Fiesta (Fotografia Digital)", "partyBookDesign")
  );
  client.flexServices.forEach(code => { if (FLEX_TASKS[code]) definitions.push(FLEX_TASKS[code]); });
  const hasSession = definitions.some(item => ["bookCoverage", "flexSession"].includes(item.key));
  if (hasSession) definitions.push(task("totemDigital", "Preparar tótem digital de la sesión", "Pre-evento", true, "COMPLEMENTOS", "Televisor Fotografia Digital", "totemDigital"));
  return definitions.map(def => ({ ...def, id: uid("task"), status: "pending", responsible: "", completedAt: "", notes: "" }));
}

function isoDate(value){return value?String(value).slice(0,10):"";}
function todayIso(){return new Date().toISOString().slice(0,10);}
function periodEndFor(workDate){const date=parseDate(workDate);if(date.getDate()>20)date.setMonth(date.getMonth()+1);date.setDate(20);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-20`;}

function render() {
  renderDashboard(); renderClients(); renderRenditions(); renderSettings();
  document.getElementById("navRenditionCount").textContent = state.renditions.filter(r => r.status === "pending").length;
}

function renderDashboard() {
  const pendingTasks = state.clients.flatMap(c => c.tasks).filter(t => !["done", "na"].includes(t.status)).length;
  const pendingR = state.renditions.filter(r => r.status === "pending");
  const nextEvents = [...state.clients].filter(c => daysUntil(c.eventDate) >= -30).sort((a,b) => parseDate(a.eventDate) - parseDate(b.eventDate)).slice(0, 7);
  const waiting = state.clients.flatMap(c => c.tasks).filter(t => t.status === "waiting").length;
  document.getElementById("dashboardView").innerHTML = `
    <div class="kpi-grid">
      ${kpi("Clientes activos", state.clients.length, "eventos registrados")}
      ${kpi("Tareas pendientes", pendingTasks, waiting ? `${waiting} esperando al cliente` : "sin bloqueos registrados")}
      ${kpi("Para rendir", pendingR.length, money(pendingR.reduce((s,r)=>s+r.amount,0)))}
      ${kpi("Próximos 30 días", state.clients.filter(c => { const d=daysUntil(c.eventDate); return d>=0&&d<=30; }).length, "eventos por preparar")}
    </div>
    <div class="content-grid">
      <div class="panel"><div class="panel-head"><h2>Próximos eventos</h2><button class="ghost-btn" data-go="clients">Ver todos</button></div>
        ${nextEvents.length ? `<div>${nextEvents.map(eventRow).join("")}</div>` : empty("Todavía no hay clientes", "Cargá el primero para generar su plan de trabajo.")}
      </div>
      <div class="panel"><div class="panel-head"><h2>Atención requerida</h2></div><div class="panel-body stack">
        ${attentionItems() || `<div class="empty"><strong>Todo en orden</strong>No hay alertas urgentes.</div>`}
      </div></div>
    </div>`;
}
function kpi(label, value, note) { return `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }
function eventRow(c) { const d=parseDate(c.eventDate), pct=progress(c); return `<div class="event-row"><div class="date-box"><strong>${String(d.getDate()).padStart(2,"0")}</strong><span>${monthText(c.eventDate)}</span></div><div class="event-name"><strong>${escapeHtml(c.honoree)}</strong><span>#${escapeHtml(c.code)} · ${escapeHtml(c.salon)}</span></div><span class="tag">${packLabel(c.pack)}</span><span class="muted">${pct}% completo</span><button class="secondary-btn" data-open-client="${c.id}">Abrir</button></div>`; }
function attentionItems() {
  const items=[];
  state.clients.forEach(c => {
    const days=daysUntil(c.eventDate), incomplete=c.tasks.filter(t=>!["done","na"].includes(t.status));
    if(days>=0&&days<=14&&incomplete.length) items.push(`<button class="ghost-btn" data-open-client="${c.id}"><strong>${escapeHtml(c.honoree)}</strong><br><small>Faltan ${days} días · ${incomplete.length} tareas abiertas</small></button>`);
    if(days<0&&c.tasks.some(t=>t.key==="coverage"&&t.status!=="done")) items.push(`<button class="ghost-btn" data-open-client="${c.id}"><strong>${escapeHtml(c.honoree)}</strong><br><small>Cobertura sin confirmar</small></button>`);
  }); return items.slice(0,6).join("");
}

function renderClients() {
  const salons=[...new Set([...MANAGED_SALONS,...state.clients.map(c=>String(c.salon||"").trim()).filter(Boolean)])];
  const months=[...new Set(state.clients.map(c=>monthKey(c.eventDate)).filter(Boolean))].sort();
  document.getElementById("clientsView").innerHTML = `<div class="client-filters"><div class="filter-heading"><div><p class="eyebrow">Organizar eventos</p><strong>Elegí un salón y un mes</strong></div><span id="clientResultCount" class="muted">${eventCountLabel(state.clients.length)}</span></div><div class="toolbar"><div class="search"><input id="clientSearch" placeholder="Buscar por nombre o código"></div><select id="clientSalonFilter" aria-label="Filtrar por salón"><option value="">Todos los salones</option>${salons.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}</select><select id="clientMonthFilter" aria-label="Filtrar por mes"><option value="">Todos los meses</option>${months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join("")}</select><select id="clientPackFilter" aria-label="Filtrar por pack"><option value="">Todos los packs</option><option value="silver">Silver</option><option value="gold">Golden / All Inclusive</option><option value="vip">VIP</option><option value="informal">Informal</option></select></div></div><div class="client-actions"><button class="secondary-btn" id="downloadClientTemplate">Plantilla CSV</button><button class="primary-btn" id="importClientsBtn">Importar lote</button><input id="clientCsvInput" type="file" accept=".csv,text/csv" hidden></div><div id="clientGrid" class="client-grid">${clientCards(state.clients)}</div>`;
}
function monthKey(value){return /^\d{4}-\d{2}/.test(String(value||""))?String(value).slice(0,7):"";}
function monthLabel(value){const [year,month]=String(value).split("-");if(!year||!month)return value;const label=new Intl.DateTimeFormat("es-AR",{month:"long",year:"numeric"}).format(new Date(Number(year),Number(month)-1,1));return label.charAt(0).toUpperCase()+label.slice(1);}
function eventCountLabel(count){return `${count} ${count===1?"evento":"eventos"}`;}
function clientCards(clients) { return clients.length ? [...clients].sort((a,b)=>parseDate(a.eventDate)-parseDate(b.eventDate)).map(c => `<article class="client-card"><div class="client-card-top"><span class="tag">${packLabel(c.pack)}</span><span class="muted">${dateText(c.eventDate)}</span></div><h3>${escapeHtml(c.honoree)}</h3><p>#${escapeHtml(c.code)} · ${escapeHtml(c.salon)} · ${escapeHtml(c.type)}</p><div class="progress-line"><i style="width:${progress(c)}%"></i></div><div class="card-meta"><span>${progress(c)}% completo</span><span>${c.tasks.filter(t=>t.status==="pending").length} pendientes</span></div><div class="card-actions"><button class="secondary-btn" data-open-client="${c.id}">Ver tareas</button><button class="ghost-btn" data-edit-client="${c.id}">Editar</button></div></article>`).join("") : empty("No hay eventos para estos filtros", "Probá otro salón, mes o criterio de búsqueda."); }
function progress(c) { const applicable=c.tasks.filter(t=>t.status!=="na"); return applicable.length ? Math.round(applicable.filter(t=>t.status==="done").length/applicable.length*100) : 0; }
function empty(title, text) { return `<div class="empty"><strong>${title}</strong>${text}</div>`; }

function renderRenditions() {
  const rows=[...state.renditions].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  document.getElementById("renditionsView").innerHTML = `<div class="toolbar"><select id="renditionFilter"><option value="">Todos los estados</option>${Object.entries(RENDITION_STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></div><div class="panel"><div class="rendition-row header"><span>Trabajo</span><span>Evento</span><span>Categoría</span><span>Importe</span><span>Estado</span></div><div id="renditionRows">${renditionRows(rows)}</div></div>`;
}
function renditionRows(rows) { return rows.length ? rows.map(r=>{const c=state.clients.find(x=>x.id===r.clientId); return `<div class="rendition-row"><div><strong>${escapeHtml(r.work)}</strong><small>${escapeHtml(c?.honoree||"Cliente eliminado")} · realizado ${r.workDate?dateText(r.workDate):"sin fecha"}</small></div><span>${c?dateText(c.eventDate):"-"}</span><span class="muted">${escapeHtml(r.category)}<br><small>Cierre ${r.periodEnd?dateText(r.periodEnd):"-"}</small></span><span class="money">${money(r.amount)}</span><select data-rendition-status="${r.id}">${Object.entries(RENDITION_STATUS).map(([k,v])=>`<option value="${k}" ${r.status===k?"selected":""}>${v}</option>`).join("")}</select></div>`;}).join("") : empty("Sin rendiciones", "Al completar un trabajo remunerado aparecerá aquí."); }

function renderSettings() {
  document.getElementById("settingsView").innerHTML = `<div class="settings-grid"><div class="panel"><div class="panel-head"><h2>Tarifas vigentes</h2><span class="muted">Editables</span></div><div class="panel-body">${Object.entries(state.rates).map(([key,val])=>`<label class="rate-row"><span>${rateLabel(key)}</span><input type="number" min="0" data-rate="${key}" value="${val}"></label>`).join("")}<div class="modal-actions"><button class="primary-btn" id="saveRates">Guardar tarifas</button></div></div></div><div class="panel"><div class="panel-head"><h2>Datos</h2></div><div class="panel-body stack"><p class="muted">Generá una copia de seguridad periódicamente. Incluye clientes, tareas, rendiciones y tarifas.</p><button class="secondary-btn" id="exportBackup">Exportar copia JSON</button><label class="secondary-btn" style="text-align:center">Importar copia<input id="importBackup" type="file" accept="application/json" hidden></label><button class="danger-btn" id="clearData">Borrar todos los datos</button></div></div></div>`;
}
function rateLabel(k) { return ({gold:"Gold completo",silver:"Silver completo",book:"Book completo",eventCoverage:"Cobertura evento",eventEdit:"Edición evento",bookCoverage:"Cobertura book",bookEdit:"Edición book",informal:"Informal completo",informalRecording:"Informal solo grabación",ceremony:"Ceremonia completa",ceremonyRecording:"Ceremonia grabación",ceremonyEdit:"Ceremonia edición",drone:"Drone",photoExtra:"Fotógrafo extra",videoExtra:"Videógrafo extra",liveEditor:"Edición en vivo",signatureDesign:"Diseño libro firmas + mural",partyBookDesign:"Diseño libro fiesta",videoExtraClip:"Video crono/entrada",albumInteractive:"Álbum interactivo",droneEdit:"Edición drone FPV",assistant:"Asistente book",extraSheet:"Pliego extra",churchUpgrade:"Iglesia por upgrade",totemDigital:"Tótem / Televisor Fotografía Digital",bookModa:"Adicional book con Moda"})[k]||k; }

function openClientForm(client=null) {
  const form=document.getElementById("clientForm"); form.reset(); form.elements.id.value=client?.id||"";
  document.getElementById("clientDialogTitle").textContent=client?"Editar cliente":"Nuevo cliente";
  document.getElementById("deleteClientFromForm").classList.toggle("hidden",!client);
  if(client) ["code","eventDate","salon","type","honoree","clientName","guests","pack","notes"].forEach(k=>form.elements[k].value=client[k]??"");
  renderFormChecks(client); document.getElementById("clientDialog").showModal(); updateFlexField();
}
function renderFormChecks(client) {
  const selected=client?.addons||[], flex=client?.flexServices||[];
  document.getElementById("addonChecks").innerHTML=ADDONS.map(([v,l])=>`<label><input type="checkbox" name="addons" value="${v}" ${selected.includes(v)?"checked":""}>${l}</label>`).join("");
  document.getElementById("flexChecks").innerHTML=FLEX_SERVICES.map(([v,l])=>`<label><input type="checkbox" name="flexServices" value="${v}" ${flex.includes(v)?"checked":""}>${l}</label>`).join("");
}
function updateFlexField() {
  const checked=[...document.querySelectorAll('[name="addons"]:checked')].map(x=>x.value), limit=checked.includes("flex")?5:checked.includes("miniflex")?2:0;
  if(!limit)document.querySelectorAll('[name="flexServices"]').forEach(input=>input.checked=false);
  document.getElementById("flexField").classList.toggle("hidden",!limit); document.getElementById("flexLimitHelp").textContent=limit?`(${document.querySelectorAll('[name="flexServices"]:checked').length}/${limit})`:"";
}
function saveClient(form) {
  const data=Object.fromEntries(new FormData(form)); const addons=[...form.querySelectorAll('[name="addons"]:checked')].map(x=>x.value); const flexServices=[...form.querySelectorAll('[name="flexServices"]:checked')].map(x=>x.value);
  const limit=addons.includes("flex")?5:addons.includes("miniflex")?2:0; if(limit&&flexServices.length!==limit){toast(`Elegí exactamente ${limit} servicios para ${limit===2?"Mini Flex":"Flex"}.`); return false;}
  const duplicate=state.clients.find(c=>c.code===data.code&&c.id!==data.id); if(duplicate){toast("Ya existe un cliente con ese código."); return false;}
  if(data.id){const c=state.clients.find(x=>x.id===data.id); Object.assign(c,data,{addons,flexServices,guests:Number(data.guests||0)}); syncTasks(c);}
  else {const client={...data,id:uid("client"),addons,flexServices,guests:Number(data.guests||0),createdAt:new Date().toISOString(),history:[{date:new Date().toISOString(),text:"Cliente creado"}]}; client.tasks=createTasks(client); state.clients.push(client);}
  saveState(); toast(data.id?"Cliente actualizado":"Cliente creado con su plan de trabajo"); return true;
}
function syncTasks(client) { const existing=new Map(client.tasks.map(t=>[t.key,t])); client.tasks=createTasks(client).map(t=>existing.has(t.key)?{...t,...existing.get(t.key)}:t); client.history.push({date:new Date().toISOString(),text:"Datos del cliente actualizados"}); }

function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""));}
function normalizeIds(){const clientMap=new Map(),taskMap=new Map();state.clients.forEach(client=>{if(!isUuid(client.id)){const old=client.id;client.id=uid();clientMap.set(old,client.id);}client.tasks.forEach(task=>{if(!isUuid(task.id)){const old=task.id;task.id=uid();taskMap.set(old,task.id);}});});state.renditions.forEach(item=>{if(clientMap.has(item.clientId))item.clientId=clientMap.get(item.clientId);if(taskMap.has(item.taskId))item.taskId=taskMap.get(item.taskId);if(!isUuid(item.id))item.id=uid();});}
function setSyncStatus(text){const el=document.getElementById("syncStatus");if(el)el.textContent=text;}
function scheduleCloudSync(){if(!cloudEnabled||!currentUser)return;clearTimeout(cloudTimer);cloudTimer=setTimeout(runCloudSync,650);}
async function runCloudSync(){if(cloudSyncing||!currentUser)return;cloudSyncing=true;setSyncStatus("Guardando en la nube…");try{normalizeIds();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));await syncCloudState(state,currentUser);setSyncStatus("Sincronizado");}catch(error){console.error(error);setSyncStatus("Sin conexión · copia local guardada");toast("No se pudo sincronizar. El cambio quedó guardado localmente.");}finally{cloudSyncing=false;}}

function parseCsv(text) {
  const firstLine=(text.split(/\r?\n/,1)[0]||"");
  const delimiter=(firstLine.match(/;/g)||[]).length>(firstLine.match(/,/g)||[]).length?";":",";
  const rows=[]; let row=[],value="",quoted=false;
  for(let i=0;i<text.length;i+=1){const char=text[i];if(char==='"'&&quoted&&text[i+1]==='"'){value+='"';i+=1;}else if(char==='"'){quoted=!quoted;}else if(char===delimiter&&!quoted){row.push(value.trim());value="";}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i+=1;row.push(value.trim());if(row.some(Boolean))rows.push(row);row=[];value="";}else value+=char;}
  row.push(value.trim());if(row.some(Boolean))rows.push(row);if(rows.length<2)return [];
  const headers=rows.shift().map(normalizeHeader);
  return rows.map(cells=>Object.fromEntries(headers.map((header,index)=>[header,cells[index]||""])));
}
function normalizeHeader(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");}
function firstValue(row,keys){for(const key of keys){if(row[key]!==undefined&&String(row[key]).trim()!=="")return String(row[key]).trim();}return "";}
function normalizeDate(value){const text=String(value||"").trim();if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)){const[y,m,d]=text.split("-");return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;}const match=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);if(!match)return "";const year=match[3].length===2?`20${match[3]}`:match[3];return `${year}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;}
function parsePack(raw){const text=String(raw||"").toUpperCase();if(text.includes("VIP"))return "vip";if(text.includes("INFORMAL"))return "informal";if(text.includes("GOLD")||text.includes("ALL INCLUSIVE")||text.includes("GOLDEN"))return "gold";return "silver";}
function parseAddons(raw){const text=String(raw||"").toUpperCase(),items=[];const rules=[["pant",/PANT/],["pixel",/PIXEL/],["miniflex",/UP\.?MFLEX|MINI\s*FLEX/],["flex",/UP\.FLEX|\bFLEX\b/],["libro",/LIBRO/],["maqui",/MAQUI/],["moda",/\bMODA\b/],["drone",/DRONE/]];rules.forEach(([key,regex])=>{if(regex.test(text))items.push(key);});if(items.includes("miniflex"))return [...new Set(items.filter(x=>x!=="flex"))];return [...new Set(items)];}
function parseFlexServices(raw){const text=String(raw||"").toUpperCase(),items=[];const rules=[["church",/IGLESIA|TEMPLO/],["civil",/CIVIL/],["droneEvent",/DRONE.*(EVENTO|RECEPC)/],["droneBook",/DRONE.*(BOOK|SESION)/],["photoExtra",/FOTOGRAFO EXTRA/],["videoExtra",/VIDEOGRAFO EXTRA/],["signatureBook",/LIBRO.*FIRMA/],["partyBook",/LIBRO.*FIESTA/],["liveEditor",/EDITOR.*VIVO|EDICION EN VIVO/],["friendsVideo",/VIDEO.*AMIG/],["extraSession",/SESION EXTRA/]];rules.forEach(([key,regex])=>{if(regex.test(text))items.push(key);});return items;}
async function importClientCsv(file){
  const bytes=await file.arrayBuffer();let text=new TextDecoder("utf-8").decode(bytes);if(text.includes("�"))text=new TextDecoder("windows-1252").decode(bytes);text=text.replace(/^\uFEFF/,"");
  const rows=parseCsv(text);if(!rows.length){toast("El CSV no contiene filas para importar.");return;}
  let created=0,updated=0,skipped=0;
  rows.forEach(row=>{const code=firstValue(row,["codigo","codigo_evento","cod_evento","evento"]),eventDate=normalizeDate(firstValue(row,["fecha","fecha_evento","fecha_del_evento"]));if(!code||!eventDate){skipped+=1;return;}const rawPack=firstValue(row,["pack_upgrades","pack_y_upgrades","fotografia","pack","servicios"]),addonsText=[rawPack,firstValue(row,["adicionales","upgrades","complementos"])].filter(Boolean).join(" "),flexText=firstValue(row,["servicios_flex","elecciones_flex","mini_flex","flex"]);const incoming={code,eventDate,salon:firstValue(row,["salon","sede"])||"Otro",type:firstValue(row,["tipo","tipo_evento"])||"Otro",honoree:firstValue(row,["homenajeado","homenajeada","homenajead","nombre_evento"])||firstValue(row,["cliente","nombre_cliente"])||`Evento ${code}`,clientName:firstValue(row,["cliente","nombre_cliente","contacto_cliente"]),guests:Number(firstValue(row,["invitados","cantidad_invitados"])||0),pack:parsePack(rawPack),addons:parseAddons(addonsText),flexServices:parseFlexServices(flexText),notes:firstValue(row,["notas","observaciones","comentarios"])};const existing=state.clients.find(c=>String(c.code)===String(code));if(existing){Object.assign(existing,incoming,{notes:incoming.notes||existing.notes});syncTasks(existing);updated+=1;}else{const client={...incoming,id:uid("client"),createdAt:new Date().toISOString(),history:[{date:new Date().toISOString(),text:"Cliente importado desde CSV"}]};client.tasks=createTasks(client);state.clients.push(client);created+=1;}});
  saveState();toast(`${created} creados · ${updated} actualizados${skipped?` · ${skipped} omitidos`:""}`);
}
function downloadClientTemplate(){const content="codigo;fecha_evento;salon;tipo;homenajeado;cliente;invitados;pack_upgrades;adicionales;servicios_flex;observaciones\n43828;04/07/2026;Pilar Hotel;15;Cliente de ejemplo;Contacto;120;(SILVER)(GOLD)(PANT);PIXEL;;\n";const blob=new Blob(["\uFEFF"+content],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="plantilla_clientes_janos.csv";a.click();URL.revokeObjectURL(a.href);}

function openClientDetail(id) {
  const c=state.clients.find(x=>x.id===id); if(!c)return; const phases=[...new Set(c.tasks.map(t=>t.phase))];
  document.getElementById("clientDetail").innerHTML=`<div class="detail-wrap"><div class="detail-title"><div><p class="eyebrow">#${escapeHtml(c.code)} · ${escapeHtml(c.salon)}</p><h2>${escapeHtml(c.honoree)}</h2><p>${dateText(c.eventDate)} · ${packLabel(c.pack)} · ${escapeHtml(c.type)}</p></div><button class="icon-btn" data-close-detail>×</button></div><div class="detail-summary"><div class="summary-box"><span>Progreso</span><strong>${progress(c)}%</strong></div><div class="summary-box"><span>Cliente</span><strong>${escapeHtml(c.clientName||"Sin informar")}</strong></div><div class="summary-box"><span>Invitados</span><strong>${c.guests||"-"}</strong></div><div class="summary-box"><span>Para rendir</span><strong>${c.tasks.filter(t=>t.payable&&t.status==="done").length}</strong></div></div>${phases.map(p=>`<h3 class="phase-title">${p}</h3>${c.tasks.filter(t=>t.phase===p).map(t=>taskRow(c,t)).join("")}`).join("")}<div class="modal-actions"><button class="danger-btn" data-delete-client="${c.id}">Eliminar</button><button class="secondary-btn" data-edit-client="${c.id}">Editar ficha</button><button class="primary-btn" data-close-detail>Cerrar</button></div></div>`;
  const dialog=document.getElementById("detailDialog"); if(!dialog.open)dialog.showModal();
}
function taskRow(c,t){const needsOrder=t.key==="partyBook";return `<div class="task-row ${t.status==="done"?"done":""}"><input class="task-check" type="checkbox" data-task-check="${c.id}|${t.id}" ${t.status==="done"?"checked":""}><div class="task-title"><strong>${escapeHtml(t.title)}</strong>${t.payable?`<small>Genera rendición: ${escapeHtml(t.category)} → ${escapeHtml(t.work)}</small>`:""}</div><select data-task-status="${c.id}|${t.id}">${Object.entries(STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${t.status===k?"selected":""}>${v}</option>`).join("")}</select><input type="date" data-task-date="${c.id}|${t.id}" value="${isoDate(t.completedAt)}" title="Fecha real del trabajo"><input data-task-responsible="${c.id}|${t.id}" value="${escapeHtml(t.responsible)}" placeholder="Responsable"><input data-task-notes="${c.id}|${t.id}" value="${escapeHtml(t.notes)}" placeholder="${needsOrder?"N° pedido laboratorio":"Observaciones"}"></div>`;}
function updateTask(clientId,taskId,status){const c=state.clients.find(x=>x.id===clientId),t=c?.tasks.find(x=>x.id===taskId);if(!t)return;if(status==="done"&&t.key==="partyBook"&&!t.notes.trim()){toast("Ingresá el número de pedido del laboratorio antes de terminar esta tarea.");openClientDetail(c.id);return;}t.status=status;if(status==="done"&&!t.completedAt)t.completedAt=todayIso();if(status!=="done")t.completedAt="";const existing=state.renditions.find(r=>r.taskId===t.id);if(status==="done"&&t.payable&&!existing){const workDate=isoDate(t.completedAt)||todayIso();state.renditions.push({id:uid("rend"),clientId:c.id,taskId:t.id,category:t.category,work:t.work,amount:state.rates[t.rateKey]||0,status:"pending",createdAt:new Date().toISOString(),workDate,periodEnd:periodEndFor(workDate),observations:t.notes||""});}if(status!=="done"&&existing?.status==="pending")state.renditions=state.renditions.filter(r=>r.id!==existing.id);saveState();openClientDetail(c.id);toast(status==="done"&&t.payable?"Tarea terminada y rendición agregada":"Tarea actualizada");}
function deleteClient(id){state.clients=state.clients.filter(c=>c.id!==id);state.renditions=state.renditions.filter(r=>r.clientId!==id);const detail=document.getElementById("detailDialog"),form=document.getElementById("clientDialog");if(detail.open)detail.close();if(form.open)form.close();saveState();toast("Cliente y registros vinculados eliminados");}

function setView(view){activeView=view;document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`${view}View`));document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));const meta={dashboard:["Resumen operativo","Inicio"],clients:["Gestión de eventos","Clientes"],renditions:["Trabajos realizados","Rendiciones"],settings:["Reglas y valores","Configuración"]}[view];document.getElementById("viewEyebrow").textContent=meta[0];document.getElementById("viewTitle").textContent=meta[1];document.querySelector(".sidebar").classList.remove("open");}
function toast(msg){const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600);}

document.addEventListener("click", e => {
  const nav=e.target.closest("[data-view]"); if(nav)setView(nav.dataset.view);
  const go=e.target.closest("[data-go]"); if(go)setView(go.dataset.go);
  const open=e.target.closest("[data-open-client]"); if(open)openClientDetail(open.dataset.openClient);
  const edit=e.target.closest("[data-edit-client]"); if(edit){document.getElementById("detailDialog").close();openClientForm(state.clients.find(c=>c.id===edit.dataset.editClient));}
  if(e.target.closest("[data-close-detail]"))document.getElementById("detailDialog").close();
  if(e.target.closest("[data-close-client-form]"))document.getElementById("clientDialog").close();
  const del=e.target.closest("[data-delete-client]"); if(del&&confirm("¿Eliminar este cliente, sus tareas y todas sus rendiciones?"))deleteClient(del.dataset.deleteClient);
  if(e.target.id==="deleteClientFromForm"){const id=document.getElementById("clientForm").elements.id.value;if(id&&confirm("¿Eliminar este cliente, sus tareas y todas sus rendiciones?"))deleteClient(id);}
  if(e.target.id==="saveRates"){document.querySelectorAll("[data-rate]").forEach(i=>state.rates[i.dataset.rate]=Number(i.value||0));saveState();toast("Tarifas actualizadas");}
  if(e.target.id==="downloadClientTemplate")downloadClientTemplate();
  if(e.target.id==="importClientsBtn")document.getElementById("clientCsvInput")?.click();
  if(e.target.id==="exportBackup"){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`janos-control-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}
  if(e.target.id==="clearData"&&confirm("¿Borrar todos los clientes, tareas y rendiciones de esta app?")){state=initialState();saveState();toast("Datos eliminados");}
});
document.addEventListener("change", e => {
  if(e.target.matches('[name="addons"][value="miniflex"], [name="addons"][value="flex"]')&&e.target.checked){const other=e.target.value==="flex"?"miniflex":"flex";const otherInput=document.querySelector(`[name="addons"][value="${other}"]`);if(otherInput)otherInput.checked=false;}
  if(e.target.matches('[name="addons"], [name="flexServices"]'))updateFlexField();
  if(e.target.dataset.taskStatus){const [c,t]=e.target.dataset.taskStatus.split("|");updateTask(c,t,e.target.value);}
  if(e.target.dataset.taskResponsible){const [c,t]=e.target.dataset.taskResponsible.split("|");const task=state.clients.find(x=>x.id===c)?.tasks.find(x=>x.id===t);if(task){task.responsible=e.target.value;saveState();}}
  if(e.target.dataset.taskDate){const [c,t]=e.target.dataset.taskDate.split("|"),task=state.clients.find(x=>x.id===c)?.tasks.find(x=>x.id===t);if(task){task.completedAt=e.target.value;const rendition=state.renditions.find(r=>r.taskId===task.id);if(rendition&&e.target.value){rendition.workDate=e.target.value;rendition.periodEnd=periodEndFor(e.target.value);}saveState();}}
  if(e.target.dataset.taskNotes){const [c,t]=e.target.dataset.taskNotes.split("|"),task=state.clients.find(x=>x.id===c)?.tasks.find(x=>x.id===t);if(task){task.notes=e.target.value;const rendition=state.renditions.find(r=>r.taskId===task.id);if(rendition)rendition.observations=e.target.value;saveState();}}
  if(e.target.dataset.renditionStatus){const r=state.renditions.find(x=>x.id===e.target.dataset.renditionStatus);if(r){r.status=e.target.value;saveState();toast("Estado de rendición actualizado");}}
  if(e.target.id==="renditionFilter"){document.getElementById("renditionRows").innerHTML=renditionRows(state.renditions.filter(r=>!e.target.value||r.status===e.target.value));}
  if(["clientSalonFilter","clientMonthFilter","clientPackFilter"].includes(e.target.id))filterClients();
  if(e.target.id==="importBackup"){const file=e.target.files[0];if(file){file.text().then(text=>{try{state={...initialState(),...JSON.parse(text)};saveState();toast("Copia importada");}catch{toast("El archivo no es una copia válida");}});}}
  if(e.target.id==="clientCsvInput"&&e.target.files[0])importClientCsv(e.target.files[0]).finally(()=>{e.target.value="";});
});
document.addEventListener("input",e=>{if(e.target.id==="clientSearch")filterClients();});
document.addEventListener("change",e=>{if(e.target.dataset.taskCheck){const[c,t]=e.target.dataset.taskCheck.split("|");updateTask(c,t,e.target.checked?"done":"pending");}});
function filterClients(){const q=(document.getElementById("clientSearch")?.value||"").toLowerCase(),salon=document.getElementById("clientSalonFilter")?.value||"",month=document.getElementById("clientMonthFilter")?.value||"",pack=document.getElementById("clientPackFilter")?.value||"";const filtered=state.clients.filter(c=>(!salon||c.salon===salon)&&(!month||monthKey(c.eventDate)===month)&&(!pack||c.pack===pack)&&[c.honoree,c.clientName,c.code].some(v=>String(v||"").toLowerCase().includes(q)));document.getElementById("clientGrid").innerHTML=clientCards(filtered);const count=document.getElementById("clientResultCount");if(count)count.textContent=eventCountLabel(filtered.length);}
document.getElementById("newClientBtn").addEventListener("click",()=>openClientForm());
document.getElementById("mobileMenu").addEventListener("click",()=>document.querySelector(".sidebar").classList.toggle("open"));
document.getElementById("clientForm").addEventListener("submit",e=>{e.preventDefault();if(saveClient(e.currentTarget))document.getElementById("clientDialog").close();});
document.getElementById("clientDialog").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.close();});
document.getElementById("detailDialog").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.close();});
document.getElementById("loginForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,errorEl=document.getElementById("loginError"),button=form.querySelector("button");errorEl.classList.add("hidden");button.disabled=true;button.textContent="Ingresando…";try{const session=await signIn(form.elements.email.value.trim(),form.elements.password.value);await startApplication(session);}catch(error){errorEl.textContent=error.message.includes("Invalid login")?"Correo o contraseña incorrectos.":error.message;errorEl.classList.remove("hidden");}finally{button.disabled=false;button.textContent="Ingresar";}});
document.getElementById("signOutBtn").addEventListener("click",async()=>{await runCloudSync();await signOut();currentUser=null;document.getElementById("appShell").classList.add("hidden");document.getElementById("authGate").classList.remove("hidden");document.getElementById("loginForm").reset();});

async function startApplication(session){
  currentUser=session?.user||null;
  if(cloudEnabled&&currentUser){setSyncStatus("Cargando datos…");try{const cloudState=await loadCloudState(BASE_RATES);if(cloudState.clients.length||cloudState.renditions.length)state={...initialState(),...cloudState};else{normalizeIds();await syncCloudState(state,currentUser);}localStorage.setItem(STORAGE_KEY,JSON.stringify(state));setSyncStatus("Sincronizado");}catch(error){console.error(error);setSyncStatus("Modo local · sin conexión");}}
  document.getElementById("signedInUser").textContent=currentUser?.email||"Modo local";
  document.getElementById("authGate").classList.add("hidden");document.getElementById("appShell").classList.remove("hidden");render();setView(activeView);
}

async function bootstrap(){
  if(!cloudEnabled){await startApplication(null);setSyncStatus("Modo local · Supabase sin configurar");return;}
  try{const session=await getSession();if(session)await startApplication(session);else document.getElementById("authGate").classList.remove("hidden");}catch(error){console.error(error);document.getElementById("authGate").classList.remove("hidden");document.getElementById("loginError").textContent="No se pudo conectar con Supabase.";document.getElementById("loginError").classList.remove("hidden");}
}

bootstrap();

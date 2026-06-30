import { cloudEnabled, deleteUser, getAccessProfile, getLatestUpdateAt, getSession, listUserProfiles, loadCloudState, notifyUserApproved, requestEmailCode, requestPasswordReset, setUserStatus, signIn, signOut, signUp, syncCloudState, updatePassword, verifyEmailCode } from "./cloud.js";

const PRODUCTION_HOST = "janos-control.vercel.app";
if(window.location.hostname.endsWith(".vercel.app")&&window.location.hostname!==PRODUCTION_HOST){
  window.location.replace(`https://${PRODUCTION_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

const STORAGE_KEY = "janos-control-v1";
const MANAGED_SALONS = ["Acceso Oeste","Acceso Oeste 2","Adrogue","Ambulante","Avellaneda 1","Avellaneda 2","Avellaneda 3","Avellaneda 4","Bayres Eventos","Bella Vista","Bella Vista 2","Benavidez 1","Benavidez 2","Berazategui","Berazategui 2","Berisso","CABA Boutique","Caballito 1","Caballito 2","Campana","Canning","Champagnat Boutique","Costanera 1","Costanera 2","Dardo Rocha","Darwin 1","Darwin 2","Del Viso","DOT","Escobar","General Rodriguez","Haedo","Haedo 2","Hipodromo La Plata","Holiday Inn","Holiday Inn 2","Hotel","House","Hudson","Hudson 2","Hurlingham","Ituzaingo","Ituzaingo 2","Jose C Paz","La Plata","La Plata 2","La Plata Boutique","Liniers","Lomas","Lomas Boutique","Martinez","Maschwitz","Merlo","Merlo 2","Moreno","Moron","Nuñez","Olivos","Olivos 2","Palacio Sans Souci","Palermo Hollywood","Palermo Soho","Pilar","Pilar boutique","Pilar Hotel","Puerto Madero","Puerto Madero Boutique","Quilmes Boutique","Quinta","Ramos Boutique","Ramos Boutique 2","Ramos Mejia","Ramos Mejia 2","Recoleta","San Isidro","San Justo","San Justo 2","San Martin 1","San Martin 2","San Martin 3","San Telmo","San Telmo 2","San Telmo Boutique","Temperley","Vicente Lopez","Villa de Mayo","Villa de Mayo Boutique"];
const STATUS_LABELS = { pending: "Pendiente", waiting: "Esperando cliente", progress: "En proceso", done: "Terminado", na: "No corresponde" };
const RENDITION_STATUS = { pending: "Pendiente", submitted: "Rendido", approved: "Aprobado", paid: "Pagado" };
const DEFAULT_WHATSAPP_TEMPLATE = `Hola {nombre}, ¡buenos días!

Mi nombre es {remitente}, del Departamento de Fotografía de Janos. ¡Es un gusto poder comenzar a trabajar juntos!

Te escribo para presentarme y contarte que nuestro equipo realizará la cobertura de fotografía y video del evento de {homenajeado}, programado para el {fecha} en {salon}.

He creado un grupo de WhatsApp para que podamos estar en contacto permanente y evacuar cualquier duda relacionada con fotografía y video.

En breve te enviaré el enlace de acceso. Podés compartirlo con quienes corresponda: mamá, papá, agasajado/a u otra persona responsable.

Una vez que todos hayan ingresado al grupo, enviame un mensaje por allí para que pueda compartirles información importante.

¡Estamos a su entera disposición! ¡Muchas gracias!`;

const ADDONS = [
  ["pant", "Pantalla"], ["pixel", "Pixel"], ["miniflex", "Mini Flex"], ["flex", "Flex"],
  ["sansSouci", "Sans Souci"], ["libro", "Libro Combo"], ["maqui", "Maquillaje"], ["moda", "Producción de Moda"],
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
  bookModa: 30000, extraCameraEdit: 22000
};

const SEASONAL_RATE_KEYS = ["gold","silver","book","eventCoverage","eventEdit","bookCoverage","bookEdit","informal","informalRecording"];
const SEASONAL_RATES = {
  2026: {
    5:  { gold: 273000, silver: 191000, book: 82000, eventCoverage: 132600, eventEdit: 59200, bookCoverage: 57200, bookEdit: 25200, informal: 135600, informalRecording: 93400 },
    6:  { gold: 300000, silver: 210000, book: 90000, eventCoverage: 146000, eventEdit: 64000, bookCoverage: 62000, bookEdit: 28000, informal: 150000, informalRecording: 102000 },
    7:  { gold: 300000, silver: 210000, book: 90000, eventCoverage: 146000, eventEdit: 64000, bookCoverage: 62000, bookEdit: 28000, informal: 150000, informalRecording: 102000 },
    8:  { gold: 325000, silver: 227500, book: 97500, eventCoverage: 160000, eventEdit: 67500, bookCoverage: 68000, bookEdit: 29500, informal: 160000, informalRecording: 110000 },
    9:  { gold: 325000, silver: 227500, book: 97500, eventCoverage: 160000, eventEdit: 67500, bookCoverage: 68000, bookEdit: 29500, informal: 160000, informalRecording: 110000 }
  }
};

function getRate(rateKey, eventDateStr) {
  if (!SEASONAL_RATE_KEYS.includes(rateKey) || !eventDateStr) return state.rates[rateKey] || 0;
  const d = new Date(eventDateStr + "T00:00:00");
  if (isNaN(d.getTime())) return state.rates[rateKey] || 0;
  const year = d.getFullYear(), month = d.getMonth() + 1;
  const yearTable = SEASONAL_RATES[year];
  if (!yearTable) return state.rates[rateKey] || 0;
  for (let m = month; m >= 1; m--) {
    if (yearTable[m] && yearTable[m][rateKey] != null) return yearTable[m][rateKey];
  }
  const prevYearTable = SEASONAL_RATES[year - 1];
  if (prevYearTable) {
    for (let m = 12; m >= 1; m--) {
      if (prevYearTable[m] && prevYearTable[m][rateKey] != null) return prevYearTable[m][rateKey];
    }
  }
  return state.rates[rateKey] || 0;
}

const CORE_TASKS = [
  task("contact", "Contactar al cliente y explicar el servicio", "Preparación"),
  task("verify", "Verificar pack, upgrades y elecciones", "Preparación"),
  task("coveragePhoto", "Realizar cobertura fotográfica del evento", "Evento", true, "PERSONAL FOTOGRAFIA", "Fiesta (cobertura y edicion)", "silver"),
  task("coverageVideoCapture", "Realizar cobertura de video del evento", "Evento", true, "PERSONAL VIDEO", "Fiesta (cobertura sin edicion)", "eventCoverage"),
  task("coverageVideoEdit", "Editar video del evento", "Evento", true, "PERSONAL VIDEO", "Fiesta (edicion)", "eventEdit"),
  task("backup", "Completar backup del salón", "Evento"),
  task("photoEdit", "Editar fotografías del evento", "Post-evento"),
  task("video20", "Editar video principal de aproximadamente 20 minutos", "Post-evento"),
  task("videoSummary", "Editar video resumen", "Post-evento"),
  task("sendPhotos", "Enviar link de fotografías por e-mail", "Entrega"),
  task("sendVideo", "Enviar link de videos por e-mail", "Entrega")
];

const GOLD_TASKS = [
  task("coordinateSession", "Coordinar y reservar sesión de fotos", "Pre-evento"),
  task("bookCoveragePhoto", "Realizar sesión de fotos", "Pre-evento", true, "PERSONAL FOTOGRAFIA", "Sesion de fotos (cobertura + edicion)", "book"),
  task("bookCoverageVideo", "Realizar sesión de video", "Pre-evento", true, "PERSONAL VIDEO", "Sesion de fotos (cobertura)", "bookCoverage"),
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
  extraSession: task("flexSessionPhoto", "Realizar sesión extra - fotografía", "Servicios elegidos", true, "PERSONAL FOTOGRAFIA", "Sesion de fotos (cobertura + edicion)", "book"),
  extraSessionVideo: task("flexSessionVideo", "Realizar sesión extra - video", "Servicios elegidos", true, "PERSONAL VIDEO", "Sesion de fotos (cobertura)", "bookCoverage")
};

function task(key, title, phase, payable = false, category = "", work = "", rateKey = "") {
  return { key, title, phase, payable, category, work, rateKey };
}

// Tareas que son exclusivas de un rol; lo que no figura acá se considera "ambos" (general/coordinación).
const TASK_ROLES = {
  coveragePhoto: "foto", coverageVideoCapture: "video", coverageVideoEdit: "video",
  photoEdit: "foto", video20: "video", videoSummary: "video", sendPhotos: "foto", sendVideo: "video",
  bookCoveragePhoto: "foto", bookCoverageVideo: "video", backstage: "video", mural: "foto",
  vipLive: "video", vipPhotoExtra: "foto", vipVideoExtra: "video",
  flexChurch: "foto", flexCivil: "foto", flexPhotoExtra: "foto", flexVideoExtra: "video",
  flexSignature: "foto", flexPartyBook: "foto", flexLive: "video", flexFriends: "video",
  flexSessionPhoto: "foto", flexSessionVideo: "video",
  screenVideo: "video", pixelCheck: "foto", bookModa: "foto",
  signatureBook: "foto", partyBookSelection: "foto", partyBook: "foto", totemDigital: "foto",
  informal: "foto"
};
function taskRole(key) { return TASK_ROLES[key] || "ambos"; }

function initialState() {
  return { clients: [], renditions: [], rates: { ...BASE_RATES }, settings: { currency: "ARS" }, seeded: false };
}

let storageKey = STORAGE_KEY;
let state = loadState(storageKey);
let activeView = "dashboard";
let clientViewMode = "upcoming";
let clientFilters = { search: "", salon: "", month: "", pack: "", addon: "" };
let taskRoleFilter = localStorage.getItem("janosTaskRole") || "todos";
let taskSalonFilter = localStorage.getItem("janosTaskSalon") || "";
let taskSearchFilter = "";
let calendarMonth = todayIso().slice(0, 7);
let calendarSalonFilter = localStorage.getItem("janosCalendarSalon") || "";
let renditionViewMode = "active";
let currentUser = null;
let pendingOtp = null;
let cloudTimer = null;
let cloudSyncing = false;
let accessProfile = { role: "user", status: "active" };
let adminUsers = [];
let remoteSnapshotAt = null;

function loadState(key = storageKey) {
  try { return { ...initialState(), ...JSON.parse(localStorage.getItem(key)) }; }
  catch { return initialState(); }
}
function saveState() { localStorage.setItem(storageKey, JSON.stringify(state)); render(); scheduleCloudSync(); }
function storageKeyForUser(user) { return `${STORAGE_KEY}:${user.id}`; }
function uid() { return crypto.randomUUID(); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c])); }
function parseDate(value) { return value ? new Date(`${value}T12:00:00`) : new Date(); }
function dateText(value) { return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parseDate(value)); }
function monthText(value) { return new Intl.DateTimeFormat("es-AR", { month: "short" }).format(parseDate(value)).replace(".", ""); }
function money(value) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0); }
function daysUntil(value) { return Math.round((parseDate(value) - parseDate(todayIso())) / 86400000); }
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
  if (client.addons.includes("sansSouci")) definitions.push(
    task("sansSouciCoverage", "Realizar sesión de fotos en Palacio Sans Souci", "Adicionales", true, "PERSONAL FOTOGRAFIA", "Sesion Sans Souci (cobertura + edicion)", "book")
  );
  if (client.addons.includes("libro")) definitions.push(
    task("signatureBook", "Diseñar libro de firmas", "Pre-evento", true, "COMPLEMENTOS", "Libro firmas (Fotografia Digital)", "signatureDesign"),
    task("partyBookSelection", "Pedirle al cliente que envíe la selección de fotos del libro de fiesta", "Post-evento"),
    task("partyBook", "Diseñar y enviar libro de fiesta al laboratorio", "Entrega", true, "COMPLEMENTOS", "Libro Fiesta (Fotografia Digital)", "partyBookDesign")
  );
  client.flexServices.forEach(code => { if (FLEX_TASKS[code]) definitions.push(FLEX_TASKS[code]); });
  const hasSession = definitions.some(item => ["bookCoveragePhoto", "flexSessionPhoto"].includes(item.key));
  if (hasSession) definitions.push(task("totemDigital", "Preparar tótem digital de la sesión", "Pre-evento", true, "COMPLEMENTOS", "Televisor Fotografia Digital", "totemDigital"));
  return definitions.map(def => ({ ...def, id: uid(), status: "pending", responsible: "", completedAt: "", notes: "" }));
}

function isoDate(value){return value?String(value).slice(0,10):"";}
function todayIso(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
function isPastEvent(client){return String(client?.eventDate||"")<todayIso();}
function periodEndFor(workDate){const date=parseDate(workDate);const advance=date.getDate()>20;date.setDate(1);if(advance)date.setMonth(date.getMonth()+1);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-20`;}

function render() {
  renderDashboard(); renderClients(); renderCalendar(); renderTasks(); renderRenditions(); renderSettings(); renderUsers();
  document.getElementById("navRenditionCount").textContent = state.renditions.filter(r => r.status === "pending").length;
}

function renderDashboard() {
  const activeClients = state.clients.filter(c => !isPastEvent(c));
  const pendingTasks = state.clients.flatMap(c => c.tasks).filter(t => !["done", "na"].includes(t.status)).length;
  const pendingR = state.renditions.filter(r => r.status === "pending" && !r.archivedAt);
  const nextEvents = activeClients.sort((a,b) => parseDate(a.eventDate) - parseDate(b.eventDate)).slice(0, 7);
  const waiting = state.clients.flatMap(c => c.tasks).filter(t => t.status === "waiting").length;
  const contactWatch = contactWatchItems();
  document.getElementById("dashboardView").innerHTML = `
    <div class="kpi-grid">
      ${kpi("Clientes activos", activeClients.length, "eventos próximos")}
      ${kpi("Tareas pendientes", pendingTasks, waiting ? `${waiting} esperando al cliente` : "sin bloqueos registrados")}
      ${kpi("Para rendir", pendingR.length, money(pendingR.reduce((s,r)=>s+r.amount,0)))}
      ${kpi("Próximos 30 días", state.clients.filter(c => { const d=daysUntil(c.eventDate); return d>=0&&d<=30; }).length, "eventos por preparar")}
    </div>
    <div class="content-grid">
      <div class="panel"><div class="panel-head"><h2>Próximos eventos</h2><button class="ghost-btn" data-go="clients">Ver todos</button></div>
        ${nextEvents.length ? `<div>${nextEvents.map(eventRow).join("")}</div>` : empty("No hay eventos próximos", "Los eventos que ya pasaron están en Clientes → Realizados.")}
      </div>
      <div class="panel"><div class="panel-head"><h2>Atención requerida</h2></div><div class="panel-body stack">
        ${attentionItems() || `<div class="empty"><strong>Todo en orden</strong>No hay alertas urgentes.</div>`}
      </div></div>
    </div>
    ${contactWatch ? `<div class="contact-watch"><span class="contact-watch-label">Sin contactar</span>${contactWatch}</div>` : ""}`;
}
function kpi(label, value, note) { return `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }
function eventRow(c) { const d=parseDate(c.eventDate), pct=progress(c); return `<div class="event-row"><div class="date-box"><strong>${String(d.getDate()).padStart(2,"0")}</strong><span>${monthText(c.eventDate)}</span></div><div class="event-name"><strong>${escapeHtml(c.honoree)}</strong><span>#${escapeHtml(c.code)} · ${escapeHtml(c.salon)}</span></div><span class="tag">${packLabel(c.pack)}</span><span class="muted">${pct}% completo</span><button class="secondary-btn" data-open-client="${c.id}">Abrir</button></div>`; }
function attentionItems() {
  const items=[];
  state.clients.forEach(c => {
    const days=daysUntil(c.eventDate), incomplete=c.tasks.filter(t=>!["done","na"].includes(t.status)),hasPrintedBook=(c.addons||[]).includes("libro"),bookDue=hasPrintedBook&&days>=0&&days<=30;
    const prepPending=c.tasks.filter(t=>t.phase==="Preparación"&&!["done","na"].includes(t.status)),prepDue=prepPending.length&&days>=0&&days<=30;
    if(bookDue){const urgent=days<=15,when=days===0?"Evento hoy":`Faltan ${days} ${days===1?"día":"días"}`;items.push({priority:urgent?0:1,days,html:`<button class="attention-alert ${urgent?"book-urgent":"book-warning"}" data-open-client="${c.id}"><strong>${escapeHtml(c.honoree)}</strong><span>${urgent?"URGENTE · ":""}Libro Combo / material impreso</span><small>${when} · Confirmar selección de fotos, diseño y envío a impresión.</small></button>`});}
    else if(prepDue){const urgent=days<=15,when=days===0?"Evento hoy":`Faltan ${days} ${days===1?"día":"días"}`;items.push({priority:urgent?0:1,days,html:`<button class="attention-alert ${urgent?"book-urgent":"book-warning"}" data-open-client="${c.id}"><strong>${escapeHtml(c.honoree)}</strong><span>${urgent?"URGENTE · ":""}Faltan confirmar datos del evento</span><small>${when} · ${prepPending.map(t=>t.title).join(" · ")}</small></button>`});}
    else if(days>=0&&days<=14&&incomplete.length) items.push({priority:2,days,html:`<button class="ghost-btn" data-open-client="${c.id}"><strong>${escapeHtml(c.honoree)}</strong><br><small>Faltan ${days} días · ${incomplete.length} tareas abiertas</small></button>`});
    if(!c.isExternal&&days<0&&c.tasks.some(t=>["coveragePhoto","coverageVideoCapture","coverageVideoEdit"].includes(t.key)&&!["done","na"].includes(t.status))) items.push({priority:0,days,html:`<button class="ghost-btn" data-open-client="${c.id}"><strong>${escapeHtml(c.honoree)}</strong><br><small>Cobertura sin confirmar</small></button>`});
  }); return items.sort((a,b)=>a.priority-b.priority||a.days-b.days).slice(0,6).map(item=>item.html).join("");
}
function contactWatchItems() {
  return state.clients
    .filter(c => !c.isExternal && !c.contactedAt && daysUntil(c.eventDate) <= 90)
    .sort((a,b) => daysUntil(a.eventDate) - daysUntil(b.eventDate))
    .map(c => {
      const days = daysUntil(c.eventDate), level = days <= 60 ? "danger" : "warning";
      const when = days < 0 ? `venció hace ${Math.abs(days)} d` : days === 0 ? "es hoy" : `faltan ${days} d`;
      return `<button class="contact-watch-item ${level}" data-open-client="${c.id}" title="Sin contactar por WhatsApp · evento ${dateText(c.eventDate)}"><span class="contact-watch-dot"></span>${escapeHtml(c.honoree)} · ${when}</button>`;
    }).join("");
}

function renderClients() {
  const modeClients=state.clients.filter(c=>clientViewMode==="archived"?isPastEvent(c):!isPastEvent(c));
  const salons=[...new Set([...MANAGED_SALONS,...state.clients.map(c=>String(c.salon||"").trim()).filter(Boolean)])];
  const months=[...new Set(modeClients.map(c=>monthKey(c.eventDate)).filter(Boolean))].sort();
  const upcomingCount=state.clients.filter(c=>!isPastEvent(c)).length,archivedCount=state.clients.length-upcomingCount;
  const _html = `<div class="view-switch" aria-label="Archivo de eventos"><button class="${clientViewMode==="upcoming"?"active":""}" data-client-view="upcoming">Próximos <b>${upcomingCount}</b></button><button class="${clientViewMode==="archived"?"active":""}" data-client-view="archived">Realizados <b>${archivedCount}</b></button></div><div class="client-filters"><div class="filter-heading"><div><p class="eyebrow">${clientViewMode==="archived"?"Archivo de eventos":"Organizar eventos"}</p><strong>${clientViewMode==="archived"?"Eventos cuya fecha ya pasó":"Elegí un salón y un mes"}</strong></div><span id="clientResultCount" class="muted">${eventCountLabel(modeClients.length)}</span></div><div class="toolbar"><div class="search"><input id="clientSearch" placeholder="Buscar por nombre o código"></div><select id="clientSalonFilter" aria-label="Filtrar por salón"><option value="">Todos los salones</option>${salons.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}</select><select id="clientMonthFilter" aria-label="Filtrar por mes"><option value="">Todos los meses</option>${months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join("")}</select><select id="clientPackFilter" aria-label="Filtrar por pack"><option value="">Todos los packs</option><option value="silver">Silver</option><option value="gold">Golden / All Inclusive</option><option value="vip">VIP</option><option value="informal">Informal</option></select><select id="clientAddonFilter" aria-label="Filtrar por adicional"><option value="">Todos los adicionales</option>${ADDONS.map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></div></div><div class="client-actions"><button class="secondary-btn" id="downloadClientTemplate">Descargar CSV</button><button class="primary-btn" id="importClientsBtn">Importar lote</button><input id="clientCsvInput" type="file" accept=".csv,text/csv" hidden></div><div id="clientGrid" class="client-grid">${clientCards(modeClients)}</div>`;
  document.getElementById("clientsView").innerHTML = _html;
  const _s = document.getElementById("clientSearch");
  const _sf = document.getElementById("clientSalonFilter");
  const _mf = document.getElementById("clientMonthFilter");
  const _pf = document.getElementById("clientPackFilter");
  const _adf = document.getElementById("clientAddonFilter");
  if(_s) _s.value = clientFilters.search;
  if(_sf) _sf.value = clientFilters.salon;
  if(_mf) _mf.value = clientFilters.month;
  if(_pf) _pf.value = clientFilters.pack;
  if(_adf) _adf.value = clientFilters.addon;
  if(clientFilters.search || clientFilters.salon || clientFilters.month || clientFilters.pack || clientFilters.addon) filterClients();
}
function monthKey(value){return /^\d{4}-\d{2}/.test(String(value||""))?String(value).slice(0,7):"";}
function monthLabel(value){const [year,month]=String(value).split("-");if(!year||!month)return value;const label=new Intl.DateTimeFormat("es-AR",{month:"long",year:"numeric"}).format(new Date(Number(year),Number(month)-1,1));return label.charAt(0).toUpperCase()+label.slice(1);}
function eventCountLabel(count){return `${count} ${count===1?"evento":"eventos"}`;}
function shiftMonth(key,delta){const [y,m]=key.split("-").map(Number);const d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
function calendarSalonClass(salon,salons){const idx=salons.indexOf(salon);return `cal-salon-${idx>=0?idx%4:4}`;}
function renderCalendar(){
  const view=document.getElementById("calendarView"); if(!view) return;
  const salons=[...new Set([...MANAGED_SALONS,...state.clients.map(c=>String(c.salon||"").trim()).filter(Boolean)])];
  const [year,month]=calendarMonth.split("-").map(Number);
  const startWeekday=(new Date(year,month-1,1).getDay()+6)%7;
  const daysInMonth=new Date(year,month,0).getDate();
  const todayKey=todayIso();
  const eventsByDay=new Map();
  state.clients.filter(c=>monthKey(c.eventDate)===calendarMonth&&(!calendarSalonFilter||c.salon===calendarSalonFilter)).forEach(c=>{
    const day=Number(String(c.eventDate).slice(8,10));
    if(!eventsByDay.has(day))eventsByDay.set(day,[]);
    eventsByDay.get(day).push(c);
  });
  const cells=[];
  for(let i=0;i<startWeekday;i++)cells.push(`<div class="cal-cell empty"></div>`);
  for(let day=1;day<=daysInMonth;day++){
    const dateKey=`${calendarMonth}-${String(day).padStart(2,"0")}`;
    const items=(eventsByDay.get(day)||[]).sort((a,b)=>String(a.salon||"").localeCompare(String(b.salon||"")));
    cells.push(`<div class="cal-cell${dateKey===todayKey?" today":""}"><span class="cal-day">${day}</span>${items.map(c=>`<button class="cal-event ${calendarSalonClass(c.salon,salons)}" data-open-client="${c.id}" title="${escapeHtml(c.honoree)} · ${escapeHtml(c.salon||"")}">${escapeHtml(c.honoree)}</button>`).join("")}</div>`);
  }
  const trailing=(7-(cells.length%7))%7;
  for(let i=0;i<trailing;i++)cells.push(`<div class="cal-cell empty"></div>`);
  const weekdays=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  view.innerHTML=`
    <div class="rendition-controls">
      <button class="ghost-btn" id="calPrev">‹ Mes anterior</button>
      <strong class="cal-month-label">${monthLabel(calendarMonth)}</strong>
      <button class="ghost-btn" id="calNext">Mes siguiente ›</button>
      <button class="ghost-btn" id="calToday">Hoy</button>
      <select id="calendarSalonFilter" aria-label="Filtrar por salón"><option value="">Todos los salones</option>${salons.map(s=>`<option value="${escapeHtml(s)}"${calendarSalonFilter===s?" selected":""}>${escapeHtml(s)}</option>`).join("")}</select>
    </div>
    <div class="cal-grid">
      ${weekdays.map(w=>`<div class="cal-weekday">${w}</div>`).join("")}
      ${cells.join("")}
    </div>`;
}
function whatsappNumber(value){let digits=String(value||"").replace(/\D/g,"").replace(/^00/,"");if(!digits)return "";if(digits.startsWith("549"))return digits;if(digits.startsWith("54"))return `549${digits.slice(2)}`;if(digits.length>10)return digits;return `549${digits.replace(/^0/,"")}`;}
function whatsappMessage(client){const metadata=currentUser?.user_metadata||{};const values={nombre:client.clientName||client.honoree,homenajeado:client.honoree,fecha:dateText(client.eventDate),salon:client.salon,tipo:client.type,codigo:client.code,remitente:metadata.first_name||metadata.full_name||"el equipo"};return Object.entries(values).reduce((message,[key,value])=>message.split(`{${key}}`).join(String(value||"")),state.settings?.whatsappTemplate||DEFAULT_WHATSAPP_TEMPLATE);}
function whatsappUrl(client){const phone=whatsappNumber(client.clientPhone);return phone?`https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage(client))}`:"";}
function contactClient(id){const client=state.clients.find(item=>item.id===id);if(!client)return;const url=whatsappUrl(client);if(!url){openClientForm(client);toast("Agregá el WhatsApp del cliente para contactarlo");return;}window.open(url,"_blank","noopener,noreferrer");client.contactedAt=new Date().toISOString();client.history=client.history||[];client.history.push({date:client.contactedAt,text:"Contacto inicial por WhatsApp registrado",type:"whatsapp_contact"});saveState();toast("Contacto registrado");}
function openWhatsappGroup(id){const client=state.clients.find(item=>item.id===id);if(!client)return;const url=(client.whatsappGroupUrl||"").trim();if(!url){openClientForm(client);toast("Pegá el link del grupo de WhatsApp para poder abrirlo");return;}window.open(url,"_blank","noopener,noreferrer");}
function sessionDateTimeText(session){if(!session?.date||!session?.time)return "Sin agendar";return `${dateText(session.date)} · ${session.time}`;}
function photoSessionSummary(client){const session=client.photoSession;if(!session?.date)return "Sin sesión agendada";return `${sessionDateTimeText(session)} · ${session.location||client.salon}`;}
function openPhotoSessionForm(clientId){const client=state.clients.find(item=>item.id===clientId);if(!client)return;const form=document.getElementById("photoSessionForm"),session=client.photoSession||{};form.reset();form.elements.clientId.value=client.id;form.elements.date.value=session.date||"";form.elements.time.value=session.time||"";form.elements.location.value=session.location||client.salon||"";form.elements.team.value=session.team||"";form.elements.includesFashionProduction.checked=Boolean(session.includesFashionProduction);form.elements.includesMakeupHair.checked=Boolean(session.includesMakeupHair);form.elements.notes.value=session.notes||"";document.getElementById("photoSessionDialog").showModal();}
function calendarDatePart(date,time){return `${date.replaceAll("-","")}T${time.replace(":","")}00`;}
function addMinutesToTime(date,time,minutes){const value=new Date(`${date}T${time}:00`);value.setMinutes(value.getMinutes()+Number(minutes||90));return {date:`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`,time:`${String(value.getHours()).padStart(2,"0")}:${String(value.getMinutes()).padStart(2,"0")}`};}
function googleCalendarUrl(client,session){const end=addMinutesToTime(session.date,session.time,90);const optional=[session.includesFashionProduction?"Incluye producción de moda":"",session.includesMakeupHair?"Incluye maquillaje y peinado":""].filter(Boolean);const details=[`Cliente: ${client.clientName||client.honoree}`,`Evento: #${client.code} · ${client.honoree}`,`Fecha del evento: ${dateText(client.eventDate)}`,optional.length?`Opcionales: ${optional.join(" · ")}`:"",session.notes?`Notas: ${session.notes}`:""].filter(Boolean).join("\n");const params=new URLSearchParams({action:"TEMPLATE",text:`#${client.code} Book ${client.honoree} · ${session.location} · ${session.time}`,dates:`${calendarDatePart(session.date,session.time)}/${calendarDatePart(end.date,end.time)}`,details,location:session.location,ctz:"America/Argentina/Buenos_Aires"});return `https://calendar.google.com/calendar/render?${params.toString()}`;}
function savePhotoSession(form){const data=Object.fromEntries(new FormData(form)),client=state.clients.find(item=>item.id===data.clientId);if(!client)return false;const session={date:data.date,time:data.time,location:data.location.trim(),includesFashionProduction:form.elements.includesFashionProduction.checked,includesMakeupHair:form.elements.includesMakeupHair.checked,notes:String(data.notes||"").trim(),updatedAt:new Date().toISOString()};if(!session.date||!session.time||!session.location){toast("Completá día, hora y lugar de la sesión.");return false;}client.photoSession=session;client.history=client.history||[];client.history.push({date:session.updatedAt,text:`Sesión de fotos agendada para ${sessionDateTimeText(session)} en ${session.location}`,type:"photo_session",photoSession:session});const _coordTask=client.tasks.find(t=>t.key==="coordinateSession");if(_coordTask&&_coordTask.status!=="done"){_coordTask.status="done";_coordTask.completedAt=session.date||todayIso();}saveState();window.open(googleCalendarUrl(client,session),"_blank","noopener,noreferrer");toast("Sesión guardada y Google Calendar abierto");return true;}
function clientCards(clients) { return clients.length ? [...clients].sort((a,b)=>clientViewMode==="archived"?parseDate(b.eventDate)-parseDate(a.eventDate):parseDate(a.eventDate)-parseDate(b.eventDate)).map(c => `<article class="client-card ${isPastEvent(c)?"archived-card":""}"><div class="client-card-top"><span class="tag${c.isExternal?" external":""}">${c.isExternal?"Externo":isPastEvent(c)?"Realizado":packLabel(c.pack)}</span><span class="muted">${dateText(c.eventDate)}</span></div><h3>${escapeHtml(c.honoree)}</h3><p>#${escapeHtml(c.code)} · ${escapeHtml(c.salon)} · ${escapeHtml(c.type)}</p><div class="session-note ${c.photoSession?.date?"scheduled":""}">${escapeHtml(photoSessionSummary(c))}</div><div class="progress-line"><i style="width:${progress(c)}%"></i></div><div class="card-meta"><span>${progress(c)}% completo</span><span>${c.tasks.filter(t=>t.status==="pending").length} pendientes</span></div><div class="card-actions"><button class="whatsapp-btn ${!c.clientPhone?"missing":c.contactedAt?"contacted":""}" type="button" data-contact-client="${c.id}">${!c.clientPhone?"Agregar WhatsApp":c.contactedAt?`<span>Contactado</span><small>${dateText(isoDate(c.contactedAt))}</small>`:"Contactar"}</button><button class="whatsapp-btn ${!c.whatsappGroupUrl?"missing":""}" type="button" data-whatsapp-group="${c.id}">${c.whatsappGroupUrl?"Grupo WhatsApp":"Agregar grupo"}</button><button class="secondary-btn" data-photo-session="${c.id}">Agendar sesión de fotos</button><button class="secondary-btn" data-open-client="${c.id}">Ver tareas</button><button class="ghost-btn" data-edit-client="${c.id}">Editar</button></div></article>`).join("") : empty(clientViewMode==="archived"?"Todavía no hay eventos realizados":"No hay eventos para estos filtros", clientViewMode==="archived"?"Cuando pase la fecha, aparecerán automáticamente aquí.":"Probá otro salón, mes o criterio de búsqueda."); }
function progress(c) { const applicable=c.tasks.filter(t=>t.status!=="na"); return applicable.length ? Math.round(applicable.filter(t=>t.status==="done").length/applicable.length*100) : 0; }
function empty(title, text) { return `<div class="empty"><strong>${title}</strong>${text}</div>`; }

function matchesTaskSearch(c, q) { if (!q) return true; const text = q.toLowerCase().trim(); return [String(c.code || ""), String(c.honoree || ""), String(c.clientName || ""), dateText(c.eventDate), String(c.eventDate || "")].some(v => v.toLowerCase().includes(text)); }
function globalTaskItems(salon = "", search = "") { return state.clients.filter(c => !isPastEvent(c) && (!salon || c.salon === salon) && matchesTaskSearch(c, search)).flatMap(c => c.tasks.filter(t => !["done", "na"].includes(t.status)).map(t => ({ c, t }))); }
function filterByRole(items, role) { return role === "todos" ? items : items.filter(({ t }) => { const r = taskRole(t.key); return r === "ambos" || r === role; }); }
function setTaskRoleFilter(role) { taskRoleFilter = role; localStorage.setItem("janosTaskRole", role); renderTasks(); }
function setTaskSalonFilter(salon) { taskSalonFilter = salon; localStorage.setItem("janosTaskSalon", salon); renderTasks(); }
function taskViewData() {
  const all = globalTaskItems(taskSalonFilter, taskSearchFilter);
  const fotoCount = filterByRole(all, "foto").length, videoCount = filterByRole(all, "video").length, todosCount = all.length;
  const items = filterByRole(all, taskRoleFilter).sort((a, b) => daysUntil(a.c.eventDate) - daysUntil(b.c.eventDate));
  const groups = [];
  items.forEach(({ c, t }) => { let g = groups.find(x => x.c.id === c.id); if (!g) { g = { c, tasks: [] }; groups.push(g); } g.tasks.push(t); });
  const body = groups.length ? groups.map(g => `<div class="panel task-group"><div class="panel-head"><div><h3>${escapeHtml(g.c.honoree)}</h3><span class="muted">#${escapeHtml(g.c.code)} · ${dateText(g.c.eventDate)} · ${escapeHtml(g.c.salon)}</span></div><button class="ghost-btn" data-open-client="${g.c.id}">Ver ficha</button></div><div class="panel-body">${g.tasks.map(t => taskRow(g.c, t)).join("")}</div></div>`).join("") : empty("Sin tareas pendientes", "No hay tareas pendientes para este filtro.");
  return { fotoCount, videoCount, todosCount, body };
}
function filterTasks() {
  taskSearchFilter = document.getElementById("taskSearch")?.value || "";
  const { fotoCount, videoCount, todosCount, body } = taskViewData();
  const groupsEl = document.getElementById("taskGroups"); if (groupsEl) groupsEl.innerHTML = body;
  const tb = document.getElementById("taskCountTodos"); if (tb) tb.textContent = todosCount;
  const fb = document.getElementById("taskCountFoto"); if (fb) fb.textContent = fotoCount;
  const vb = document.getElementById("taskCountVideo"); if (vb) vb.textContent = videoCount;
}
function renderTasks() {
  const view = document.getElementById("tasksView"); if (!view) return;
  const salons = [...new Set([...MANAGED_SALONS, ...state.clients.map(c => String(c.salon || "").trim()).filter(Boolean)])];
  const { fotoCount, videoCount, todosCount, body } = taskViewData();
  view.innerHTML = `<div class="rendition-controls"><div class="view-switch" aria-label="Filtrar tareas por rol"><button class="${taskRoleFilter === "todos" ? "active" : ""}" data-task-role="todos">Todos <b id="taskCountTodos">${todosCount}</b></button><button class="${taskRoleFilter === "foto" ? "active" : ""}" data-task-role="foto">📷 Fotógrafo <b id="taskCountFoto">${fotoCount}</b></button><button class="${taskRoleFilter === "video" ? "active" : ""}" data-task-role="video">🎥 Videógrafo <b id="taskCountVideo">${videoCount}</b></button></div><input id="taskSearch" placeholder="Buscar por código o fecha" value="${escapeHtml(taskSearchFilter)}"><select id="taskSalonFilter" aria-label="Filtrar por salón"><option value="">Todos los salones</option>${salons.map(s => `<option value="${escapeHtml(s)}" ${taskSalonFilter === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}</select></div><div id="taskGroups" class="task-groups">${body}</div>`;
}

let renditionCategoryFilter = "";
function renderRenditions() {
  const activeCount=state.renditions.filter(r=>!r.archivedAt).length,archivedCount=state.renditions.length-activeCount;
  const rows=state.renditions.filter(r=>renditionViewMode==="archived"?Boolean(r.archivedAt):!r.archivedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const categories=["PERSONAL FOTOGRAFIA","PERSONAL VIDEO","COMPLEMENTOS","GUARDIA FOTO","GUARDIA VIDEO"];
  const categorySummary=categories.map(cat=>{const total=rows.filter(r=>r.category===cat).reduce((s,r)=>s+Number(r.amount||0),0);return total>0?`<div class="category-kpi"><span>${cat}</span><strong>${money(total)}</strong></div>`:""}).join("");
  document.getElementById("renditionsView").innerHTML = `<div class="rendition-controls"><div class="view-switch" aria-label="Archivo de rendiciones"><button class="${renditionViewMode==="active"?"active":""}" data-rendition-view="active">Activas <b>${activeCount}</b></button><button class="${renditionViewMode==="archived"?"active":""}" data-rendition-view="archived">Archivadas <b>${archivedCount}</b></button></div><select id="renditionCategoryFilter"><option value="">Todas las categorías</option>${categories.map(c=>`<option value="${c}">${c}</option>`).join("")}</select><select id="renditionFilter"><option value="">Todos los estados</option>${Object.entries(RENDITION_STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select><button class="secondary-btn" id="exportRenditionsCsv" title="Exporta las rendiciones pendientes en el formato que usa el script de carga automática">Exportar CSV</button></div>${categorySummary?`<div class="category-summary">${categorySummary}</div>`:""}<div class="rendition-total" aria-live="polite"><div><span>Total a cobrar</span><small id="renditionTotalCount">${renditionCountLabel(rows.length)}</small></div><strong id="renditionTotalAmount">${money(renditionTotal(rows))}</strong></div><div class="panel"><div class="rendition-row header"><span>Trabajo</span><span>Evento</span><span>Categoría</span><span>Importe</span><span>Estado</span><span>Acciones</span></div><div id="renditionRows">${renditionRows(rows)}</div></div>`;
  const cf=document.getElementById("renditionCategoryFilter");if(cf)cf.value=renditionCategoryFilter;
  const rf=document.getElementById("renditionFilter");if(rf)rf.value="";
}
function renditionTotal(rows){return rows.reduce((total,item)=>total+Number(item.amount||0),0);}
function renditionCountLabel(count){return `${count} ${count===1?"trabajo visible":"trabajos visibles"}`;}
function updateRenditionTotal(rows){const amount=document.getElementById("renditionTotalAmount"),count=document.getElementById("renditionTotalCount");if(amount)amount.textContent=money(renditionTotal(rows));if(count)count.textContent=renditionCountLabel(rows.length);}
function renditionRows(rows) { return rows.length ? rows.map(r=>{const c=state.clients.find(x=>x.id===r.clientId),processed=r.status!=="pending";const actions=r.archivedAt?`<button class="small-btn" data-restore-rendition="${r.id}">Restaurar</button><button class="small-btn danger" data-delete-rendition="${r.id}">Eliminar</button>`:processed?`<button class="small-btn" data-archive-rendition="${r.id}">Archivar</button><button class="small-btn danger" data-delete-rendition="${r.id}">Eliminar</button>`:`<span class="muted">Rendila para archivar</span>`; return `<div class="rendition-row"><div><strong>${escapeHtml(r.work)}</strong><small>${escapeHtml(c?.honoree||"Cliente eliminado")} · realizado ${r.workDate?dateText(r.workDate):"sin fecha"}</small></div><span>${c?dateText(c.eventDate):"-"}</span><span class="muted">${escapeHtml(r.category)}<br><small>Cierre ${r.periodEnd?dateText(r.periodEnd):"-"}</small></span><span class="money">${money(r.amount)}</span><select data-rendition-status="${r.id}" ${r.archivedAt?"disabled title=\"Restaurá la rendición para cambiar su estado\"":""}>${Object.entries(RENDITION_STATUS).map(([k,v])=>`<option value="${k}" ${r.status===k?"selected":""}>${v}</option>`).join("")}</select><div class="rendition-actions">${actions}</div></div>`;}).join("") : empty(renditionViewMode==="archived"?"No hay rendiciones archivadas":"Sin rendiciones activas", renditionViewMode==="archived"?"Las rendiciones que archives aparecerán aquí.":"Al completar un trabajo remunerado aparecerá aquí."); }

function logRenditionArchive(item, archived){const client=state.clients.find(c=>c.id===item.clientId);if(!client)return;client.history=client.history||[];client.history.push({date:new Date().toISOString(),text:`Rendición ${archived?"archivada":"restaurada"}: ${item.work}`,type:"rendition_archive",renditionId:item.id,archived});}
function archiveRendition(id){const item=state.renditions.find(r=>r.id===id);if(!item)return;if(item.status==="pending"){toast("Primero marcá la rendición como rendida.");return;}item.archivedAt=new Date().toISOString();logRenditionArchive(item,true);saveState();toast("Rendición archivada");}
function restoreRendition(id){const item=state.renditions.find(r=>r.id===id);if(!item)return;item.archivedAt="";logRenditionArchive(item,false);saveState();toast("Rendición restaurada");}
function deleteRendition(id){const item=state.renditions.find(r=>r.id===id);if(!item)return;const client=state.clients.find(c=>c.id===item.clientId);if(client){client.history=client.history||[];client.history.push({date:new Date().toISOString(),text:`Rendición eliminada: ${item.work}`,type:"rendition_delete",renditionId:item.id});}state.renditions=state.renditions.filter(r=>r.id!==id);saveState();toast("Rendición eliminada");}

function renderSettings() {
  document.getElementById("settingsView").innerHTML = `<div class="settings-grid"><details class="panel rates-panel"><summary class="panel-head rates-summary"><h2>Modificar tarifas vigentes</h2><span class="collapse-icon">▶</span></summary><div class="panel-body">${Object.entries(state.rates).map(([key,val])=>`<label class="rate-row"><span>${rateLabel(key)}</span><input type="number" min="0" data-rate="${key}" value="${val}"></label>`).join("")}<div class="modal-actions"><button class="primary-btn" id="saveRates">Guardar tarifas</button></div></div></details><details class="panel"><summary class="panel-head rates-summary"><h2>Datos y copias de seguridad</h2><span class="collapse-icon">▶</span></summary><div class="panel-body stack"><p class="muted">Generá una copia de seguridad periódicamente. Incluye clientes, tareas, rendiciones y tarifas.</p><button class="secondary-btn" id="exportBackup">Exportar copia JSON</button><label class="secondary-btn" style="text-align:center">Importar copia<input id="importBackup" type="file" accept="application/json" hidden></label><p class="muted">Usá este botón si cambiaron los servicios contratados de un evento (pack, adicionales o flex) y las tareas no se actualizaron. No borra el progreso ya cargado.</p><button class="secondary-btn" id="regenerateTasks">Actualizar plan de trabajo de todos los eventos</button><button class="danger-btn" id="clearData">Borrar todos los datos</button></div></details><details class="panel whatsapp-settings"><summary class="panel-head rates-summary"><h2>Mensaje inicial de WhatsApp</h2><span class="collapse-icon">▶</span></summary><div class="panel-body"><label>Texto del mensaje<textarea id="whatsappTemplate" rows="7">${escapeHtml(state.settings?.whatsappTemplate||DEFAULT_WHATSAPP_TEMPLATE)}</textarea></label><p class="template-help">Variables disponibles: <code>{nombre}</code> <code>{homenajeado}</code> <code>{fecha}</code> <code>{salon}</code> <code>{tipo}</code> <code>{codigo}</code> <code>{remitente}</code></p><div class="modal-actions"><button class="secondary-btn" id="resetWhatsappTemplate">Restaurar original</button><button class="primary-btn" id="saveWhatsappTemplate">Guardar mensaje</button></div></div></details></div>`;
}
function accessDate(value){return value?new Intl.DateTimeFormat("es-AR",{dateStyle:"short",timeStyle:"short"}).format(new Date(value)):"Nunca";}
function renderUsers(){const view=document.getElementById("usersView");if(!view)return;if(accessProfile.role!=="admin"){view.innerHTML="";return;}view.innerHTML=`<div class="panel users-panel"><div class="panel-head"><div><h2>Usuarios registrados</h2><span class="muted">${adminUsers.length} cuentas</span></div></div><div class="user-row header"><span>Usuario</span><span>WhatsApp</span><span>Registro</span><span>Último acceso</span><span>Estado</span></div>${adminUsers.map(user=>`<div class="user-row"><div><strong>${escapeHtml(user.display_name||"Sin nombre")}</strong><small>${escapeHtml(user.email||"")}${user.role==="admin"?" · Administrador":""}</small></div><span>${escapeHtml(user.whatsapp||"Sin informar")}</span><span>${accessDate(user.created_at)}</span><span>${accessDate(user.last_seen_at)}</span><div>${user.role==="admin"?`<span class="status-pill active">Administrador</span>`:`<button class="small-btn ${user.status==="blocked"?"":"danger"}" data-user-status="${user.id}" data-next-status="${user.status==="blocked"?"active":"blocked"}">${user.status==="blocked"?"Reactivar":"Bloquear"}</button><button class="small-btn danger" data-delete-user="${user.id}">Eliminar</button>`}</div></div>`).join("")}</div>`;}
async function changeUserStatus(id,status){const user=adminUsers.find(item=>item.id===id);if(!user||!confirm(`¿${status==="blocked"?"Bloquear":"Reactivar"} la cuenta de ${user.display_name||user.email}?`))return;try{await setUserStatus(id,status);if(status==="active"&&user.email){try{await notifyUserApproved(id,user.email,user.display_name||"");toast("Usuario reactivado y notificado por email");}catch(e){console.error(e);toast("Usuario reactivado · no se pudo enviar el email");}}else{toast(status==="blocked"?"Usuario bloqueado":"Usuario reactivado");}adminUsers=await listUserProfiles();renderUsers();}catch(error){console.error(error);toast("No se pudo cambiar el acceso");}}
async function deleteUserAccount(id){const user=adminUsers.find(item=>item.id===id);if(!user||!confirm(`¿Eliminar definitivamente la cuenta de ${user.display_name||user.email}? Esta acción no se puede deshacer.`))return;try{await deleteUser(id);toast("Usuario eliminado");adminUsers=await listUserProfiles();renderUsers();}catch(error){console.error(error);toast("No se pudo eliminar el usuario");}}
function rateLabel(k) { return ({gold:"Gold completo",silver:"Silver completo",book:"Book completo",eventCoverage:"Cobertura evento",eventEdit:"Edición evento",bookCoverage:"Cobertura book",bookEdit:"Edición book",informal:"Informal completo",informalRecording:"Informal solo grabación",ceremony:"Ceremonia completa",ceremonyRecording:"Ceremonia grabación",ceremonyEdit:"Ceremonia edición",drone:"Drone",photoExtra:"Fotógrafo extra",videoExtra:"Videógrafo extra",liveEditor:"Edición en vivo",signatureDesign:"Diseño libro firmas + mural",partyBookDesign:"Diseño libro fiesta",videoExtraClip:"Video crono/entrada",albumInteractive:"Álbum interactivo",droneEdit:"Edición drone FPV",assistant:"Asistente book",extraSheet:"Pliego extra",churchUpgrade:"Iglesia por upgrade",totemDigital:"Tótem / Televisor Fotografía Digital",bookModa:"Adicional book con Moda",extraCameraEdit:"Adicional cámara edición video"})[k]||k; }


const MANUAL_WORKS = {
  "PERSONAL FOTOGRAFIA": [
    { label: "Fiesta (cobertura y edicion)", rate: "silver" },
    { label: "Sesion de fotos (cobertura + edicion)", rate: "book" },
    { label: "Evento Informal", rate: "informal" },
    { label: "Civil (valor book)", rate: "book" },
    { label: "Iglesia fuera del salon (canje del book)", rate: "book" },
    { label: "Templo Bar/Bat (valor book)", rate: "book" },
    { label: "Iglesia fuera del salon (extra por upgrade)", rate: "churchUpgrade" },
    { label: "Adicional ceremonia en salon", rate: "ceremony" },
    { label: "Adicional book con produccion de moda", rate: "bookModa" },
    { label: "Asistente book moda o Palacio", rate: "assistant" },
    { label: "Evento Corporativo", rate: null },
    { label: "VIATICOS (SOLO FOTOGRAFO)", rate: null },
    { label: "Sesion Sans Souci (cobertura + edicion)", rate: "book" },
    { label: "Fotografo extra", rate: "photoExtra" },
  ],
  "PERSONAL VIDEO": [
    { label: "Fiesta (grabacion + edicion)", rate: null },
    { label: "Fiesta (cobertura sin edicion)", rate: "eventCoverage" },
    { label: "Fiesta (edicion)", rate: "eventEdit" },
    { label: "Sesion de fotos (grabacion + edicion back)", rate: null },
    { label: "Sesion de fotos (solo grabacion)", rate: "bookCoverage" },
    { label: "Sesion de fotos (solo edicion)", rate: "bookEdit" },
    { label: "Civil (valor book)", rate: "book" },
    { label: "Adicional ceremonia en salon", rate: "ceremony" },
    { label: "Adicional ceremonia en salon solo grabacion", rate: "ceremonyRecording" },
    { label: "Adicional ceremonia en salon solo edicion", rate: "ceremonyEdit" },
    { label: "Adicional camara edicion video", rate: "extraCameraEdit" },
    { label: "Iglesia fuera del salon (canje del book)", rate: "book" },
    { label: "Templo Bar/Bat (valor book)", rate: "book" },
    { label: "Iglesia fuera del salon (extra por upgrade)", rate: "churchUpgrade" },
    { label: "Adicional book con produccion de moda", rate: "bookModa" },
    { label: "Evento Corporativo (grabacion + edicion)", rate: null },
    { label: "Evento Corporativo (solo grabacion)", rate: null },
    { label: "Evento Corporativo (solo edicion)", rate: null },
    { label: "Evento Informal (grabacion + edicion)", rate: null },
    { label: "Evento Informal (solo grabacion)", rate: "informalRecording" },
    { label: "Evento Informal (solo edicion)", rate: null },
    { label: "VIATICOS (SOLO VIDEOGRAFO)", rate: null },
    { label: "Videografo extra", rate: "videoExtra" },
    { label: "Clip actuado amigas (valor book)", rate: "book" },
    { label: "Edicion de video Drone FPV", rate: "droneEdit" },
  ],
  "COMPLEMENTOS": [
    { label: "Drone en evento", rate: "drone" },
    { label: "Drone en sesion de fotos", rate: "drone" },
    { label: "Edicion en vivo (video fin de fiesta)", rate: "liveEditor" },
    { label: "Diseño Libro de firmas + mural", rate: "signatureDesign" },
    { label: "Diseño Libro de fiesta post evento", rate: "partyBookDesign" },
    { label: "Diseño pliego extra libro", rate: "extraSheet" },
    { label: "Video cronologico extra o video de entrada", rate: "videoExtraClip" },
    { label: "Clip actuado amigas (valor book)", rate: "book" },
    { label: "Album interactivo (fotografo)", rate: "albumInteractive" },
    { label: "Album interactivo (videografo)", rate: "albumInteractive" },
    { label: "Fotografo extra", rate: "photoExtra" },
    { label: "Videografo extra", rate: "videoExtra" },
    { label: "Totem digital en evento con impresiones de pack", rate: "totemDigital" },
    { label: "Asistente book moda o Palacio", rate: "assistant" },
    { label: "Adicional camara edicion video", rate: "extraCameraEdit" },
    { label: "DRONE FPV (solo edicion)", rate: "droneEdit" },
    { label: "Glam Cam 360", rate: null },
    { label: "Party Cam 360", rate: null },
    { label: "Music Video", rate: null },
    { label: "INFINITY BOX", rate: null },
    { label: "Holograma recepcion", rate: null },
    { label: "Centro de mesa interactivo x1", rate: null },
    { label: "Mapping Globo", rate: null },
    { label: "Maquillaje", rate: null },
    { label: "Maquillaje plus", rate: null },
    { label: "Maquillaje x2 plus", rate: null },
    { label: "ADICIONAL MAQUILLAJE EVENTO", rate: null },
    { label: "ADICIONAL MAQUILLAJE RECEPCION", rate: null },
    { label: "MAQUILLAJE BOOK", rate: null },
    { label: "Vestuario, maquillaje y peinado book moda", rate: "bookModa" },
    { label: "Fashion look", rate: null },
    { label: "Invitacion interactiva", rate: null },
    { label: "Televisor Fotografia Digital", rate: null },
    { label: "Pulseras LED", rate: null },
  ]
};

function openManualRenditionDialog() {
  const salons = [...MANAGED_SALONS];
  document.getElementById("manualRenditionSalon").innerHTML = salons.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("") + '<option value="Otro">Otro</option>';
  document.getElementById("manualRenditionDate").value = "";
  document.getElementById("manualRenditionAmount").value = "";
  document.getElementById("manualRenditionNotes").value = "";
  document.getElementById("manualRenditionCategory").value = "PERSONAL FOTOGRAFIA";
  updateManualRenditionWorks();
  document.getElementById("manualRenditionDialog").showModal();
}
function updateManualRenditionWorks() {
  const cat = document.getElementById("manualRenditionCategory").value;
  const works = MANUAL_WORKS[cat] || [];
  document.getElementById("manualRenditionWork").innerHTML = works.map(w => `<option value="${escapeHtml(w.label)}" data-rate="${w.rate||""}">${escapeHtml(w.label)}</option>`).join("");
  updateManualRenditionRate();
}
function updateManualRenditionRate() {
  const sel = document.getElementById("manualRenditionWork");
  const opt = sel && sel.options[sel.selectedIndex];
  const rateKey = opt ? opt.getAttribute("data-rate") : "";
  const eventDate = document.getElementById("manualRenditionDate").value;
  const amount = rateKey ? (getRate(rateKey, eventDate) || "") : "";
  document.getElementById("manualRenditionAmount").value = amount;
}
function saveManualRendition() {
  const date = document.getElementById("manualRenditionDate").value;
  const salon = document.getElementById("manualRenditionSalon").value;
  const category = document.getElementById("manualRenditionCategory").value;
  const work = document.getElementById("manualRenditionWork").value;
  const amount = Number(document.getElementById("manualRenditionAmount").value);
  const notes = document.getElementById("manualRenditionNotes").value.trim();
  if (!date) { toast("Ingresá la fecha del evento."); return; }
  if (!amount || amount <= 0) { toast("Ingresá el importe."); return; }
  const rendition = {
    id: uid(), clientId: null, taskId: null,
    work, category, amount,
    eventDate: date, salon,
    notes: notes || undefined,
    status: "pending",
    isManual: true,
    createdAt: new Date().toISOString()
  };
  state.renditions.push(rendition);
  saveState();
  toast("Rendición manual cargada");
  document.getElementById("manualRenditionDialog").close();
  renderRenditions();
}

function openClientForm(client=null) {
  const form=document.getElementById("clientForm"); form.reset(); form.elements.id.value=client?.id||"";
  document.getElementById("clientDialogTitle").textContent=client?"Editar cliente":"Nuevo cliente";
  document.getElementById("deleteClientFromForm").classList.toggle("hidden",!client);
  if(client) ["code","eventDate","salon","type","honoree","clientName","clientPhone","whatsappGroupUrl","guests","pack","notes"].forEach(k=>form.elements[k].value=client[k]??"");
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
  data.whatsappGroupUrl=String(data.whatsappGroupUrl||"").trim();
  if(data.clientPhone&&whatsappNumber(data.clientPhone).length<12){toast("Ingresá el WhatsApp con código de área, por ejemplo +54 9 11 1234 5678.");form.elements.clientPhone.focus();return false;}
  const limit=addons.includes("flex")?5:addons.includes("miniflex")?2:0; if(limit&&flexServices.length>limit){toast(`Elegí como máximo ${limit} servicios para ${limit===2?"Mini Flex":"Flex"}.`); return false;}
  const duplicate=state.clients.find(c=>c.code===data.code&&c.id!==data.id); if(duplicate){toast("Ya existe un cliente con ese código."); return false;}
  if(data.id){const c=state.clients.find(x=>x.id===data.id); Object.assign(c,data,{addons,flexServices,guests:Number(data.guests||0)}); syncTasks(c);}
  else {const client={...data,id:uid(),addons,flexServices,guests:Number(data.guests||0),createdAt:new Date().toISOString(),history:[{date:new Date().toISOString(),text:"Cliente creado"}]}; client.tasks=createTasks(client); state.clients.push(client);}
  saveState(); toast(data.id?"Cliente actualizado":"Cliente creado con su plan de trabajo"); return true;
}
function syncTasks(client) { const existing=new Map(client.tasks.map(t=>[t.key,t])); client.tasks=createTasks(client).map(t=>existing.has(t.key)?{...t,...existing.get(t.key)}:t); client.history.push({date:new Date().toISOString(),text:"Datos del cliente actualizados"}); }
function tasksAtRiskOnRegenerate(){const atRisk=[];state.clients.forEach(c=>{const newKeys=new Set(createTasks(c).map(t=>t.key));c.tasks.forEach(t=>{if(t.status!=="pending"&&!newKeys.has(t.key))atRisk.push({c,t});});});return atRisk;}

function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""));}
function normalizeIds(){const clientMap=new Map(),taskMap=new Map();state.clients.forEach(client=>{if(!isUuid(client.id)){const old=client.id;client.id=uid();clientMap.set(old,client.id);}client.tasks.forEach(task=>{if(!isUuid(task.id)){const old=task.id;task.id=uid();taskMap.set(old,task.id);}});});state.renditions.forEach(item=>{if(clientMap.has(item.clientId))item.clientId=clientMap.get(item.clientId);if(taskMap.has(item.taskId))item.taskId=taskMap.get(item.taskId);if(!isUuid(item.id))item.id=uid();});}
function setSyncStatus(text){const el=document.getElementById("syncStatus");if(el)el.textContent=text;}
function setConflictBanner(visible){const el=document.getElementById("conflictBanner");if(el)el.classList.toggle("hidden",!visible);}
function scheduleCloudSync(){if(!cloudEnabled||!currentUser)return;clearTimeout(cloudTimer);cloudTimer=setTimeout(runCloudSync,650);}
async function runCloudSync(){if(cloudSyncing||!currentUser)return;cloudSyncing=true;setSyncStatus("Guardando en la nube…");try{normalizeIds();localStorage.setItem(storageKey,JSON.stringify(state));if(remoteSnapshotAt){const latest=await getLatestUpdateAt();if(latest&&latest>remoteSnapshotAt){setSyncStatus("Hay cambios más nuevos en la nube · recargá la página");setConflictBanner(true);return;}}await syncCloudState(state,currentUser);remoteSnapshotAt=new Date().toISOString();setSyncStatus("Sincronizado");}catch(error){console.error(error);setSyncStatus("Sin conexión · copia local guardada");toast("No se pudo sincronizar. El cambio quedó guardado localmente.");}finally{cloudSyncing=false;}}

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
function parseAddons(raw){const text=String(raw||"").toUpperCase(),items=[];const rules=[["pant",/PANT/],["pixel",/PIXEL/],["miniflex",/UP\.?MFLEX|MINI\s*FLEX/],["flex",/UP\.FLEX|\bFLEX\b/],["libro",/LIBRO/],["maqui",/MAQUI/],["moda",/\bMODA\b/],["drone",/DRONE/],["sansSouci",/SANS\s*SOUCI/]];rules.forEach(([key,regex])=>{if(regex.test(text))items.push(key);});if(items.includes("miniflex"))return [...new Set(items.filter(x=>x!=="flex"))];return [...new Set(items)];}
function parseFlexServices(raw){const text=String(raw||"").toUpperCase(),items=[];const rules=[["church",/IGLESIA|TEMPLO/],["civil",/CIVIL/],["droneEvent",/DRONE.*(EVENTO|RECEPC)/],["droneBook",/DRONE.*(BOOK|SESION)/],["photoExtra",/FOTOGRAFO EXTRA/],["videoExtra",/VIDEOGRAFO EXTRA/],["signatureBook",/LIBRO.*FIRMA/],["partyBook",/LIBRO.*FIESTA/],["liveEditor",/EDITOR.*VIVO|EDICION EN VIVO/],["friendsVideo",/VIDEO.*AMIG/],["extraSession",/SESION EXTRA/]];rules.forEach(([key,regex])=>{if(regex.test(text))items.push(key);});return items;}
async function importClientCsv(file){
  const bytes=await file.arrayBuffer();let text=new TextDecoder("utf-8").decode(bytes);if(text.includes("�"))text=new TextDecoder("windows-1252").decode(bytes);text=text.replace(/^\uFEFF/,"");
  const rows=parseCsv(text);if(!rows.length){toast("El CSV no contiene filas para importar.");return;}
  let created=0,existingSkipped=0,skipped=0,duplicatedInFile=0;const seenCodes=new Set();
  const conflicts=[];
  rows.forEach(row=>{const code=firstValue(row,["codigo","codigo_evento","cod_evento","evento"]),eventDate=normalizeDate(firstValue(row,["fecha","fecha_evento","fecha_del_evento"]));if(!code||!eventDate){skipped+=1;return;}if(seenCodes.has(String(code))){duplicatedInFile+=1;return;}seenCodes.add(String(code));
    const existing=state.clients.find(c=>String(c.code)===String(code));
    const rawPack=firstValue(row,["pack_upgrades","pack_y_upgrades","fotografia","pack","servicios"]),addonsText=[rawPack,firstValue(row,["adicionales","upgrades","complementos"])].filter(Boolean).join(" "),flexText=firstValue(row,["servicios_flex","elecciones_flex","mini_flex","flex"]);
    const csvPack=parsePack(rawPack),csvAddons=parseAddons(addonsText),csvFlex=parseFlexServices(flexText);
    if(existing){
      const packChanged=existing.pack!==csvPack;
      const addonsChanged=JSON.stringify([...existing.addons].sort())!==JSON.stringify([...csvAddons].sort());
      if(!packChanged&&!addonsChanged){existingSkipped+=1;return;}
      const diffs=[];
      if(packChanged)diffs.push(`Pack: ${packLabel(existing.pack)} → ${packLabel(csvPack)}`);
      if(addonsChanged)diffs.push(`Adicionales: [${existing.addons.join(", ")||"ninguno"}] → [${csvAddons.join(", ")||"ninguno"}]`);
      conflicts.push({client:existing,csvPack,csvAddons,csvFlex,diffs});
      return;
    }
    const incoming={code,eventDate,salon:firstValue(row,["salon","sede"])||"Otro",type:firstValue(row,["tipo","tipo_evento"])||"Otro",honoree:firstValue(row,["homenajeado","homenajeada","homenajead","nombre_evento"])||firstValue(row,["cliente","nombre_cliente"])||`Evento ${code}`,clientName:firstValue(row,["cliente","nombre_cliente","contacto_cliente"]),clientPhone:(()=>{const raw=firstValue(row,["whatsapp","telefono","telefono_cliente","celular"]);return raw&&raw.replace(/\D/g,"").length>=8?raw:"";})(),guests:Number(firstValue(row,["invitados","cantidad_invitados"])||0),pack:csvPack,addons:csvAddons,flexServices:csvFlex,notes:firstValue(row,["notas","observaciones","comentarios"])};const client={...incoming,id:uid(),createdAt:new Date().toISOString(),history:[{date:new Date().toISOString(),text:"Cliente importado desde CSV"}]};client.tasks=createTasks(client);state.clients.push(client);created+=1;});
  // Process conflicts one by one
  let updated=0;
  for(const {client,csvPack,csvAddons,csvFlex,diffs} of conflicts){
    const msg=`Cliente: ${client.honoree} (#${client.code})\n\nCambios detectados en el CSV:\n${diffs.join("\n")}\n\n¿Aplicar estos cambios?`;
    if(confirm(msg)){client.pack=csvPack;client.addons=csvAddons;client.flexServices=csvFlex;syncTasks(client);updated+=1;}else{existingSkipped+=1;}
  }
  saveState();toast(`${created} nuevos agregados${updated?` · ${updated} actualizados`:""}${existingSkipped?` · ${existingSkipped} sin cambios`:""}${duplicatedInFile?` · ${duplicatedInFile} código(s) repetido(s) en el archivo`:""}${skipped?` · ${skipped} filas omitidas`:""}`);
}
function downloadClientTemplate(){const content="codigo;fecha_evento;salon;tipo;homenajeado;cliente;whatsapp;invitados;pack_upgrades;adicionales;servicios_flex;observaciones\n43828;04/07/2026;Pilar Hotel;15;Cliente de ejemplo;Contacto;+54 9 11 1234 5678;120;(SILVER)(GOLD)(PANT);PIXEL;;\n";const blob=new Blob(["\uFEFF"+content],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="plantilla_clientes_janos.csv";a.click();URL.revokeObjectURL(a.href);}
function escapeCsvCell(value){const text=String(value??"");return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function exportRenditionsCsv(){const rows=state.renditions.filter(r=>r.status==="pending"&&!r.archivedAt);if(!rows.length){toast("No hay rendiciones pendientes para exportar.");return;}const header=["categoria","fecha","salon","trabajo","observaciones"];const lines=rows.map(r=>{const client=state.clients.find(c=>c.id===r.clientId);return [r.category,dateText(r.workDate),client?.salon||"",r.work,r.observations||""].map(escapeCsvCell).join(",");});const content=[header.join(","),...lines].join("\r\n")+"\r\n";const blob=new Blob(["\uFEFF"+content],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`rendiciones_pendientes_${todayIso()}.csv`;a.click();URL.revokeObjectURL(a.href);toast(`${rows.length} rendici\u00F3n${rows.length===1?"":"es"} exportada${rows.length===1?"":"s"}`);}

function generateSelectionBat(clientId) {
  const numerosRaw = document.getElementById(`seleccion-numeros-${clientId}`)?.value.trim();
  const prefijo = document.getElementById(`seleccion-prefijo-${clientId}`)?.value.trim().toUpperCase();
  if (!numerosRaw) { toast("Pegá los números de selección antes de generar."); return; }
  if (!prefijo) { toast("Escribí el prefijo antes de generar."); return; }
  const tokens = numerosRaw.replace(/[-,_./\\;|\s]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) { toast("No se encontraron números válidos."); return; }
  const bat = `@echo off
setlocal enabledelayedexpansion
echo ================================================
echo     COPIADOR DE SELECCION - ${prefijo}
echo ================================================
echo.

set /p "ORIGEN=Pega la ruta de la carpeta con las fotos: "
set "PREFIJO=${prefijo}"
set "DESTINO=%USERPROFILE%\\Desktop\\SELECCION_${prefijo}"
if not exist "%DESTINO%" mkdir "%DESTINO%"

echo.
echo Origen:  %ORIGEN%
echo Prefijo: %PREFIJO%
echo Destino: %DESTINO%
echo.
echo Copiando fotos seleccionadas...
echo.

set COUNT=0
set MISSING=0

set "TMPFILE=%TEMP%\\numeros_tmp_%RANDOM%.txt"
(
${tokens.map(n => `  echo ${n}`).join('\r\n')}
) > "!TMPFILE!"

for /f "usebackq tokens=* delims=" %%N in ("!TMPFILE!") do (
  set "RAW=%%N"
  set "RAW=!RAW: =!"
  set "FOUND=0"

  if not "!RAW!"=="" (
    set /a "INTNUM=!RAW!"

    if exist "%ORIGEN%\\%PREFIJO%-!RAW!.jpg" (
      copy "%ORIGEN%\\%PREFIJO%-!RAW!.jpg" "%DESTINO%\\%PREFIJO%-!RAW!.jpg" >nul
      echo   [OK] %PREFIJO%-!RAW!.jpg
      set /a COUNT+=1
      set "FOUND=1"
    )

    if "!FOUND!"=="0" (
      if exist "%ORIGEN%\\%PREFIJO%-!INTNUM!.jpg" (
        copy "%ORIGEN%\\%PREFIJO%-!INTNUM!.jpg" "%DESTINO%\\%PREFIJO%-!INTNUM!.jpg" >nul
        echo   [OK] %PREFIJO%-!INTNUM!.jpg
        set /a COUNT+=1
        set "FOUND=1"
      )
    )

    if "!FOUND!"=="0" (
      echo   [!!] NO ENCONTRADA: %PREFIJO%-!RAW!.jpg
      set /a MISSING+=1
    )
  )
)

if exist "!TMPFILE!" del "!TMPFILE!"

echo.
echo ================================================
echo  Fotos copiadas:  !COUNT!
echo  No encontradas:  !MISSING!
echo  Carpeta destino: %DESTINO%
echo ================================================
echo.
pause
endlocal`;

  const blob = new Blob([bat], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `COPIAR_SELECCION_${prefijo}.bat`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Script generado: COPIAR_SELECCION_${prefijo}.bat`);
}

function openClientDetail(id) {
  const c=state.clients.find(x=>x.id===id); if(!c)return; const phases=[...new Set(c.tasks.map(t=>t.phase))];
  document.getElementById("clientDetail").innerHTML=`<div class="detail-wrap"><div class="detail-title"><div><p class="eyebrow">#${escapeHtml(c.code)} · ${escapeHtml(c.salon)}</p><h2>${escapeHtml(c.honoree)}</h2><p>${dateText(c.eventDate)} · ${packLabel(c.pack)} · ${escapeHtml(c.type)}</p></div><button class="icon-btn" data-close-detail>×</button></div><div class="detail-summary"><div class="summary-box"><span>Progreso</span><strong>${progress(c)}%</strong></div><div class="summary-box"><span>Cliente</span><strong>${escapeHtml(c.clientName||"Sin informar")}</strong></div><div class="summary-box"><span>Invitados</span><strong>${c.guests||"-"}</strong></div><div class="summary-box"><span>Para rendir</span><strong>${c.tasks.filter(t=>t.payable&&t.status==="done").length}</strong></div></div><div class="photo-session-panel"><div><span>Sesión de fotos</span><strong>${escapeHtml(photoSessionSummary(c))}</strong></div><button class="secondary-btn" data-photo-session="${c.id}">Agendar sesión de fotos</button>${c.photoSession?.date?`<button class="ghost-btn" data-cancel-session="${c.id}">Quitar sesión</button>`:""}</div><details class="photo-selection-panel"><summary class="panel-head photo-selection-summary"><div class="summary-left"><h3>Selección de fotos</h3><small>Generá un script para copiar las fotos elegidas por el cliente</small></div><span class="collapse-icon">▶</span></summary><div class="panel-body"><div class="photo-selection-fields"><label class="photo-selection-label">Números seleccionados<textarea id="seleccion-numeros-${c.id}" class="photo-selection-textarea" placeholder="Ej: 10, 11, 16, 20, 31..." rows="4"></textarea></label><label class="photo-selection-label">Prefijo de archivo<input id="seleccion-prefijo-${c.id}" class="photo-selection-input" type="text" placeholder="Ej: GARCIA" maxlength="40"></label></div><div class="modal-actions" style="margin-top:0.75rem"><button class="primary-btn" data-generate-bat="${c.id}">Descargar script</button></div></div></details>${phases.map(p=>`<h3 class="phase-title">${p}</h3>${c.tasks.filter(t=>t.phase===p).map(t=>taskRow(c,t)).join("")}`).join("")}<div class="modal-actions"><button class="danger-btn" data-delete-client="${c.id}">Eliminar</button><button class="whatsapp-btn ${!c.whatsappGroupUrl?"missing":""}" type="button" data-whatsapp-group="${c.id}">${c.whatsappGroupUrl?"Grupo WhatsApp":"Agregar grupo"}</button><button class="secondary-btn" data-edit-client="${c.id}">Editar ficha</button><button class="primary-btn" data-close-detail>Cerrar</button></div></div>`;
  const dialog=document.getElementById("detailDialog"); if(!dialog.open)dialog.showModal();
}
function taskRow(c,t){
  const needsOrder=t.key==="partyBook";
  const isVideoCapture=["coverageVideoCapture","bookCoverageVideo","flexSessionVideo"].includes(t.key);
  const videoEditChecked=t.includesEdit||false;
  const videoEditCheckbox=isVideoCapture?`<label class="video-edit-check" title="Incluye edición"><input type="checkbox" data-task-video-edit="${c.id}|${t.id}" ${videoEditChecked?"checked":""}> + Edición</label>`:"";
  return `<div class="task-row ${t.status==="done"?"done":""}"><input class="task-check" type="checkbox" data-task-check="${c.id}|${t.id}" ${t.status==="done"?"checked":""}><div class="task-title"><strong>${escapeHtml(t.title)}</strong>${t.payable?`<small>Genera rendición: ${escapeHtml(t.category)} → ${escapeHtml(t.work)}${isVideoCapture?` ${videoEditChecked?"+ edición ($"+money(getRate(t.rateKey,c.eventDate)||0).replace("$","").trim()+")":"(solo cobertura)"}`:""}</small>`:""}${videoEditCheckbox}</div><select data-task-status="${c.id}|${t.id}">${Object.entries(STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${t.status===k?"selected":""}>${v}</option>`).join("")}</select><input type="date" data-task-date="${c.id}|${t.id}" value="${isoDate(t.completedAt)}" title="Fecha real del trabajo"><input data-task-responsible="${c.id}|${t.id}" value="${escapeHtml(t.responsible)}" placeholder="Responsable"><input data-task-notes="${c.id}|${t.id}" value="${escapeHtml(t.notes)}" placeholder="${needsOrder?"N° pedido laboratorio":"Observaciones"}"></div>`;
}
function refreshTaskViews(clientId){const dialog=document.getElementById("detailDialog");if(dialog.open)openClientDetail(clientId);else if(activeView==="tasks")renderTasks();}
function updateTask(clientId,taskId,status){const c=state.clients.find(x=>x.id===clientId),t=c?.tasks.find(x=>x.id===taskId);if(!t)return;if(status==="done"&&t.key==="partyBook"&&!t.notes.trim()){toast("Ingresá el número de pedido del laboratorio antes de terminar esta tarea.");refreshTaskViews(c.id);return;}t.status=status;if(status==="done"&&!t.completedAt)t.completedAt=todayIso();if(status!=="done")t.completedAt="";const existing=state.renditions.find(r=>r.taskId===t.id);const isVideoCapture=["coverageVideoCapture","bookCoverageVideo","flexSessionVideo"].includes(t.key);const baseAmount=getRate(t.rateKey,c.eventDate);const editAmount=t.key==="coverageVideoCapture"?getRate("eventEdit",c.eventDate):getRate("bookEdit",c.eventDate);const amount=isVideoCapture?(t.includesEdit?baseAmount+editAmount:baseAmount):baseAmount;if(status==="done"&&t.payable&&!existing){const workDate=isoDate(t.completedAt)||todayIso();state.renditions.push({id:uid(),clientId:c.id,taskId:t.id,category:t.category,work:t.work+(isVideoCapture&&t.includesEdit?" + edición":""),amount,status:"pending",createdAt:new Date().toISOString(),workDate,periodEnd:periodEndFor(workDate),observations:t.notes||""});}if(status!=="done"&&existing?.status==="pending")state.renditions=state.renditions.filter(r=>r.id!==existing.id);saveState();refreshTaskViews(c.id);toast(status==="done"&&t.payable?"Tarea terminada y rendición agregada":"Tarea actualizada");}
function updateVideoEdit(clientId,taskId,includesEdit){const c=state.clients.find(x=>x.id===clientId),t=c?.tasks.find(x=>x.id===taskId);if(!t)return;t.includesEdit=includesEdit;const existing=state.renditions.find(r=>r.taskId===t.id);if(existing&&existing.status==="pending"){const isVideoCapture=["coverageVideoCapture","bookCoverageVideo","flexSessionVideo"].includes(t.key);const baseAmount=getRate(t.rateKey,c.eventDate);const editAmount=t.key==="coverageVideoCapture"?getRate("eventEdit",c.eventDate):getRate("bookEdit",c.eventDate);existing.amount=includesEdit?baseAmount+editAmount:baseAmount;existing.work=t.work+(includesEdit?" + edición":"");}saveState();refreshTaskViews(c.id);toast(includesEdit?"Edición incluida en la rendición":"Solo cobertura en la rendición");}
function deleteClient(id){state.clients=state.clients.filter(c=>c.id!==id);state.renditions=state.renditions.filter(r=>r.clientId!==id);const detail=document.getElementById("detailDialog"),form=document.getElementById("clientDialog");if(detail.open)detail.close();if(form.open)form.close();saveState();toast("Cliente y registros vinculados eliminados");}

function setView(view){activeView=view;document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`${view}View`));document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));const meta={dashboard:["Resumen operativo","Inicio"],clients:["Gestión de eventos","Clientes"],calendar:["Vista mensual","Calendario"],tasks:["Pendientes por rol","Tareas"],renditions:["Trabajos realizados","Rendiciones"],settings:["Reglas y valores","Configuración"],users:["Administración","Usuarios"]}[view];document.getElementById("viewEyebrow").textContent=meta[0];document.getElementById("viewTitle").textContent=meta[1];document.getElementById("newClientBtn").classList.toggle("hidden",view==="users"||view==="tasks"||view==="renditions");
const manualBtn=document.getElementById("manualRenditionBtn");if(manualBtn)manualBtn.style.display=view==="renditions"?"":"none";document.querySelector(".sidebar").classList.remove("open");}
function toast(msg){const el=document.getElementById("toast");const openDialog=document.querySelector("dialog[open]");(openDialog||document.body).appendChild(el);el.textContent=msg;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600);}

document.addEventListener("click", e => {
  if(e.target.id==="reloadForConflict"){window.location.reload();return;}
  if(e.target.id==="calPrev"){calendarMonth=shiftMonth(calendarMonth,-1);renderCalendar();return;}
  if(e.target.id==="calNext"){calendarMonth=shiftMonth(calendarMonth,1);renderCalendar();return;}
  if(e.target.id==="calToday"){calendarMonth=todayIso().slice(0,7);renderCalendar();return;}
  const nav=e.target.closest("[data-view]"); if(nav)setView(nav.dataset.view);
  const go=e.target.closest("[data-go]"); if(go)setView(go.dataset.go);
  const clientView=e.target.closest("[data-client-view]");if(clientView){clientViewMode=clientView.dataset.clientView;renderClients();}
  const taskRoleBtn=e.target.closest("[data-task-role]");if(taskRoleBtn)setTaskRoleFilter(taskRoleBtn.dataset.taskRole);
  const renditionView=e.target.closest("[data-rendition-view]");if(renditionView){renditionViewMode=renditionView.dataset.renditionView;renderRenditions();}
  const open=e.target.closest("[data-open-client]"); if(open)openClientDetail(open.dataset.openClient);
  const contact=e.target.closest("[data-contact-client]");if(contact)contactClient(contact.dataset.contactClient);
  const whatsappGroup=e.target.closest("[data-whatsapp-group]");if(whatsappGroup)openWhatsappGroup(whatsappGroup.dataset.whatsappGroup);
  const photoSession=e.target.closest("[data-photo-session]");if(photoSession){const detail=document.getElementById("detailDialog");if(detail.open)detail.close();openPhotoSessionForm(photoSession.dataset.photoSession);}
  const cancelSession=e.target.closest("[data-cancel-session]");if(cancelSession&&confirm("¿Quitar la sesión de fotos agendada?")){const c=state.clients.find(x=>x.id===cancelSession.dataset.cancelSession);if(c){c.photoSession=null;const _ct=c.tasks.find(t=>t.key==="coordinateSession");if(_ct&&_ct.status==="done"){_ct.status="pending";_ct.completedAt="";}c.history=c.history||[];c.history.push({date:new Date().toISOString(),text:"Sesión de fotos cancelada",type:"photo_session_cancel"});saveState();openClientDetail(c.id);toast("Sesión de fotos quitada");}}
  const userStatus=e.target.closest("[data-user-status]");if(userStatus)changeUserStatus(userStatus.dataset.userStatus,userStatus.dataset.nextStatus);
  const deleteUserBtn=e.target.closest("[data-delete-user]");if(deleteUserBtn)deleteUserAccount(deleteUserBtn.dataset.deleteUser);
  const edit=e.target.closest("[data-edit-client]"); if(edit){document.getElementById("detailDialog").close();openClientForm(state.clients.find(c=>c.id===edit.dataset.editClient));}
  if(e.target.closest("[data-close-detail]"))document.getElementById("detailDialog").close();
  if(e.target.closest("[data-close-client-form]"))document.getElementById("clientDialog").close();
  if(e.target.closest("[data-close-photo-session]"))document.getElementById("photoSessionDialog").close();
  const generateBat=e.target.closest("[data-generate-bat]");if(generateBat)generateSelectionBat(generateBat.dataset.generateBat);
  const del=e.target.closest("[data-delete-client]"); if(del&&confirm("¿Eliminar este cliente, sus tareas y todas sus rendiciones?"))deleteClient(del.dataset.deleteClient);
  const archive=e.target.closest("[data-archive-rendition]");if(archive)archiveRendition(archive.dataset.archiveRendition);
  const restore=e.target.closest("[data-restore-rendition]");if(restore)restoreRendition(restore.dataset.restoreRendition);
  const deleteWork=e.target.closest("[data-delete-rendition]");if(deleteWork&&confirm("¿Eliminar definitivamente esta rendición? La tarea del cliente se conservará."))deleteRendition(deleteWork.dataset.deleteRendition);
  if(e.target.id==="deleteClientFromForm"){const id=document.getElementById("clientForm").elements.id.value;if(id&&confirm("¿Eliminar este cliente, sus tareas y todas sus rendiciones?"))deleteClient(id);}
  if(e.target.id==="saveRates"){document.querySelectorAll("[data-rate]").forEach(i=>state.rates[i.dataset.rate]=Number(i.value||0));saveState();toast("Tarifas actualizadas");}
  if(e.target.id==="saveWhatsappTemplate"){const template=document.getElementById("whatsappTemplate")?.value.trim();if(!template){toast("El mensaje no puede quedar vacío.");return;}state.settings={...(state.settings||{}),whatsappTemplate:template};saveState();toast("Mensaje de WhatsApp guardado");}
  if(e.target.id==="resetWhatsappTemplate"){const field=document.getElementById("whatsappTemplate");if(field)field.value=DEFAULT_WHATSAPP_TEMPLATE;}
  if(e.target.id==="downloadClientTemplate")downloadClientTemplate();
  if(e.target.id==="exportRenditionsCsv")exportRenditionsCsv();
  if(e.target.id==="importClientsBtn")document.getElementById("clientCsvInput")?.click();
  if(e.target.id==="exportBackup"){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`janos-control-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}
  if(e.target.id==="regenerateTasks"){const atRisk=tasksAtRiskOnRegenerate();const warning=atRisk.length?`\n\nATENCIÓN: ${atRisk.length} tarea(s) con progreso cargado se van a eliminar porque ya no corresponden a las tareas actuales:\n${atRisk.slice(0,8).map(({c,t})=>`- ${c.honoree} #${c.code}: "${t.title}" (${STATUS_LABELS[t.status]||t.status})`).join("\n")}${atRisk.length>8?`\n…y ${atRisk.length-8} más.`:""}`:"";if(confirm(`¿Regenerar las tareas de todos los clientes? Se conservará el progreso de las tareas vigentes.${warning}`)){state.clients.forEach(c=>syncTasks(c));saveState();toast(`Tareas regeneradas para ${state.clients.length} clientes${atRisk.length?` · ${atRisk.length} obsoletas eliminadas`:""}`);}}
  if(e.target.id==="clearData"){const account=currentUser?.email||"modo local";if(confirm(`Esto va a BORRAR todos los clientes, tareas y rendiciones de la cuenta ${account}, incluida la copia en la nube. Esta acción no se puede deshacer.\n\n¿Confirmás que querés borrar todo?`)){state=initialState();saveState();toast("Datos eliminados de esta cuenta");}}
});
document.addEventListener("change", e => {
  if(e.target.matches('[name="addons"][value="miniflex"], [name="addons"][value="flex"]')&&e.target.checked){const other=e.target.value==="flex"?"miniflex":"flex";const otherInput=document.querySelector(`[name="addons"][value="${other}"]`);if(otherInput)otherInput.checked=false;}
  if(e.target.matches('[name="addons"], [name="flexServices"]'))updateFlexField();
  if(e.target.dataset.taskStatus){const [c,t]=e.target.dataset.taskStatus.split("|");updateTask(c,t,e.target.value);}
  if(e.target.dataset.taskResponsible){const [c,t]=e.target.dataset.taskResponsible.split("|");const task=state.clients.find(x=>x.id===c)?.tasks.find(x=>x.id===t);if(task){task.responsible=e.target.value;saveState();}}
  if(e.target.dataset.taskDate){const [c,t]=e.target.dataset.taskDate.split("|"),task=state.clients.find(x=>x.id===c)?.tasks.find(x=>x.id===t);if(task){task.completedAt=e.target.value;const rendition=state.renditions.find(r=>r.taskId===task.id);if(rendition&&e.target.value){rendition.workDate=e.target.value;rendition.periodEnd=periodEndFor(e.target.value);}saveState();}}
  if(e.target.dataset.taskNotes){const [c,t]=e.target.dataset.taskNotes.split("|"),task=state.clients.find(x=>x.id===c)?.tasks.find(x=>x.id===t);if(task){task.notes=e.target.value;const rendition=state.renditions.find(r=>r.taskId===task.id);if(rendition)rendition.observations=e.target.value;saveState();}}
  if(e.target.dataset.renditionStatus){const r=state.renditions.find(x=>x.id===e.target.dataset.renditionStatus);if(r){r.status=e.target.value;saveState();toast("Estado de rendición actualizado");}}
  if(e.target.dataset.taskVideoEdit){const[c,t]=e.target.dataset.taskVideoEdit.split("|");updateVideoEdit(c,t,e.target.checked);}
  if(e.target.id==="renditionFilter"||e.target.id==="renditionCategoryFilter")filterRenditions();
  if(e.target.id==="taskSalonFilter")setTaskSalonFilter(e.target.value);
  if(e.target.id==="calendarSalonFilter"){calendarSalonFilter=e.target.value;localStorage.setItem("janosCalendarSalon",calendarSalonFilter);renderCalendar();}
  if(["clientSalonFilter","clientMonthFilter","clientPackFilter","clientAddonFilter"].includes(e.target.id))filterClients();
  if(e.target.id==="importBackup"){const input=e.target,file=input.files[0];if(file){file.text().then(text=>{let parsed;try{parsed=JSON.parse(text);}catch{toast("El archivo no es una copia válida");input.value="";return;}if(!confirm("Esto va a REEMPLAZAR todos los clientes, tareas y rendiciones actuales (y en la nube) por los de esta copia. Los datos cargados desde que se hizo esta copia se van a perder. Esta acción no se puede deshacer.\n\n¿Confirmás que querés continuar?")){input.value="";return;}state={...initialState(),...parsed};saveState();toast("Copia importada");input.value="";});}}
  if(e.target.id==="clientCsvInput"&&e.target.files[0])importClientCsv(e.target.files[0]).finally(()=>{e.target.value="";});
});
document.addEventListener("input",e=>{if(e.target.id==="clientSearch")filterClients();if(e.target.id==="taskSearch")filterTasks();});
document.addEventListener("change",e=>{if(e.target.dataset.taskCheck){const[c,t]=e.target.dataset.taskCheck.split("|");updateTask(c,t,e.target.checked?"done":"pending");}});
function filterClients(){const q=(document.getElementById("clientSearch")?.value||"").toLowerCase(),salon=document.getElementById("clientSalonFilter")?.value||"",month=document.getElementById("clientMonthFilter")?.value||"",pack=document.getElementById("clientPackFilter")?.value||"",addon=document.getElementById("clientAddonFilter")?.value||"";clientFilters={search:q,salon,month,pack,addon};const filtered=state.clients.filter(c=>(clientViewMode==="archived"?isPastEvent(c):!isPastEvent(c))&&(!salon||c.salon===salon)&&(!month||monthKey(c.eventDate)===month)&&(!pack||c.pack===pack)&&(!addon||(c.addons||[]).includes(addon))&&[c.honoree,c.clientName,c.code].some(v=>String(v||"").toLowerCase().includes(q)));document.getElementById("clientGrid").innerHTML=clientCards(filtered);const count=document.getElementById("clientResultCount");if(count)count.textContent=eventCountLabel(filtered.length);}
function filterRenditions(){const status=document.getElementById("renditionFilter")?.value||"";renditionCategoryFilter=document.getElementById("renditionCategoryFilter")?.value||"";const filtered=state.renditions.filter(r=>(renditionViewMode==="archived"?Boolean(r.archivedAt):!r.archivedAt)&&(!status||r.status===status)&&(!renditionCategoryFilter||r.category===renditionCategoryFilter)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));document.getElementById("renditionRows").innerHTML=renditionRows(filtered);updateRenditionTotal(filtered);}
document.getElementById("newClientBtn").addEventListener("click",()=>openClientForm());
document.getElementById("manualRenditionBtn").addEventListener("click",()=>openManualRenditionDialog());
document.getElementById("mobileMenu").addEventListener("click",()=>document.querySelector(".sidebar").classList.toggle("open"));
document.getElementById("clientForm").addEventListener("submit",e=>{e.preventDefault();if(saveClient(e.currentTarget))document.getElementById("clientDialog").close();});
document.getElementById("clientDialog").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.close();});
document.getElementById("detailDialog").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.close();});
document.getElementById("photoSessionDialog").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.close();});
document.getElementById("photoSessionForm").addEventListener("submit",e=>{e.preventDefault();if(savePhotoSession(e.currentTarget))document.getElementById("photoSessionDialog").close();});
function authErrorMessage(error, fallback = "No pudimos completar la operación.") {
  const message = String(error?.message || "").toLowerCase();
  if(message.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if(message.includes("token") || message.includes("otp") || message.includes("expired")) return "El código es incorrecto o venció. Solicitá uno nuevo.";
  if(message.includes("rate") || message.includes("seconds")) return "Esperá un minuto antes de pedir otro código.";
  if(message.includes("signup") || message.includes("signups") || message.includes("registration")) return "El registro por email está desactivado en Supabase.";
  if(message.includes("email") && (message.includes("send") || message.includes("smtp") || message.includes("magic link"))) return "Supabase no pudo enviar el email. Revisá la configuración del servicio de correo.";
  const detail = String(error?.message || "").trim();
  return detail ? `${fallback} Detalle: ${detail}` : fallback;
}

function setFormError(id, message = "") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.classList.remove("form-warning");
  element.classList.toggle("hidden", !message);
}
function setFormWarning(id, message = "") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.classList.add("form-warning");
  element.classList.toggle("hidden", !message);
}

function setFormSuccess(id, message = "") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.classList.toggle("hidden", !message);
}

function setAuthMode(mode) {
  const isSpecialMode = mode === "otp" || mode === "reset";
  document.getElementById("loginForm").classList.toggle("hidden", mode !== "login");
  document.getElementById("registerForm").classList.toggle("hidden", mode !== "register");
  document.getElementById("otpForm").classList.toggle("hidden", mode !== "otp");
  document.getElementById("resetPasswordForm").classList.toggle("hidden", mode !== "reset");
  document.querySelector(".auth-tabs").classList.toggle("hidden", isSpecialMode);
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  const content = {
    login: ["Ingresar a Janos Control", "Accedé con tu contraseña o recibí un código en tu email."],
    register: ["Crear una cuenta", "Cada colega tendrá su espacio privado de clientes, tareas y rendiciones."],
    otp: ["Verificá tu email", "Te enviamos un código de seguridad. Si no lo ves en tu bandeja de entrada, revisá la carpeta de Spam o Correo no deseado."],
    reset: ["Creá una nueva contraseña", "Elegí una contraseña segura de al menos 8 caracteres."],
  }[mode];
  document.getElementById("authTitle").textContent = content[0];
  document.getElementById("authCopy").textContent = content[1];
  ["loginError", "signupError", "otpError", "resetError"].forEach(id => setFormError(id));
  setFormSuccess("loginNotice");
}

function showOtpForm(request) {
  pendingOtp = request;
  document.getElementById("otpEmail").textContent = request.email;
  document.getElementById("otpForm").reset();
  setAuthMode("otp");
  document.querySelector('#otpForm [name="token"]').focus();
}

async function sendOtp(request, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Enviando…";
  try {
    await requestEmailCode(request.email, { createUser: request.createUser, profile: request.profile });
    showOtpForm(request);
    return true;
  } catch(error) {
    console.error("Error al solicitar código de acceso", error);
    return error;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  setFormError("loginError");
  button.disabled = true;
  button.textContent = "Ingresando…";
  try {
    const session = await signIn(form.elements.email.value.trim(), form.elements.password.value);
    await startApplication(session);
  } catch(error) {
    setFormError("loginError", authErrorMessage(error, "No se pudo iniciar sesión."));
  } finally {
    button.disabled = false;
    button.textContent = "Ingresar";
  }
});

document.getElementById("requestLoginCode").addEventListener("click", async event => {
  const form = document.getElementById("loginForm");
  const emailInput = form.elements.email;
  if(!emailInput.value.trim() || !emailInput.checkValidity()) { emailInput.reportValidity(); return; }
  setFormError("loginError");
  const result = await sendOtp({ email: emailInput.value.trim().toLowerCase(), createUser: false, profile: {} }, event.currentTarget);
  if(result instanceof Error) setFormError("loginError", authErrorMessage(result, "No pudimos enviar el código. Revisá el email."));
});

document.getElementById("forgotPassword").addEventListener("click", async event => {
  const form = document.getElementById("loginForm");
  const emailInput = form.elements.email;
  if(!emailInput.value.trim() || !emailInput.checkValidity()) { emailInput.reportValidity(); return; }
  const button = event.currentTarget;
  const originalText = button.textContent;
  setFormError("loginError");
  setFormSuccess("loginNotice");
  button.disabled = true;
  button.textContent = "Enviando…";
  try {
    await requestPasswordReset(emailInput.value.trim().toLowerCase());
    setFormSuccess("loginNotice", "Te enviamos un enlace para crear una contraseña nueva. Revisá también Spam.");
  } catch(error) {
    setFormError("loginError", authErrorMessage(error, "No pudimos enviar el correo de recuperación."));
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

document.getElementById("registerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const firstName = form.elements.firstName.value.trim();
  const lastName = form.elements.lastName.value.trim();
  const whatsapp = form.elements.whatsapp.value.trim();
  const password = form.elements.password.value;
  const phoneDigits = whatsapp.replace(/\D/g, "");
  if(phoneDigits.length < 8 || phoneDigits.length > 15) {
    setFormError("signupError", "Ingresá un número de WhatsApp válido, con código de área.");
    form.elements.whatsapp.focus();
    return;
  }
  if(password.length < 8) {
    setFormError("signupError", "La contraseña debe tener al menos 8 caracteres.");
    form.elements.password.focus();
    return;
  }
  setFormError("signupError");
  const button = form.querySelector('button[type="submit"]');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Creando cuenta…";
  try {
    await signUp(form.elements.email.value.trim().toLowerCase(), password, {
      first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`, whatsapp
    });
    setFormWarning("signupError", "¡Cuenta creada con éxito! 🎉 Está pendiente de aprobación por el administrador. Podés contactarte por WhatsApp al +54 9 11 2862 5916.");
    form.reset();
  } catch(error) {
    setFormError("signupError", authErrorMessage(error, "No pudimos crear la cuenta."));
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

document.getElementById("otpForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const token = form.elements.token.value.replace(/\D/g, "");
  if(token.length < 6 || token.length > 8) { setFormError("otpError", "Ingresá todos los dígitos del código recibido."); return; }
  button.disabled = true;
  button.textContent = "Verificando…";
  setFormError("otpError");
  try {
    const session = await verifyEmailCode(pendingOtp.email, token);
    await startApplication(session);
  } catch(error) {
    setFormError("otpError", authErrorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = "Verificar e ingresar";
  }
});

document.getElementById("resendOtp").addEventListener("click", async event => {
  if(!pendingOtp) return;
  setFormError("otpError");
  const result = await sendOtp(pendingOtp, event.currentTarget);
  if(result instanceof Error) setFormError("otpError", authErrorMessage(result, "No pudimos reenviar el código."));
  else toast("Código reenviado");
});

document.getElementById("backFromOtp").addEventListener("click", () => setAuthMode(pendingOtp?.createUser ? "register" : "login"));

document.getElementById("resetPasswordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = form.elements.password.value;
  const confirmation = form.elements.passwordConfirm.value;
  const button = form.querySelector('button[type="submit"]');
  setFormError("resetError");
  if(password.length < 8) { setFormError("resetError", "La contraseña debe tener al menos 8 caracteres."); return; }
  if(password !== confirmation) { setFormError("resetError", "Las contraseñas no coinciden."); return; }
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    await updatePassword(password);
    window.history.replaceState({}, document.title, window.location.pathname);
    const session = await getSession();
    form.reset();
    await startApplication(session);
    toast("Contraseña actualizada");
  } catch(error) {
    setFormError("resetError", authErrorMessage(error, "No pudimos actualizar la contraseña."));
  } finally {
    button.disabled = false;
    button.textContent = "Guardar nueva contraseña";
  }
});

document.getElementById("signOutBtn").addEventListener("click",async()=>{await runCloudSync();await signOut();currentUser=null;pendingOtp=null;storageKey=STORAGE_KEY;state=initialState();document.getElementById("appShell").classList.add("hidden");document.getElementById("authGate").classList.remove("hidden");document.getElementById("loginForm").reset();document.getElementById("registerForm").reset();document.getElementById("resetPasswordForm").reset();setAuthMode("login");});

async function startApplication(session){
  currentUser=session?.user||null;
  if(cloudEnabled&&currentUser){storageKey=storageKeyForUser(currentUser);state=loadState(storageKey);setSyncStatus("Cargando datos…");try{accessProfile=await getAccessProfile();if(accessProfile.status==="blocked"){await signOut();currentUser=null;document.getElementById("appShell").classList.add("hidden");document.getElementById("authGate").classList.remove("hidden");setAuthMode("login");setFormWarning("loginError","¡Tu cuenta fue creada con éxito! 🎉 Está pendiente de aprobación por el administrador. Podés contactarte por WhatsApp al +54 9 11 2862 5916.");return;}if(accessProfile.role==="admin")adminUsers=await listUserProfiles();const cloudState=await loadCloudState(BASE_RATES);state={...initialState(),...cloudState};localStorage.setItem(storageKey,JSON.stringify(state));setSyncStatus("Sincronizado");try{remoteSnapshotAt=await getLatestUpdateAt();}catch(snapshotError){console.error(snapshotError);remoteSnapshotAt=null;}}catch(error){console.error(error);setSyncStatus("Modo local · sin conexión");}}
  else{storageKey=STORAGE_KEY;state=loadState(storageKey);}
  const metadata = currentUser?.user_metadata || {};
  document.getElementById("signedInUser").textContent=accessProfile.display_name||metadata.full_name||currentUser?.email||"Modo local";
  document.getElementById("usersNav").classList.toggle("hidden",accessProfile.role!=="admin");
  document.getElementById("authGate").classList.add("hidden");document.getElementById("appShell").classList.remove("hidden");render();setView(activeView);
}

async function bootstrap(){
  if(!cloudEnabled){await startApplication(null);setSyncStatus("Modo local · Supabase sin configurar");return;}
  try{const recoveryType=new URLSearchParams(window.location.hash.replace(/^#/,"")).get("type");const session=await getSession();if(session&&recoveryType==="recovery"){currentUser=session.user;document.getElementById("appShell").classList.add("hidden");document.getElementById("authGate").classList.remove("hidden");setAuthMode("reset");}else if(session)await startApplication(session);else{document.getElementById("authGate").classList.remove("hidden");setAuthMode("login");}}catch(error){console.error(error);document.getElementById("authGate").classList.remove("hidden");setAuthMode("login");setFormError("loginError","No se pudo conectar con Supabase.");}
}

bootstrap();

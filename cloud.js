import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const cloudEnabled = Boolean(supabaseUrl && supabaseKey);
export const supabase = cloudEnabled
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}


export async function signUp(email, password, profile = {}) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: profile },
  });
  if (error) throw error;
  return data;
}
export async function requestEmailCode(email, { createUser = false, profile = {} } = {}) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: createUser,
      data: createUser ? profile : {},
    },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email, token) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
  if (!data.session) throw new Error("No se pudo iniciar la sesión.");
  return data.session;
}

export async function requestPasswordReset(email) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) throw error;
}

export async function updatePassword(password) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getAccessProfile() {
  if (!supabase) return { role: "user", status: "active" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { role: "user", status: "blocked", display_name: "" };
  // FIX: filtrar por id. Con la RLS actual (auth.uid()=id OR is_app_admin())
  // el admin ve TODOS los perfiles y .maybeSingle() sin filtro falla con 2+ filas.
  const { data, error } = await supabase.from("profiles").select("role,status,display_name,salons,zoho_email,zoho_from_name,zoho_app_password").eq("id", user.id).maybeSingle();
  if (error) throw error;
  // Fail closed: if for any reason the profile row doesn't exist yet, treat
  // the user as blocked rather than active. The DB now creates this row
  // automatically (blocked) via a trigger on signup, so this is just a
  // defensive fallback, not the primary gate.
  if (!data) return { role: "user", status: "blocked", display_name: "", salons: [] };
  // No guardamos la contraseña en claro en el estado de la app: solo si hay una cargada.
  const { zoho_app_password, ...rest } = data;
  return { ...rest, hasZohoPassword: Boolean(zoho_app_password) };
}

// Cuenta de Zoho Mail propia del usuario logueado, usada por
// api/send-drive-email.js para enviar el material al cliente desde su
// propia casilla en vez de las cuentas fijas de Quinta/Pilar Hotel.
export async function saveMyZohoAccount({ email, password, fromName }) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No hay sesión activa.");
  // Los 3 campos se comportan igual: si se dejan vacíos, se conserva lo que
  // ya estaba guardado (no se borra por error al guardar sin completarlos).
  const update = {};
  const trimmedEmail = String(email || "").trim();
  const trimmedFromName = String(fromName || "").trim();
  if (trimmedEmail) update.zoho_email = trimmedEmail;
  if (trimmedFromName) update.zoho_from_name = trimmedFromName;
  if (password) update.zoho_app_password = password;
  if (!Object.keys(update).length) return;
  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) throw error;
}

// Borra la cuenta de Zoho propia (a diferencia de guardar, acá sí se
// vacían las 3 columnas a propósito). Después de esto, el envío de mail
// vuelve a usar la cuenta fija del salón (Quinta/Pilar Hotel).
export async function clearMyZohoAccount() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No hay sesión activa.");
  const { error } = await supabase.from("profiles").update({ zoho_email: null, zoho_app_password: null, zoho_from_name: null }).eq("id", user.id);
  if (error) throw error;
}

export async function listUserProfiles() {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${supabaseUrl}/functions/v1/list-profiles`, {
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) throw new Error("No se pudieron cargar los usuarios");
  return await response.json();
}

export async function notifyUserApproved(userId, email, name) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${supabaseUrl}/functions/v1/notify-user-approved`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) throw new Error("No se pudo enviar el email");
}

// Fire-and-forget: avisa al admin que hay un usuario nuevo esperando
// aprobación. Se llama justo después de signUp(). No requiere ser admin
// (todavía no hay sesión de admin en ese momento) — la función valida que
// el email/nombre correspondan a una cuenta recién creada y realmente
// bloqueada antes de enviar nada, así no se puede abusar para spamear.
export async function notifyAdmin(email, name) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/notify-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseKey },
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) console.error("No se pudo avisar al admin del nuevo usuario");
  } catch (err) {
    console.error("notifyAdmin error:", err);
  }
}

// Exporta los datos propios del usuario autenticado (clientes, tareas,
// rendiciones, tarifas). No requiere service role: usa el JWT del usuario,
// así que el RLS ya limita el resultado a sus propias filas.
export async function exportMyData() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("No hay sesión activa.");
  const res = await fetch(`${supabaseUrl}/functions/v1/export-user`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error("No se pudo exportar la información.");
  return await res.json();
}

export async function setUserStatus(userId, status) {
  const { error } = await supabase.rpc("admin_set_user_status", { target_id: userId, new_status: status });
  if (error) throw error;
}


export async function deleteUser(userId) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error("No se pudo eliminar el usuario");
}
// Envía el mail con el link de Drive (fotos y videos) al cliente, usando la
// cuenta de Zoho que corresponda a su salón. Se dispara a mano desde el botón
// "Enviar material" en la ficha del cliente — no hay cron.
//
// Esto pega a /api/send-drive-email (una funcion de Vercel, no de Supabase):
// Supabase Edge Functions tiene un limite de 2s de CPU y el envio SMTP
// siempre lo supera (error 546) aunque el mail llegue igual, asi que el
// envio se mueve a donde ya vive la app. La funcion tambien guarda
// link_sent_at ella misma (no depende de que esto sincronice con la nube).
export async function sendDriveEmailNow(clientId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("No hay sesión activa.");
  const res = await fetch("/api/send-drive-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ clientId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo enviar el mail.");
  return data;
}

export async function getLatestUpdateAt() {
  if (!supabase) return null;
  const [clientsResult, tasksResult, renditionsResult] = await Promise.all([
    supabase.from("clients").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("tasks").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("renditions").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const dates = [clientsResult.data?.updated_at, tasksResult.data?.updated_at, renditionsResult.data?.updated_at].filter(Boolean);
  return dates.length ? dates.sort().slice(-1)[0] : null;
}

export async function loadCloudState(defaultRates) {
  const { data: { user } } = await supabase.auth.getUser();
  const [profileResult, clientsResult, tasksResult, renditionsResult, ratesResult] = await Promise.all([
    supabase.from("profiles").select("settings").eq("id", user?.id ?? "").maybeSingle(),
    supabase.from("clients").select("*").order("event_date"),
    supabase.from("tasks").select("*").order("sort_order"),
    supabase.from("renditions").select("*").order("created_at", { ascending: false }),
    supabase.from("rates").select("*").order("valid_from"),
  ]);

  const profileRow = check(profileResult, "Perfil");
  const clientRows = check(clientsResult, "Clientes");
  const taskRows = check(tasksResult, "Tareas");
  const renditionRows = check(renditionsResult, "Rendiciones");
  const rateRows = check(ratesResult, "Tarifas");
  const tasksByClient = new Map();

  taskRows.forEach((row) => {
    const task = {
      id: row.id,
      key: row.task_key,
      title: row.title,
      phase: row.phase,
      status: row.status,
      responsible: row.responsible || "",
      notes: row.notes || "",
      completedAt: row.completed_at || "",
      payable: row.payable,
      category: row.rendition_category || "",
      work: row.rendition_work || "",
      rateKey: row.rate_key || "",
    };
    if (!tasksByClient.has(row.client_id)) tasksByClient.set(row.client_id, []);
    tasksByClient.get(row.client_id).push(task);
  });

  const clients = clientRows.map((row) => ({
    id: row.id,
    code: row.code,
    eventDate: row.event_date,
    salon: row.salon,
    type: row.event_type,
    honoree: row.honoree,
    clientName: row.client_name || "",
    clientPhone: row.client_phone || "",
    whatsappGroupUrl: row.whatsapp_group_url || "",
    driveUrl: row.drive_url || "",
    clientEmail: row.client_email || "",
    linkSentAt: row.link_sent_at || "",
    contactedAt: row.contacted_at || "",
    guests: row.guests,
    pack: row.pack,
    addons: row.addons || [],
    flexServices: row.flex_services || [],
    pixelServices: row.pixel_services || [],
    notes: row.notes || "",
    photoSession: row.photo_session || null,
    dismissedConflicts: row.dismissed_conflicts || {},
    history: row.history || [],
    createdAt: row.created_at,
    tasks: tasksByClient.get(row.id) || [],
  }));

  const renditions = renditionRows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    taskId: row.task_id,
    category: row.category,
    work: row.work,
    amount: Number(row.amount),
    status: row.status,
    observations: row.observations || "",
    workDate: row.work_date,
    periodEnd: row.period_end,
    archivedAt: row.archived_at || "",
    submittedAt: row.submitted_at || "",
    paidAt: row.paid_at || "",
    isManual: Boolean(row.is_manual),
    eventDate: row.event_date || "",
    salon: row.salon || "",
    createdAt: row.created_at,
  }));

  const rates = { ...defaultRates };
  rateRows.forEach((row) => { rates[row.rate_key] = Number(row.amount); });
  return { clients, renditions, rates, settings: { currency: "ARS", ...(profileRow?.settings || {}) }, rateEffectiveDate: "2026-08-01" };
}

function chunks(rows, size = 150) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function upsertInBatches(table, rows, label, options) {
  for (const batch of chunks(rows)) check(await supabase.from(table).upsert(batch, options), label);
}

async function deleteMissing(table, ownerId, ids) {
  const existingRows = check(await supabase.from(table).select("id").eq("owner_id", ownerId), `Lectura de ${table}`);
  const validIds = new Set(ids);
  const obsoleteIds = existingRows.map(row => row.id).filter(id => !validIds.has(id));
  for (const batch of chunks(obsoleteIds)) {
    check(await supabase.from(table).delete().eq("owner_id", ownerId).in("id", batch), `Limpieza de ${table}`);
  }
}

export async function syncCloudState(state, user) {
  const ownerId = user.id;
  const metadata = user.user_metadata || {};
  const displayName = metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") || user.email?.split("@")[0] || "Usuario";
  check(await supabase.from("profiles").upsert({ id: ownerId, display_name: displayName, email: user.email || null, whatsapp: metadata.whatsapp || null, last_seen_at: new Date().toISOString(), settings: state.settings || {} }), "Perfil");

  // Primero se borran las filas huérfanas (claves de tarea que ya no se generan, ej. tras renombrar
  // "Civil" en foto/video, o rendiciones/clientes eliminados) y recién después se suben las nuevas.
  // Si se hace al revés, una fila vieja con la misma (client_id, task_key) puede chocar con la nueva
  // antes de ser borrada, y frena toda la sincronización con un error 409.
  await deleteMissing("renditions", ownerId, state.renditions.map((row) => row.id));
  await deleteMissing("tasks", ownerId, state.clients.flatMap((client) => client.tasks.map((task) => task.id)));
  await deleteMissing("clients", ownerId, state.clients.map((row) => row.id));

  const clientRows = state.clients.map((client) => ({
    id: client.id, owner_id: ownerId, code: String(client.code), event_date: client.eventDate,
    salon: client.salon, event_type: client.type, honoree: client.honoree,
    client_name: client.clientName || null, client_phone: client.clientPhone || null,
    whatsapp_group_url: client.whatsappGroupUrl || null, drive_url: client.driveUrl || null,
    client_email: client.clientEmail || null, link_sent_at: client.linkSentAt || null,
    contacted_at: client.contactedAt || null, guests: Number(client.guests || 0), pack: client.pack,
    addons: client.addons || [], flex_services: client.flexServices || [], pixel_services: client.pixelServices || [], notes: client.notes || null,
    photo_session: client.photoSession || null,
    dismissed_conflicts: client.dismissedConflicts || {},
    history: client.history || [],
  }));
  if (clientRows.length) await upsertInBatches("clients", clientRows, "Guardado de clientes");

  const taskRows = state.clients.flatMap((client) => client.tasks.map((task, index) => ({
    id: task.id, owner_id: ownerId, client_id: client.id, task_key: task.key, title: task.title,
    phase: task.phase, status: task.status, responsible: task.responsible || null, notes: task.notes || null,
    completed_at: task.completedAt || null, payable: Boolean(task.payable),
    rendition_category: task.category || null, rendition_work: task.work || null,
    rate_key: task.rateKey || null, sort_order: index,
  })));
  if (taskRows.length) await upsertInBatches("tasks", taskRows, "Guardado de tareas");

  const renditionRows = state.renditions.map((item) => ({
    id: item.id, owner_id: ownerId, client_id: item.clientId, task_id: item.taskId || null,
    category: item.category, work: item.work, amount: Number(item.amount || 0), status: item.status,
    observations: item.observations || null,
    work_date: item.workDate,
    period_end: item.periodEnd,
    archived_at: item.archivedAt || null,
    submitted_at: item.submittedAt || (item.status === "submitted" ? new Date().toISOString() : null),
    paid_at: item.paidAt || (item.status === "paid" ? new Date().toISOString() : null),
    is_manual: Boolean(item.isManual),
    event_date: item.eventDate || null,
    salon: item.salon || null,
  }));
  if (renditionRows.length) await upsertInBatches("renditions", renditionRows, "Guardado de rendiciones");

  const validFrom = state.rateEffectiveDate || "2026-08-01";
  const rateRows = Object.entries(state.rates).map(([key, amount]) => ({
    owner_id: ownerId, rate_key: key, label: key, amount: Number(amount || 0), valid_from: validFrom,
  }));
  await upsertInBatches("rates", rateRows, "Guardado de tarifas", { onConflict: "owner_id,rate_key,valid_from" });
}

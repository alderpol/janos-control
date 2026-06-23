import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
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
  const { data, error } = await supabase.from("profiles").select("role,status,display_name").maybeSingle();
  if (error) throw error;
  return data || { role: "user", status: "active", display_name: "" };
}

export async function listUserProfiles() {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/list-profiles`, {
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

export async function setUserStatus(userId, status) {
  const { error } = await supabase.rpc("admin_set_user_status", { target_id: userId, new_status: status });
  if (error) throw error;
}

export async function loadCloudState(defaultRates) {
  const [profileResult, clientsResult, tasksResult, renditionsResult, ratesResult] = await Promise.all([
    supabase.from("profiles").select("settings").maybeSingle(),
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
    contactedAt: row.contacted_at || "",
    guests: row.guests,
    pack: row.pack,
    addons: row.addons || [],
    flexServices: row.flex_services || [],
    notes: row.notes || "",
    photoSession: row.photo_session || null,
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

  const clientRows = state.clients.map((client) => ({
    id: client.id, owner_id: ownerId, code: String(client.code), event_date: client.eventDate,
    salon: client.salon, event_type: client.type, honoree: client.honoree,
    client_name: client.clientName || null, client_phone: client.clientPhone || null,
    contacted_at: client.contactedAt || null, guests: Number(client.guests || 0), pack: client.pack,
    addons: client.addons || [], flex_services: client.flexServices || [], notes: client.notes || null,
    photo_session: client.photoSession || null,
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
    submitted_at: item.status === "submitted" ? new Date().toISOString() : null,
    paid_at: item.status === "paid" ? new Date().toISOString() : null,
  }));
  if (renditionRows.length) await upsertInBatches("renditions", renditionRows, "Guardado de rendiciones");

  const validFrom = state.rateEffectiveDate || "2026-08-01";
  const rateRows = Object.entries(state.rates).map(([key, amount]) => ({
    owner_id: ownerId, rate_key: key, label: key, amount: Number(amount || 0), valid_from: validFrom,
  }));
  await upsertInBatches("rates", rateRows, "Guardado de tarifas", { onConflict: "owner_id,rate_key,valid_from" });

  await deleteMissing("renditions", ownerId, state.renditions.map((row) => row.id));
  await deleteMissing("tasks", ownerId, taskRows.map((row) => row.id));
  await deleteMissing("clients", ownerId, state.clients.map((row) => row.id));
}

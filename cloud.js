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

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function loadCloudState(defaultRates) {
  const [clientsResult, tasksResult, renditionsResult, ratesResult] = await Promise.all([
    supabase.from("clients").select("*").order("event_date"),
    supabase.from("tasks").select("*").order("sort_order"),
    supabase.from("renditions").select("*").order("created_at", { ascending: false }),
    supabase.from("rates").select("*").order("valid_from"),
  ]);

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
    guests: row.guests,
    pack: row.pack,
    addons: row.addons || [],
    flexServices: row.flex_services || [],
    notes: row.notes || "",
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
    createdAt: row.created_at,
  }));

  const renditionArchiveState = new Map();
  clients.forEach((client) => {
    (client.history || []).forEach((entry) => {
      if (entry?.type === "rendition_archive" && entry.renditionId) {
        renditionArchiveState.set(entry.renditionId, entry.archived ? entry.date || "archived" : "");
      }
    });
  });
  renditions.forEach((item) => { item.archivedAt = renditionArchiveState.get(item.id) || ""; });

  const rates = { ...defaultRates };
  rateRows.forEach((row) => { rates[row.rate_key] = Number(row.amount); });
  return { clients, renditions, rates, settings: { currency: "ARS" }, rateEffectiveDate: "2026-08-01" };
}

async function deleteMissing(table, ownerId, ids) {
  let query = supabase.from(table).delete().eq("owner_id", ownerId);
  if (ids.length) query = query.not("id", "in", `(${ids.join(",")})`);
  check(await query, `Limpieza de ${table}`);
}

export async function syncCloudState(state, user) {
  const ownerId = user.id;
  check(await supabase.from("profiles").upsert({ id: ownerId, display_name: user.email?.split("@")[0] || "Usuario" }), "Perfil");

  const clientRows = state.clients.map((client) => ({
    id: client.id, owner_id: ownerId, code: String(client.code), event_date: client.eventDate,
    salon: client.salon, event_type: client.type, honoree: client.honoree,
    client_name: client.clientName || null, guests: Number(client.guests || 0), pack: client.pack,
    addons: client.addons || [], flex_services: client.flexServices || [], notes: client.notes || null,
    history: client.history || [],
  }));
  if (clientRows.length) check(await supabase.from("clients").upsert(clientRows), "Guardado de clientes");

  const taskRows = state.clients.flatMap((client) => client.tasks.map((task, index) => ({
    id: task.id, owner_id: ownerId, client_id: client.id, task_key: task.key, title: task.title,
    phase: task.phase, status: task.status, responsible: task.responsible || null, notes: task.notes || null,
    completed_at: task.completedAt || null, payable: Boolean(task.payable),
    rendition_category: task.category || null, rendition_work: task.work || null,
    rate_key: task.rateKey || null, sort_order: index,
  })));
  if (taskRows.length) check(await supabase.from("tasks").upsert(taskRows), "Guardado de tareas");

  const renditionRows = state.renditions.map((item) => ({
    id: item.id, owner_id: ownerId, client_id: item.clientId, task_id: item.taskId || null,
    category: item.category, work: item.work, amount: Number(item.amount || 0), status: item.status,
    observations: item.observations || null,
    work_date: item.workDate,
    period_end: item.periodEnd,
    submitted_at: item.status === "submitted" ? new Date().toISOString() : null,
    paid_at: item.status === "paid" ? new Date().toISOString() : null,
  }));
  if (renditionRows.length) check(await supabase.from("renditions").upsert(renditionRows), "Guardado de rendiciones");

  const validFrom = state.rateEffectiveDate || "2026-08-01";
  const rateRows = Object.entries(state.rates).map(([key, amount]) => ({
    owner_id: ownerId, rate_key: key, label: key, amount: Number(amount || 0), valid_from: validFrom,
  }));
  check(await supabase.from("rates").upsert(rateRows, { onConflict: "owner_id,rate_key,valid_from" }), "Guardado de tarifas");

  await deleteMissing("renditions", ownerId, state.renditions.map((row) => row.id));
  await deleteMissing("tasks", ownerId, taskRows.map((row) => row.id));
  await deleteMissing("clients", ownerId, state.clients.map((row) => row.id));
}

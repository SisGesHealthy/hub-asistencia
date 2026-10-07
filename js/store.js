// Lógica de negocio del kiosco: empleados, estado de cada persona
// (qué botón le toca), registro con anti-doble-toque, jornada que cruza la
// medianoche, y sincronización en segundo plano con SharePoint.
//
// Regla de oro: registrar NUNCA espera a la red. La marcación se guarda en
// la tablet y la pantalla confirma al instante; la subida a SharePoint (foto
// + registro) la hace sync() por detrás, con reintentos.

import { CONFIG } from "./config.js";
import { idb } from "./db.js";
import * as graph from "./graph.js";
import { SesionVencidaError } from "./auth.js";

export const ACCIONES = {
  Ingreso: "Ingreso",
  Inicio_Almuerzo: "Inicio_Almuerzo",
  Fin_Almuerzo: "Fin_Almuerzo",
  Salida: "Salida",
};

export const ETIQUETAS = {
  Ingreso: "Ingreso Jornada",
  Inicio_Almuerzo: "Inicio Alimentación",
  Fin_Almuerzo: "Fin Alimentación",
  Salida: "Salida Jornada",
};

// ---- fechas ----

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// Mismo formato que la columna FechaHoraLocal de la lista vieja (d/M/yyyy H:mm).
const fechaHoraLocal = (d) =>
  `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// ---- dispositivo ----

export function getDispositivo() {
  try {
    let n = localStorage.getItem("hub-asistencia:dispositivo");
    if (!n) {
      n = `Tablet-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      localStorage.setItem("hub-asistencia:dispositivo", n);
    }
    return n;
  } catch {
    return "Tablet";
  }
}
export function setDispositivo(nombre) {
  try {
    localStorage.setItem("hub-asistencia:dispositivo", nombre.trim() || getDispositivo());
  } catch {}
}

// ---- empleados ----

// Hoy la baja se marca agregando "_" al EmpleadoID (la columna Activo está
// incompleta: 24 vigentes la tienen vacía y 5 desvinculados dicen "SI").
// Se respetan las dos señales: con "_" o con Activo = NO, no puede marcar.
export function esActivo(e) {
  if (!e.empleadoId || e.empleadoId.endsWith("_")) return false;
  return e.activo.toUpperCase() !== "NO";
}

let empleadosMem = new Map();

export async function cargarEmpleadosLocales() {
  const all = await idb.getAll("empleados");
  empleadosMem = new Map(all.map((e) => [e.empleadoId, e]));
  return empleadosMem.size;
}

export async function refrescarEmpleados() {
  let lista;
  if (CONFIG.useMock) {
    lista = await fetch("data/empleados_demo.json").then((r) => r.json());
  } else {
    lista = await graph.graphGetEmpleados();
  }
  lista = lista.filter(esActivo);
  if (lista.length === 0) throw new Error("La lista de empleados llegó vacía; se conserva la copia anterior.");
  await idb.replaceAll("empleados", lista);
  empleadosMem = new Map(lista.map((e) => [e.empleadoId, e]));
  await idb.put("meta", { id: "empleadosAt", ts: Date.now() });
  return lista.length;
}

export function buscarEmpleado(codigo) {
  return empleadosMem.get(String(codigo).trim()) || null;
}

export function totalEmpleados() {
  return empleadosMem.size;
}

// ---- estado de la persona ----

async function recientes(empleadoId) {
  const limite = Date.now() - 36 * 3600 * 1000;
  const regs = await idb.getAllByIndex("registros", "byEmpleado", empleadoId);
  return regs.filter((r) => r.ts >= limite).sort((a, b) => a.ts - b.ts);
}

// Devuelve qué acciones "tocan" ahora y la jornada abierta, si hay.
export async function estadoEmpleado(empleadoId) {
  const regs = await recientes(empleadoId);
  const ultimo = regs[regs.length - 1] || null;
  const abierta = ultimo && ultimo.accion !== "Salida" && Date.now() - ultimo.ts < CONFIG.horasMaxJornada * 3600 * 1000;
  if (!abierta) return { esperadas: ["Ingreso"], ultimo, jornada: null };

  const deJornada = regs.filter((r) => r.jornada === ultimo.jornada);
  const yaAlmorzo = deJornada.some((r) => r.accion === "Inicio_Almuerzo");
  let esperadas;
  if (ultimo.accion === "Inicio_Almuerzo") esperadas = ["Fin_Almuerzo"];
  else esperadas = yaAlmorzo ? ["Salida"] : ["Inicio_Almuerzo", "Salida"];
  return { esperadas, ultimo, jornada: ultimo.jornada };
}

// ---- registrar ----

export async function registrar({ empleado, accion, fotoBlob, cara, confirmadoFueraSecuencia = false }) {
  const ahora = new Date();
  const estado = await estadoEmpleado(empleado.empleadoId);

  // Doble toque: misma acción de la misma persona hace menos de N minutos.
  const regs = await recientes(empleado.empleadoId);
  const repetido = regs
    .filter((r) => r.accion === accion && ahora - r.ts < CONFIG.minutosAntiDuplicado * 60000)
    .pop();
  if (repetido) return { ok: false, motivo: "duplicado", previo: repetido };

  const fueraSecuencia = !estado.esperadas.includes(accion);
  if (fueraSecuencia && !confirmadoFueraSecuencia) return { ok: false, motivo: "fueraSecuencia", estado };

  // Jornada: la que está abierta; si no hay, la de hoy — salvo una marcación
  // suelta de madrugada (ej. Salida 00:12 sin Ingreso en esta tablet), que
  // pertenece al turno del día anterior.
  let jornada = estado.jornada;
  if (!jornada) {
    jornada = accion !== "Ingreso" && ahora.getHours() < 6 ? ymd(sumarDias(ahora, -1)) : ymd(ahora);
  }

  const reg = {
    idLocal: crypto.randomUUID(),
    empleadoId: empleado.empleadoId,
    nombre: empleado.nombre,
    accion,
    ts: ahora.getTime(),
    fechaHoraLocal: fechaHoraLocal(ahora),
    jornada,
    dispositivo: getDispositivo(),
    cara,
    fueraSecuencia,
    observacion: fueraSecuencia ? `Fuera de secuencia (esperaba ${estado.esperadas.join(" o ")})` : "",
    fotoUrl: "",
    sincronizado: CONFIG.useMock,
    intentos: 0,
  };
  await idb.put("registros", reg);
  if (fotoBlob) await idb.put("fotos", { idLocal: reg.idLocal, blob: fotoBlob });
  sync(); // en segundo plano, sin await
  return { ok: true, reg };
}

// ---- sincronización ----

const syncState = { estado: CONFIG.useMock ? "demo" : "ok", pendientes: 0, error: "", ultimoOk: null };
const listeners = new Set();
export const onSyncChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn({ ...syncState }));
export const getSyncState = () => ({ ...syncState });

// Tablet recién instalada (o sesión cerrada): avisar desde el arranque, sin
// esperar a que falle el primer envío.
export function marcarSinSesion() {
  syncState.estado = "sesion";
  syncState.error = "Esta tablet no tiene sesión de Microsoft; inicia sesión desde el panel de TH.";
  emit();
}

function nombreFoto(reg) {
  const d = new Date(reg.ts);
  const f = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${reg.empleadoId}_${f}_${reg.accion}.jpg`;
}

let syncEnCurso = null;
export function sync() {
  if (!syncEnCurso) syncEnCurso = _sync().finally(() => (syncEnCurso = null));
  return syncEnCurso;
}

async function _sync() {
  const pendientes = (await idb.getAll("registros")).filter((r) => !r.sincronizado).sort((a, b) => a.ts - b.ts);
  syncState.pendientes = pendientes.length;
  if (CONFIG.useMock) return emit();
  if (!navigator.onLine) {
    syncState.estado = "offline";
    return emit();
  }
  for (const reg of pendientes) {
    try {
      const foto = await idb.get("fotos", reg.idLocal);
      if (foto && !reg.fotoUrl) {
        reg.fotoUrl = await graph.graphSubirFoto(foto.blob, nombreFoto(reg));
        await idb.put("registros", reg);
      }
      const yaEsta = reg.intentos > 0 && (await graph.graphExisteRegistro(reg.idLocal));
      if (!yaEsta) await graph.graphCrearRegistro(reg);
      reg.sincronizado = true;
      await idb.put("registros", reg);
      await idb.delete("fotos", reg.idLocal);
      syncState.pendientes--;
      syncState.estado = "ok";
      syncState.ultimoOk = Date.now();
      syncState.error = "";
    } catch (e) {
      reg.intentos = (reg.intentos || 0) + 1;
      await idb.put("registros", reg);
      syncState.estado = e instanceof SesionVencidaError ? "sesion" : "error";
      syncState.error = e.message;
      // Un registro rechazado por SharePoint (400, 404…) no debe frenar a
      // todos los que vienen detrás: se salta y se reintenta en el próximo
      // ciclo. Sin sesión, sin red o con límite de Graph (401/403/429/5xx) sí
      // se corta, porque fallarían todos igual.
      const m = /-> (\d{3})/.exec(e.message);
      const permanente = m && /^4/.test(m[1]) && !["401", "403", "429"].includes(m[1]);
      if (permanente) continue;
      break; // se reintenta en el próximo ciclo
    }
    emit();
  }
  emit();
}

// Baja las marcaciones de ayer y hoy (incluye las de la otra tablet) para que
// estadoEmpleado sepa, por ejemplo, que alguien ya marcó Ingreso en la otra.
export async function syncRemoto() {
  if (CONFIG.useMock || !navigator.onLine) return;
  try {
    const hoy = new Date();
    const remotos = await graph.graphGetRegistros(ymd(sumarDias(hoy, -1)), ymd(hoy));
    const locales = new Set((await idb.getAll("registros")).map((r) => r.idLocal));
    for (const r of remotos) if (r.idLocal && !locales.has(r.idLocal)) await idb.put("registros", r);
    if (syncState.estado === "sesion") {
      syncState.estado = "ok";
      syncState.error = "";
      emit();
      sync(); // sesión recuperada: enviar lo que quedó en espera
    }
  } catch (e) {
    if (e instanceof SesionVencidaError) {
      syncState.estado = "sesion";
      syncState.error = e.message;
      emit();
    }
  }
}

// Al digitar un código: trae al instante lo que esa persona marcó en la OTRA
// tablet (sin esperar el ciclo de 45 s), para no registrar un Ingreso doble.
// Devuelve true si llegó algo nuevo.
export async function refrescarEmpleadoRemoto(empleadoId) {
  if (CONFIG.useMock || !navigator.onLine) return false;
  try {
    const remotos = await graph.graphGetRegistrosEmpleado(empleadoId, ymd(sumarDias(new Date(), -1)));
    const locales = new Set((await idb.getAllByIndex("registros", "byEmpleado", empleadoId)).map((r) => r.idLocal));
    let nuevos = 0;
    for (const r of remotos) if (r.idLocal && !locales.has(r.idLocal)) { await idb.put("registros", r); nuevos++; }
    return nuevos > 0;
  } catch {
    return false;
  }
}

// La tablet solo necesita historia reciente; lo demás vive en SharePoint.
// (En modo demo se guardan 40 días para que el reporte tenga algo que mostrar.)
export async function purgarViejos() {
  const dias = CONFIG.useMock ? 40 : 7;
  const limite = Date.now() - dias * 86400000;
  for (const r of await idb.getAll("registros")) {
    if (r.sincronizado && r.ts < limite) await idb.delete("registros", r.idLocal);
  }
}

// ---- reporte de TH ----

export async function registrosRango(desde, hasta) {
  let regs;
  if (CONFIG.useMock) {
    regs = (await idb.getAll("registros")).filter((r) => r.jornada >= desde && r.jornada <= hasta);
  } else {
    regs = await graph.graphGetRegistros(desde, hasta);
    // Lo que aún no se subió desde ESTA tablet también cuenta.
    const ids = new Set(regs.map((r) => r.idLocal));
    for (const r of await idb.getAll("registros")) {
      if (!r.sincronizado && r.jornada >= desde && r.jornada <= hasta && !ids.has(r.idLocal)) regs.push(r);
    }
  }
  // Un mismo idLocal nunca cuenta dos veces (por si un reintento duplicó).
  const unicos = new Map(regs.map((r) => [r.idLocal, r]));
  return [...unicos.values()].sort((a, b) => a.ts - b.ts);
}

// Agrupa por persona + jornada y detecta novedades.
export function armarJornadas(regs) {
  const grupos = new Map();
  for (const r of regs) {
    const k = `${r.jornada}|${r.empleadoId}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  }
  const out = [];
  for (const lista of grupos.values()) {
    const de = (a) => lista.filter((r) => r.accion === a);
    const ing = de("Ingreso"), sal = de("Salida"), ini = de("Inicio_Almuerzo"), fin = de("Fin_Almuerzo");
    const ingreso = ing[0]?.ts ?? null;
    const salida = sal[sal.length - 1]?.ts ?? null;
    const almIni = ini[0]?.ts ?? null;
    const almFin = fin[fin.length - 1]?.ts ?? null;
    const minAlm = almIni && almFin && almFin > almIni ? Math.round((almFin - almIni) / 60000) : null;
    const horas = ingreso && salida && salida > ingreso ? (salida - ingreso) / 3600000 - (minAlm || 0) / 60 : null;

    // Jornada todavía abierta (la persona sigue en planta): que no tenga
    // Salida aún NO es novedad. Solo pasa a "Sin salida" cuando vence el
    // plazo máximo de jornada sin que haya marcado.
    const ultimoTs = Math.max(...lista.map((r) => r.ts));
    const enCurso = !salida && Date.now() - ultimoTs < CONFIG.horasMaxJornada * 3600 * 1000;
    const enAlmuerzo = !!(enCurso && almIni && !almFin);

    const novedades = [];
    if (!ingreso) novedades.push("Sin ingreso");
    if (!salida && !enCurso) novedades.push("Sin salida");
    if (almIni && !almFin && !enAlmuerzo) novedades.push("Alimentación sin cerrar");
    if (almFin && !almIni) novedades.push("Fin alimentación sin inicio");
    for (const [n, l] of [["Ingreso", ing], ["Salida", sal], ["Inicio alim.", ini], ["Fin alim.", fin]]) {
      if (l.length > 1) novedades.push(`${n} x${l.length}`);
    }
    if (lista.some((r) => r.fueraSecuencia)) novedades.push("Fuera de secuencia");
    if (lista.some((r) => r.cara === "No detectada" || r.cara === "Sin cámara")) novedades.push("Sin rostro");

    out.push({
      jornada: lista[0].jornada,
      empleadoId: lista[0].empleadoId,
      nombre: lista[0].nombre,
      departamento: buscarEmpleado(lista[0].empleadoId)?.departamento || "",
      ingreso, salida, almIni, almFin, minAlm, horas, enCurso, enAlmuerzo,
      novedades,
      registros: lista,
    });
  }
  return out.sort((a, b) => (a.jornada === b.jornada ? a.nombre.localeCompare(b.nombre) : a.jornada < b.jornada ? -1 : 1));
}

// CSV con ";" y BOM: Excel en español lo abre directo con columnas y tildes.
export function jornadasACsv(jornadas) {
  const h = (ts) => (ts ? hhmm(ts) : "");
  const filas = [
    ["Jornada", "EmpleadoID", "Nombre", "Departamento", "Estado", "Ingreso", "Inicio alimentación", "Fin alimentación", "Salida", "Min. alimentación", "Horas trabajadas", "Novedades"],
    ...jornadas.map((j) => [
      j.jornada, j.empleadoId, j.nombre, j.departamento, j.enAlmuerzo ? "En alimentación" : j.enCurso ? "En planta" : j.salida ? "Cerrada" : "Sin salida",
      h(j.ingreso), h(j.almIni), h(j.almFin), h(j.salida),
      j.minAlm ?? "", j.horas != null ? j.horas.toFixed(2).replace(".", ",") : "", j.novedades.join(" | "),
    ]),
  ];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + filas.map((f) => f.map(esc).join(";")).join("\r\n");
}

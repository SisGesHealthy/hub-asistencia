// Llamadas a Microsoft Graph contra el sitio EspacioColaborativo.
// Solo se usan con CONFIG.useMock === false.
//
// - Empleados: lista EXISTENTE (creada para la Power App). No sabemos con
//   certeza los nombres internos de sus columnas (SharePoint los cambia si la
//   columna se renombró o se importó desde Excel), así que se resuelven por
//   nombre visible con GET /lists/{id}/columns — igual que el siteId y los
//   ids de lista, se cachean en localStorage.
// - RegistrosAsistencia: lista NUEVA, sus columnas se crean con el mismo
//   nombre interno que usa esta app (ver README). Title = IdLocal (GUID de
//   la marcación, generado en la tablet) para que un reenvío no duplique.

import { CONFIG } from "./config.js";
import { getAccessTokenSilent } from "./auth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const LS_KEY = "hub-asistencia:graph-ids";

async function graphFetch(path, options = {}) {
  const token = await getAccessTokenSilent();
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph ${options.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function readIdCache() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeIdCache(patch) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...readIdCache(), ...patch }));
  } catch {}
}

async function resolveSiteId() {
  const cache = readIdCache();
  if (cache.siteId) return cache.siteId;
  const { siteHostname, sitePath } = CONFIG.graph;
  const data = await graphFetch(`/sites/${siteHostname}:${sitePath}`);
  writeIdCache({ siteId: data.id });
  return data.id;
}

async function resolveListId(listKey) {
  const cache = readIdCache();
  if (cache.lists?.[listKey]) return cache.lists[listKey];
  const listName = CONFIG.graph.listNames[listKey];
  const siteId = await resolveSiteId();
  const qs = new URLSearchParams({ $filter: `displayName eq '${listName}'`, $select: "id" });
  const data = await graphFetch(`/sites/${siteId}/lists?${qs}`);
  const found = (data.value || [])[0];
  if (!found) throw new Error(`No se encontró en el sitio una lista llamada "${listName}".`);
  writeIdCache({ lists: { ...cache.lists, [listKey]: found.id } });
  return found.id;
}

async function listPath(listKey) {
  return `/sites/${await resolveSiteId()}/lists/${await resolveListId(listKey)}`;
}

// Recorre todas las páginas de un GET de ítems (Graph devuelve máx. 200 por
// página y sigue con @odata.nextLink).
async function getAllPages(path, options) {
  const out = [];
  let next = path;
  while (next) {
    const data = await graphFetch(next, options);
    out.push(...(data.value || []));
    next = data["@odata.nextLink"] || null;
  }
  return out;
}

// ---- Empleados (lista existente) ----

async function resolveColumnasEmpleados() {
  const cache = readIdCache();
  if (cache.colsEmpleados) return cache.colsEmpleados;
  const cols = await graphFetch(`${await listPath("empleados")}/columns?$select=name,displayName`);
  const byDisplay = {};
  for (const c of cols.value || []) byDisplay[c.displayName.trim().toLowerCase()] = c.name;
  const map = {};
  for (const [key, display] of Object.entries(CONFIG.columnasEmpleados)) {
    // "NombreCompleto" suele ser la columna Title renombrada.
    map[key] = byDisplay[display.toLowerCase()] || (key === "nombre" ? "Title" : display);
  }
  writeIdCache({ colsEmpleados: map });
  return map;
}

export async function graphGetEmpleados() {
  const cols = await resolveColumnasEmpleados();
  const items = await getAllPages(`${await listPath("empleados")}/items?expand=fields&$top=500`);
  return items.map((it) => {
    const f = it.fields || {};
    const val = (k) => (f[cols[k]] ?? "").toString().trim();
    return {
      empleadoId: val("empleadoId"),
      nombre: val("nombre"),
      departamento: val("departamento"),
      puesto: val("puesto"),
      activo: val("activo"),
    };
  });
}

// ---- RegistrosAsistencia (lista nueva) ----

const CAMPOS_REGISTRO = [
  "EmpleadoID", "Nombre", "Accion", "FechaHora", "FechaHoraLocal", "Jornada",
  "Dispositivo", "Foto", "Cara", "FueraSecuencia", "Observacion",
];

function toFields(reg) {
  return {
    Title: reg.idLocal,
    EmpleadoID: reg.empleadoId,
    Nombre: reg.nombre,
    Accion: reg.accion,
    FechaHora: new Date(reg.ts).toISOString(),
    FechaHoraLocal: reg.fechaHoraLocal,
    Jornada: reg.jornada,
    Dispositivo: reg.dispositivo,
    Foto: reg.fotoUrl || "",
    Cara: reg.cara,
    FueraSecuencia: !!reg.fueraSecuencia,
    Observacion: reg.observacion || "",
  };
}

function fromFields(it) {
  const f = it.fields || {};
  return {
    idLocal: f.Title,
    empleadoId: f.EmpleadoID,
    nombre: f.Nombre,
    accion: f.Accion,
    ts: Date.parse(f.FechaHora),
    fechaHoraLocal: f.FechaHoraLocal,
    jornada: f.Jornada,
    dispositivo: f.Dispositivo,
    fotoUrl: f.Foto,
    cara: f.Cara,
    fueraSecuencia: f.FueraSecuencia === true,
    observacion: f.Observacion,
    sincronizado: true,
  };
}

export async function graphCrearRegistro(reg) {
  await graphFetch(`${await listPath("registros")}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: toFields(reg) }),
  });
}

// ¿Ya existe en SharePoint? Se usa solo al REINTENTAR un envío (puede que
// el POST anterior sí haya llegado y solo se perdió la respuesta).
export async function graphExisteRegistro(idLocal) {
  const qs = new URLSearchParams({ $filter: `fields/Title eq '${idLocal}'`, $select: "id" });
  const data = await graphFetch(`${await listPath("registros")}/items?${qs}`, {
    headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
  });
  return (data.value || []).length > 0;
}

// Marcaciones con Jornada entre desde y hasta (texto yyyy-mm-dd, ordena
// igual que la fecha). Jornada debe estar INDEXADA en la lista: así la
// consulta sigue siendo rápida aunque la lista pase de 5.000 elementos.
export async function graphGetRegistros(desde, hasta) {
  const filter = `fields/Jornada ge '${desde}' and fields/Jornada le '${hasta}'`;
  const qs = new URLSearchParams({ expand: `fields($select=${["Title", ...CAMPOS_REGISTRO].join(",")})`, $filter: filter, $top: "500" });
  const items = await getAllPages(`${await listPath("registros")}/items?${qs}`, {
    headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
  });
  return items.map(fromFields);
}

// ---- Fotos (biblioteca existente FotosBiometrico) ----

async function getFotosDriveId() {
  const cache = readIdCache();
  if (cache.fotosDrive) return cache.fotosDrive;
  const data = await graphFetch(`/sites/${await resolveSiteId()}/drives?$select=id,name,webUrl`);
  const nombre = CONFIG.graph.photoLibraryName;
  // name es el nombre visible; webUrl termina en el nombre interno de la
  // biblioteca (aquí coinciden, pero se aceptan ambos).
  const drive = (data.value || []).find((d) => d.name === nombre || d.webUrl?.endsWith(`/${nombre}`));
  if (!drive) throw new Error(`No se encontró la biblioteca "${nombre}" en el sitio.`);
  writeIdCache({ fotosDrive: drive.id });
  return drive.id;
}

export async function graphSubirFoto(blob, filename) {
  const token = await getAccessTokenSilent();
  const driveId = await getFotosDriveId();
  const res = await fetch(
    `${GRAPH_BASE}/drives/${driveId}/root:/${encodeURIComponent(filename)}:/content?@microsoft.graph.conflictBehavior=replace`,
    { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" }, body: blob }
  );
  if (!res.ok) throw new Error(`Error subiendo foto: ${res.status}`);
  return (await res.json()).webUrl;
}

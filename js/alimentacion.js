// Pedidos de alimentación: datos y sincronización.
// Mismo esquema que las marcaciones: el pedido se guarda primero en la
// tablet (IndexedDB) y se envía a SharePoint por detrás. Módulo aparte para
// no tocar el flujo de asistencia.
//
// Reglas:
// - Se pide para HOY y solo hasta la hora límite de cada producto (config).
// - Pedido personal: uno por comida (Desayuno/Almuerzo/Sopa/Merienda) al día;
//   se descuenta del rol de pagos. Se puede cancelar antes de la hora límite.
// - Pedido "a nombre de Healthy": solo secos, con cantidad, lo hace un
//   supervisor/jefe; no se descuenta a nadie.

import { CONFIG } from "./config.js";
import { idb } from "./db.js";
import * as graph from "./graph.js";
import { ymd, getDispositivo } from "./store.js";

const CFG = CONFIG.alimentacion;
export const PROVEEDORES = CFG.proveedores;
export const MENU = CFG.menu;
export const COMIDAS = [...new Set(MENU.map((m) => m.comida))];

const pad = (n) => String(n).padStart(2, "0");
const ahoraHHMM = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const abierto = (item, d = new Date()) => ahoraHHMM(d) <= item.hora;

export const dinero = (n) => `$${Number(n).toFixed(2).replace(".", ",")}`;

export function puedePedirHealthy(empleado) {
  const puesto = (empleado?.puesto || "").toUpperCase();
  return CFG.puestosPedidoHealthy.some((p) => puesto.includes(p));
}

// ---- pedidos locales ----

async function pedidosDeFecha(fecha) {
  return idb.getAllByIndex("pedidos", "byFecha", fecha);
}

export async function pedidosHoyEmpleado(empleadoId) {
  return (await pedidosDeFecha(ymd(new Date())))
    .filter((p) => p.empleadoId === empleadoId && p.estado === "Activo")
    .sort((a, b) => a.ts - b.ts);
}

export async function pedir({ empleado, item, proveedor, tipo = "Personal", cantidad = 1, observacion = "" }) {
  const ahora = new Date();
  if (!abierto(item, ahora)) return { ok: false, motivo: "fueraHorario" };
  if (!(proveedor in item.precios)) return { ok: false, motivo: "sinProveedor" };

  if (tipo === "Personal") {
    const yaTiene = (await pedidosHoyEmpleado(empleado.empleadoId)).find((p) => p.tipo === "Personal" && p.comida === item.comida);
    if (yaTiene) return { ok: false, motivo: "yaPidio", pedido: yaTiene };
  }

  const p = {
    idLocal: crypto.randomUUID(),
    _itemId: null,
    empleadoId: empleado.empleadoId,
    nombre: empleado.nombre,
    fecha: ymd(ahora),
    comida: item.comida,
    producto: item.nombre,
    proveedor: PROVEEDORES[proveedor],
    costo: item.precios[proveedor],
    cantidad: tipo === "Healthy" ? Math.max(1, Math.round(cantidad)) : 1,
    tipo,
    estado: "Activo",
    ts: ahora.getTime(),
    dispositivo: getDispositivo(),
    observacion,
    pendiente: CONFIG.useMock ? null : "crear",
    intentos: 0,
  };
  await idb.put("pedidos", p);
  syncPedidos();
  return { ok: true, pedido: p };
}

export async function cancelar(pedido) {
  const item = MENU.find((m) => m.nombre === pedido.producto);
  if (item && !abierto(item)) return { ok: false, motivo: "fueraHorario", item };
  pedido.estado = "Cancelado";
  if (!CONFIG.useMock && pedido.pendiente !== "crear") pedido.pendiente = "actualizar";
  await idb.put("pedidos", pedido);
  syncPedidos();
  return { ok: true };
}

// ---- sincronización ----

let enCurso = null;
export function syncPedidos() {
  if (!enCurso) enCurso = _sync().finally(() => (enCurso = null));
  return enCurso;
}

async function _sync() {
  if (CONFIG.useMock || !navigator.onLine) return;
  const pendientes = (await idb.getAll("pedidos")).filter((p) => p.pendiente).sort((a, b) => a.ts - b.ts);
  for (const p of pendientes) {
    try {
      if (p.pendiente === "crear") {
        const existente = p.intentos > 0 ? await graph.graphBuscarPedido(p.idLocal) : null;
        if (existente) {
          p._itemId = existente;
          if (p.estado === "Cancelado") await graph.graphActualizarPedido(existente, { Estado: "Cancelado" });
        } else {
          p._itemId = await graph.graphCrearPedido(p);
        }
      } else if (p.pendiente === "actualizar") {
        const id = p._itemId || (await graph.graphBuscarPedido(p.idLocal));
        if (id) await graph.graphActualizarPedido(id, { Estado: p.estado });
        p._itemId = id;
      }
      p.pendiente = null;
      await idb.put("pedidos", p);
    } catch (e) {
      p.intentos = (p.intentos || 0) + 1;
      await idb.put("pedidos", p);
      const m = /-> (\d{3})/.exec(e.message);
      const permanente = m && /^4/.test(m[1]) && !["401", "403", "429"].includes(m[1]);
      if (!permanente) break; // sin sesión / sin red / lista inexistente: se reintenta luego
    }
  }
}

// Trae los pedidos de hoy de SharePoint (incluye los de la otra tablet).
// Lo que tiene cambios sin enviar en esta tablet no se pisa.
async function fusionar(remotos) {
  for (const r of remotos) {
    const local = await idb.get("pedidos", r.idLocal);
    if (!local || !local.pendiente) await idb.put("pedidos", { ...r, intentos: 0 });
  }
}

export async function syncRemotoPedidos(empleadoId = null) {
  if (CONFIG.useMock || !navigator.onLine) return;
  try {
    const hoy = ymd(new Date());
    await fusionar(await graph.graphGetPedidos(hoy, hoy, empleadoId));
  } catch {}
}

export async function purgarPedidosViejos() {
  const limite = ymd(new Date(Date.now() - (CONFIG.useMock ? 40 : 7) * 86400000));
  for (const p of await idb.getAll("pedidos")) {
    if (!p.pendiente && p.fecha < limite) await idb.delete("pedidos", p.idLocal);
  }
}

// ---- reporte de TH ----

export async function pedidosRango(desde, hasta) {
  let lista = [];
  let soloLocal = "";
  if (!CONFIG.useMock) {
    try {
      lista = await graph.graphGetPedidos(desde, hasta);
    } catch (e) {
      soloLocal = e.message;
    }
  }
  const ids = new Set(lista.map((p) => p.idLocal));
  for (const p of await idb.getAll("pedidos")) {
    if (p.fecha < desde || p.fecha > hasta || ids.has(p.idLocal)) continue;
    if (CONFIG.useMock || soloLocal || p.pendiente) lista.push(p);
  }
  const unicos = new Map(lista.map((p) => [p.idLocal, p]));
  return { pedidos: [...unicos.values()].sort((a, b) => a.ts - b.ts), soloLocal };
}

// Consolidado por proveedor → producto (solo activos).
export function consolidar(pedidos) {
  const out = {};
  for (const p of pedidos.filter((x) => x.estado === "Activo")) {
    const prov = (out[p.proveedor] ||= {});
    const k = `${p.producto}|${p.tipo}`;
    const fila = (prov[k] ||= { producto: p.producto, tipo: p.tipo, costo: p.costo, cantidad: 0, total: 0 });
    fila.cantidad += p.cantidad;
    fila.total += p.cantidad * p.costo;
  }
  return out;
}

// Descuento por persona (solo pedidos personales activos).
export function descuentos(pedidos) {
  const m = new Map();
  for (const p of pedidos.filter((x) => x.estado === "Activo" && x.tipo === "Personal")) {
    const d = m.get(p.empleadoId) || { empleadoId: p.empleadoId, nombre: p.nombre, pedidos: 0, total: 0 };
    d.pedidos += 1;
    d.total += p.costo * p.cantidad;
    m.set(p.empleadoId, d);
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const csv = (filas) => {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + filas.map((f) => f.map(esc).join(";")).join("\r\n");
};
const num = (n) => Number(n).toFixed(2).replace(".", ",");

export function pedidosACsv(pedidos) {
  const hora = (ts) => new Date(ts).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", hour12: false });
  return csv([
    ["Fecha", "Hora", "EmpleadoID", "Nombre", "Comida", "Producto", "Proveedor", "Tipo", "Cantidad", "Costo unit.", "Total", "Estado", "Observación"],
    ...pedidos.map((p) => [p.fecha, hora(p.ts), p.empleadoId, p.nombre, p.comida, p.producto, p.proveedor, p.tipo === "Healthy" ? "A nombre de Healthy" : "Personal (descuento)", p.cantidad, num(p.costo), num(p.costo * p.cantidad), p.estado, p.observacion || ""]),
  ]);
}

export function descuentosACsv(lista) {
  return csv([["EmpleadoID", "Nombre", "Pedidos", "Total a descontar"], ...lista.map((d) => [d.empleadoId, d.nombre, d.pedidos, num(d.total)])]);
}

// Texto listo para enviar al proveedor (WhatsApp/correo).
export function textoProveedor(proveedor, filas, fecha) {
  const f = fecha.split("-").reverse().join("/");
  const lineas = filas.map((x) => `• ${x.producto}: ${x.cantidad}`);
  const total = filas.reduce((s, x) => s + x.cantidad, 0);
  return `Pedido Healthy Food — ${f}\nProveedor: ${proveedor}\n${lineas.join("\n")}\nTotal: ${total} porciones`;
}

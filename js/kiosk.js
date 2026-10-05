// Pantalla principal del kiosco: teclado → nombre → botón → confirmación.
// Todo lo que pasa aquí es local (IndexedDB); nada espera a SharePoint.

import { CONFIG } from "./config.js";
import { el } from "./dom.js";
import * as store from "./store.js";
import * as cam from "./camera.js";

const $ = (id) => document.getElementById(id);

const st = { codigo: "", empleado: null, estado: null, ocupado: false, timer: null };

// ---- reloj ----

function tickReloj() {
  const d = new Date();
  $("k-fecha").textContent = d.toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" });
  $("k-hora").textContent = d.toLocaleTimeString("es-EC", { hour12: false });
}

// ---- código y persona ----

function pintarCodigo() {
  $("k-codigo").textContent = "•".repeat(st.codigo.length);
}

function limpiar() {
  st.codigo = "";
  st.empleado = null;
  st.estado = null;
  clearTimeout(st.timer);
  pintarCodigo();
  $("k-nombre").textContent = "";
  $("k-detalle").textContent = "";
  $("k-codigo-error").textContent = "";
  document.querySelectorAll(".acc").forEach((b) => {
    b.disabled = true;
    b.classList.remove("esperada", "otra");
  });
}

function reiniciarInactividad() {
  clearTimeout(st.timer);
  st.timer = setTimeout(limpiar, CONFIG.segundosInactividad * 1000);
}

async function alCambiarCodigo() {
  reiniciarInactividad();
  pintarCodigo();
  $("k-codigo-error").textContent = "";
  const emp = st.codigo.length >= 4 ? store.buscarEmpleado(st.codigo) : null;
  if (!emp) {
    st.empleado = null;
    $("k-nombre").textContent = "";
    $("k-detalle").textContent = "";
    document.querySelectorAll(".acc").forEach((b) => (b.disabled = true));
    if (st.codigo.length >= 4) {
      // Tablet nueva sin sesión: no es que el código esté mal, es que aún
      // no se descargó la lista de empleados.
      $("k-codigo-error").textContent = store.totalEmpleados() === 0
        ? "Lista de empleados no cargada — avise a Talento Humano"
        : "Código no válido";
    }
    return;
  }
  st.empleado = emp;
  st.estado = await store.estadoEmpleado(emp.empleadoId);
  $("k-nombre").textContent = emp.nombre;
  const u = st.estado.ultimo;
  $("k-detalle").textContent = u
    ? `Último registro: ${store.ETIQUETAS[u.accion]} · ${new Date(u.ts).toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit" })} ${store.hhmm(u.ts)}`
    : "";
  document.querySelectorAll(".acc").forEach((b) => {
    const esperada = st.estado.esperadas.includes(b.dataset.accion);
    b.disabled = false;
    b.classList.toggle("esperada", esperada);
    b.classList.toggle("otra", !esperada);
  });
}

function tecla(d) {
  if (st.ocupado) return;
  if (d === "borrar") st.codigo = st.codigo.slice(0, -1);
  else if (d === "ok") st.codigo = "";
  else if (st.codigo.length < 6) st.codigo += d;
  alCambiarCodigo();
}

// ---- overlays ----

function overlay(tipo, titulo, cuerpo, botones = null, ms = 2600) {
  const root = $("overlay-root");
  root.innerHTML = "";
  const box = el("div", { class: `ov ov-${tipo}` }, [
    el("div", { class: "ov-card" }, [
      el("div", { class: "ov-titulo" }, titulo),
      el("div", { class: "ov-cuerpo", html: cuerpo }),
      botones ? el("div", { class: "ov-botones" }, botones) : null,
    ]),
  ]);
  root.appendChild(box);
  if (!botones) setTimeout(() => box.remove(), ms);
  return box;
}

function preguntar(titulo, cuerpo, textoSi) {
  return new Promise((resolve) => {
    const cerrar = (v) => {
      box.remove();
      resolve(v);
    };
    const box = overlay("aviso", titulo, cuerpo, [
      el("button", { class: "ov-btn ov-btn-sec", onclick: () => cerrar(false) }, "Cancelar"),
      el("button", { class: "ov-btn", onclick: () => cerrar(true) }, textoSi),
    ]);
  });
}

// ---- registrar ----

async function alPresionar(accion) {
  if (st.ocupado || !st.empleado) return;
  st.ocupado = true;
  clearTimeout(st.timer);
  try {
    const cara = cam.estadoCara();
    if (cara === "No detectada") {
      overlay("error", "No se detecta su rostro", "Mire de frente a la cámara, con buena luz, y vuelva a presionar el botón.", null, 3000);
      return reiniciarInactividad();
    }
    const fotoBlob = await cam.capturarFoto();
    let res = await store.registrar({ empleado: st.empleado, accion, fotoBlob, cara });

    if (!res.ok && res.motivo === "fueraSecuencia") {
      const u = res.estado.ultimo;
      const esperadas = res.estado.esperadas.map((a) => `<b>${store.ETIQUETAS[a]}</b>`).join(" o ");
      const si = await preguntar(
        "¿Está seguro?",
        `${u ? `Su último registro fue <b>${store.ETIQUETAS[u.accion]}</b> a las ${store.hhmm(u.ts)}.<br>` : ""}Lo que corresponde ahora es ${esperadas}.<br><br>¿Registrar <b>${store.ETIQUETAS[accion]}</b> de todas formas? Talento Humano lo verá como novedad.`,
        "Sí, registrar"
      );
      if (!si) return reiniciarInactividad();
      res = await store.registrar({ empleado: st.empleado, accion, fotoBlob, cara, confirmadoFueraSecuencia: true });
    }

    if (!res.ok && res.motivo === "duplicado") {
      overlay("aviso", "Ya está registrado", `${st.empleado.nombre}<br><b>${store.ETIQUETAS[accion]}</b> ya quedó registrado a las <b>${store.hhmm(res.previo.ts)}</b>.<br>No hace falta volver a marcar.`, null, 3200);
      limpiar();
      return;
    }

    if (res.ok) {
      const extra = cara === "Detectada" ? "" : `<div class="ov-nota">Rostro: ${cara}</div>`;
      overlay("ok", "Registro exitoso", `${st.empleado.nombre}<br><span class="ov-accion">${store.ETIQUETAS[accion]}</span><br><span class="ov-hora">${store.hhmm(res.reg.ts)}</span>${extra}`);
      limpiar();
    }
  } catch (e) {
    console.error(e);
    overlay("error", "No se pudo registrar", "Intente de nuevo. Si persiste, avise a Talento Humano.", null, 3500);
  } finally {
    st.ocupado = false;
  }
}

// ---- sincronización (chip de estado) ----

function pintarSync(s) {
  const chip = $("sync-chip");
  const txt = {
    demo: "Modo demo",
    ok: s.pendientes ? `Enviando ${s.pendientes}…` : "Sincronizado",
    offline: `Sin internet · ${s.pendientes} en espera`,
    error: `Reintentando · ${s.pendientes} en espera`,
    sesion: `Falta iniciar sesión (TH) · ${s.pendientes} en espera`,
  }[s.estado];
  chip.textContent = txt;
  chip.className = `sync-chip sync-${s.estado}`;
}

// ---- arranque ----

export async function iniciarKiosco({ onAdmin }) {
  tickReloj();
  setInterval(tickReloj, 1000);

  document.querySelectorAll(".pad button").forEach((b) => b.addEventListener("click", () => tecla(b.dataset.d)));
  document.querySelectorAll(".acc").forEach((b) => b.addEventListener("click", () => alPresionar(b.dataset.accion)));
  document.addEventListener("keydown", (e) => {
    if (document.querySelector(".admin") || e.target.tagName === "INPUT") return;
    if (/^[0-9]$/.test(e.key)) tecla(e.key);
    else if (e.key === "Backspace") tecla("borrar");
    else if (e.key === "Escape") tecla("ok");
  });
  $("btn-admin").addEventListener("click", onAdmin);

  store.onSyncChange(pintarSync);
  pintarSync(store.getSyncState());

  const okCam = await cam.iniciarCamara($("cam-video"));
  $("cam-msg").textContent = okCam ? "" : "Cámara no disponible — avise a Talento Humano";
  $("cam-msg").classList.toggle("visible", !okCam);
  if (okCam) {
    cam.onCaraChange((hay) => {
      $("cam-box").classList.toggle("cara-ok", hay);
      $("cara-hint").textContent = hay ? "Rostro detectado" : "Ubique su rostro frente a la cámara";
      $("cara-hint").classList.toggle("ok", hay);
    });
    cam.iniciarDeteccion();
  }
}

export { limpiar };

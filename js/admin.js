// Panel de Talento Humano: reporte por jornada con novedades + estado de la
// tablet (nombre, sesión de Microsoft, sincronización, empleados).
// Se abre con el botón de la esquina inferior izquierda + PIN de CONFIG.

import { CONFIG } from "./config.js";
import { el } from "./dom.js";
import * as store from "./store.js";
import { idb } from "./db.js";
import { login, logout, getCurrentUser } from "./auth.js";

const root = () => document.getElementById("overlay-root");

// PIN con teclado en pantalla propio: en la tablet el teclado del sistema
// (autocorrector, espacios, teclado de letras) hacía fallar el PIN.
// También acepta el teclado físico. Valida solo al llegar a la longitud.
export function pedirPin(onOk) {
  let pin = "";
  const pinLen = CONFIG.pinAdmin.length;
  const puntos = el("div", { class: "pin-input" });
  const err = el("div", { class: "pin-err" });
  const pintar = () => (puntos.textContent = "•".repeat(pin.length) || " ");
  const cerrar = () => {
    document.removeEventListener("keydown", onKey);
    box.remove();
  };
  const tecla = (d) => {
    err.textContent = "";
    if (d === "borrar") pin = pin.slice(0, -1);
    else if (pin.length < pinLen) pin += d;
    pintar();
    if (pin.length === pinLen) {
      if (pin === CONFIG.pinAdmin) {
        cerrar();
        onOk();
      } else {
        err.textContent = "PIN incorrecto";
        pin = "";
        setTimeout(pintar, 300);
      }
    }
  };
  const onKey = (e) => {
    if (/^[0-9]$/.test(e.key)) tecla(e.key);
    else if (e.key === "Backspace") tecla("borrar");
    else if (e.key === "Escape") cerrar();
  };
  document.addEventListener("keydown", onKey);
  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar", "0"].map((d) =>
    el("button", { class: d === "borrar" ? "pad-borrar" : "", onclick: () => tecla(d) }, d === "borrar" ? "Borrar" : d)
  );
  const box = el("div", { class: "ov ov-aviso" }, [
    el("div", { class: "ov-card" }, [
      el("div", { class: "ov-titulo" }, "Panel de Talento Humano"),
      puntos,
      err,
      el("div", { class: "pad pin-pad" }, teclas),
      el("div", { class: "ov-botones" }, [el("button", { class: "ov-btn ov-btn-sec", onclick: cerrar }, "Cancelar")]),
    ]),
  ]);
  root().innerHTML = "";
  root().appendChild(box);
  pintar();
}

export function abrirPanel() {
  const body = el("div", { class: "admin-body" });
  const tabs = [
    ["reporte", "Reporte de jornadas", () => vistaReporte(body)],
    ["tablet", "Esta tablet", () => vistaTablet(body)],
  ];
  const nav = el(
    "nav",
    { class: "admin-tabs" },
    tabs.map(([id, txt, fn]) =>
      el("button", {
        "data-tab": id,
        onclick: (e) => {
          nav.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
          fn();
        },
      }, txt)
    )
  );
  const panel = el("div", { class: "admin" }, [
    el("header", { class: "admin-head" }, [
      el("h2", {}, "Talento Humano · Asistencia"),
      el("button", { class: "ov-btn ov-btn-sec", onclick: () => panel.remove() }, "Cerrar"),
    ]),
    nav,
    body,
  ]);
  root().innerHTML = "";
  root().appendChild(panel);
  nav.querySelector("button").click();
}

// ---------- Reporte ----------

const hoy = () => store.ymd(new Date());
const h = (ts) => (ts ? store.hhmm(ts) : "—");

async function vistaReporte(body) {
  body.innerHTML = "";
  const desde = el("input", { type: "date", value: hoy() });
  const hasta = el("input", { type: "date", value: hoy() });
  const soloNov = el("input", { type: "checkbox" });
  const resumen = el("div", { class: "rep-resumen" });
  const tabla = el("div", { class: "rep-tabla" });
  let jornadas = [];

  const pintar = () => {
    const filas = soloNov.checked ? jornadas.filter((j) => j.novedades.length) : jornadas;
    const conNov = jornadas.filter((j) => j.novedades.length).length;
    resumen.innerHTML = "";
    for (const [n, t] of [
      [new Set(jornadas.map((j) => j.empleadoId)).size, "personas"],
      [jornadas.length, "jornadas"],
      [conNov, "con novedad"],
      [jornadas.filter((j) => !j.salida).length, "sin salida"],
    ]) resumen.appendChild(el("div", { class: "kpi" }, [el("b", {}, String(n)), el("span", {}, t)]));

    tabla.innerHTML = "";
    const t = el("table", {}, [
      el("thead", {}, el("tr", {}, ["Jornada", "ID", "Nombre", "Ingreso", "Inicio alim.", "Fin alim.", "Salida", "Horas", "Novedades"].map((x) => el("th", {}, x)))),
    ]);
    const tb = el("tbody");
    for (const j of filas) {
      const tr = el("tr", { class: j.novedades.length ? "con-nov" : "" }, [
        el("td", {}, j.jornada.slice(5).split("-").reverse().join("/")),
        el("td", {}, j.empleadoId),
        el("td", {}, j.nombre),
        el("td", {}, h(j.ingreso)),
        el("td", {}, h(j.almIni)),
        el("td", {}, h(j.almFin)),
        el("td", {}, h(j.salida)),
        el("td", {}, j.horas != null ? j.horas.toFixed(1) : "—"),
        el("td", {}, j.novedades.map((n) => el("span", { class: "nov" }, n))),
      ]);
      const det = el("tr", { class: "det hidden" }, [
        el("td", { colspan: "9" }, j.registros.map((r) =>
          el("div", { class: "det-reg" }, [
            `${store.ETIQUETAS[r.accion]} · ${r.fechaHoraLocal} · ${r.dispositivo} · Rostro: ${r.cara || "—"}`,
            r.observacion ? ` · ${r.observacion}` : "",
            r.fotoUrl ? el("a", { href: r.fotoUrl, target: "_blank", rel: "noopener" }, " · ver foto") : "",
            r.sincronizado ? "" : el("em", {}, " · pendiente de envío"),
          ])
        )),
      ]);
      tr.addEventListener("click", () => det.classList.toggle("hidden"));
      tb.append(tr, det);
    }
    t.appendChild(tb);
    tabla.appendChild(filas.length ? t : el("p", { class: "vacio" }, "Sin registros en el rango."));
  };

  const consultar = async () => {
    tabla.innerHTML = "<p class='vacio'>Consultando…</p>";
    try {
      jornadas = store.armarJornadas(await store.registrosRango(desde.value, hasta.value));
      pintar();
    } catch (e) {
      tabla.innerHTML = "";
      tabla.appendChild(el("p", { class: "vacio err" }, `No se pudo consultar: ${e.message}`));
    }
  };

  const descargar = () => {
    const blob = new Blob([store.jornadasACsv(jornadas)], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `Asistencia_${desde.value}_a_${hasta.value}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  soloNov.addEventListener("change", pintar);
  body.append(
    el("div", { class: "rep-filtros" }, [
      el("label", {}, ["Desde ", desde]),
      el("label", {}, ["Hasta ", hasta]),
      el("label", { class: "chk" }, [soloNov, " Solo con novedades"]),
      el("button", { class: "ov-btn", onclick: consultar }, "Consultar"),
      el("button", { class: "ov-btn ov-btn-sec", onclick: descargar }, "Descargar Excel"),
    ]),
    resumen,
    tabla
  );
  consultar();
}

// ---------- Esta tablet ----------

async function vistaTablet(body) {
  body.innerHTML = "";
  const s = store.getSyncState();
  const nombre = el("input", { type: "text", value: store.getDispositivo() });
  const empAt = await idb.get("meta", "empleadosAt");
  const user = CONFIG.useMock ? null : getCurrentUser();
  const msg = el("div", { class: "tab-msg" });

  const fila = (k, v) => el("div", { class: "kv" }, [el("span", {}, k), el("b", {}, v)]);
  const estadoTxt = { demo: "Modo demo (no envía a SharePoint)", ok: "Al día", offline: "Sin internet", error: "Con errores, reintentando", sesion: "Sesión de Microsoft vencida" }[s.estado];

  body.append(
    el("section", { class: "tab-sec" }, [
      el("h3", {}, "Identificación"),
      el("label", {}, ["Nombre de esta tablet (ej. Tablet-Ingreso-Planta) ", nombre]),
      el("button", { class: "ov-btn", onclick: () => { store.setDispositivo(nombre.value); msg.textContent = "Nombre guardado."; } }, "Guardar nombre"),
    ]),
    el("section", { class: "tab-sec" }, [
      el("h3", {}, "Sincronización con SharePoint"),
      fila("Estado", estadoTxt),
      fila("Marcaciones en espera", String(s.pendientes)),
      fila("Último envío correcto", s.ultimoOk ? new Date(s.ultimoOk).toLocaleString("es-EC") : "—"),
      s.error ? fila("Último error", s.error) : null,
      el("button", { class: "ov-btn", onclick: async () => { msg.textContent = "Sincronizando…"; await store.sync(); await store.syncRemoto(); vistaTablet(body); } }, "Sincronizar ahora"),
    ]),
    el("section", { class: "tab-sec" }, [
      el("h3", {}, "Sesión de Microsoft (cuenta de la tablet)"),
      CONFIG.useMock
        ? el("p", {}, "En modo demo no se usa sesión.")
        : el("div", {}, [
            fila("Cuenta", user ? user.username : "Sin sesión"),
            user
              ? el("button", { class: "ov-btn ov-btn-sec", onclick: () => logout() }, "Cerrar sesión")
              : el("button", { class: "ov-btn", onclick: () => login() }, "Iniciar sesión"),
            user && s.estado === "sesion" ? el("button", { class: "ov-btn", onclick: () => login() }, "Volver a iniciar sesión") : null,
          ]),
    ]),
    el("section", { class: "tab-sec" }, [
      el("h3", {}, "Empleados"),
      fila("Activos en la tablet", String(store.totalEmpleados())),
      fila("Actualizado", empAt ? new Date(empAt.ts).toLocaleString("es-EC") : "—"),
      el("button", {
        class: "ov-btn",
        onclick: async () => {
          msg.textContent = "Actualizando…";
          try {
            const n = await store.refrescarEmpleados();
            msg.textContent = `${n} empleados activos cargados.`;
          } catch (e) {
            msg.textContent = e.message;
          }
        },
      }, "Actualizar desde SharePoint"),
      CONFIG.useMock
        ? el("button", { class: "ov-btn ov-btn-sec", onclick: async () => { msg.textContent = `${await cargarDemo()} marcaciones de ejemplo cargadas (jornada 01/10/2026).`; } }, "Cargar marcaciones de ejemplo")
        : null,
    ]),
    msg
  );
}

// Solo demo: carga el export real del 1/10/2026 (data/asistencias_demo.json)
// para probar el reporte de novedades sin esperar a que haya marcaciones.
async function cargarDemo() {
  const regs = await fetch("data/asistencias_demo.json").then((r) => r.json());
  for (const r of regs) await idb.put("registros", r);
  return regs.length;
}

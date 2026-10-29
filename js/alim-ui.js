// Pantallas del pedido de alimentación:
// - abrirPedido(): ventana en el kiosco (la persona pide con su código).
// - vistaAlimentacion(): pestaña del panel de TH (consolidado por proveedor,
//   detalle y descuento por persona).

import { el } from "./dom.js";
import * as alim from "./alimentacion.js";
import { ymd } from "./store.js";

const root = () => document.getElementById("overlay-root");
const SEG_INACTIVIDAD = 60;

// ================= Kiosco =================

export async function abrirPedido(empleado, { onCerrar }) {
  const esJefe = alim.puedePedirHealthy(empleado);
  let modo = "Personal"; // o "Healthy"
  let timer = null;

  const cuerpo = el("div", { class: "alim-cuerpo" });
  const box = el("div", { class: "ov ov-alim" }, [
    el("div", { class: "alim-card" }, [
      el("header", { class: "alim-head" }, [
        el("div", {}, [el("div", { class: "alim-over" }, "Pedido de alimentación · hoy"), el("h2", {}, empleado.nombre)]),
        el("button", { class: "ov-btn ov-btn-sec", onclick: () => cerrar() }, "Cerrar"),
      ]),
      cuerpo,
    ]),
  ]);

  const cerrar = () => {
    clearTimeout(timer);
    box.remove();
    onCerrar?.();
  };
  const tocar = () => {
    clearTimeout(timer);
    timer = setTimeout(cerrar, SEG_INACTIVIDAD * 1000);
  };
  box.addEventListener("pointerdown", tocar);

  // Aviso dentro de la ventana (no cierra la ventana de pedido).
  const aviso = (tipo, titulo, texto, botones = null, ms = 3500) =>
    new Promise((resolve) => {
      const capa = el("div", { class: `ov ov-${tipo} ov-sobre` }, [
        el("div", { class: "ov-card" }, [
          el("div", { class: "ov-titulo" }, titulo),
          el("div", { class: "ov-cuerpo", html: texto }),
          botones ? el("div", { class: "ov-botones" }, botones.map(([txt, val, sec]) =>
            el("button", { class: `ov-btn ${sec ? "ov-btn-sec" : ""}`, onclick: () => { capa.remove(); resolve(val); } }, txt))) : null,
        ]),
      ]);
      if (!botones) {
        setTimeout(() => { capa.remove(); resolve(null); }, ms);
        capa.addEventListener("pointerdown", () => { capa.remove(); resolve(null); });
      }
      document.body.appendChild(capa);
    });

  const pintar = async () => {
    const mios = await alim.pedidosHoyEmpleado(empleado.empleadoId);
    const personales = mios.filter((p) => p.tipo === "Personal");
    cuerpo.innerHTML = "";

    if (esJefe) {
      cuerpo.appendChild(el("div", { class: "alim-modo" }, [
        ["Personal", "Para mí (se descuenta del rol)"],
        ["Healthy", "A nombre de Healthy (secos, sin descuento)"],
      ].map(([m, txt]) => el("button", { class: modo === m ? "on" : "", onclick: () => { modo = m; pintar(); } }, txt))));
    }

    if (mios.length) {
      cuerpo.appendChild(el("div", { class: "alim-mios" }, [
        el("div", { class: "alim-sub" }, "Sus pedidos de hoy"),
        ...mios.map((p) => {
          const item = alim.MENU.find((m) => m.nombre === p.producto);
          const puede = item && alim.abierto(item);
          return el("div", { class: "alim-mio" }, [
            el("span", {}, [el("b", {}, `${p.tipo === "Healthy" ? `${p.cantidad} × ` : ""}${p.producto}`), ` · ${p.proveedor} · ${alim.dinero(p.costo * p.cantidad)}${p.tipo === "Healthy" ? " · a nombre de Healthy" : ""}`]),
            puede
              ? el("button", { class: "ov-btn ov-btn-sec", onclick: async () => {
                  const si = await aviso("aviso", "¿Cancelar pedido?", `${p.producto} de ${p.proveedor}.`, [["No", false, true], ["Sí, cancelar", true]]);
                  if (!si) return;
                  await alim.cancelar(p);
                  pintar();
                } }, "Cancelar")
              : el("small", {}, "Ya no se puede cancelar"),
          ]);
        }),
      ]));
    }

    // Lo que todavía se puede pedir va primero; lo cerrado queda abajo.
    const abiertaComida = (c) => alim.MENU.some((m) => m.comida === c && alim.abierto(m));
    const orden = [...alim.COMIDAS].sort((a, b) => abiertaComida(b) - abiertaComida(a));
    for (const comida of orden) {
      const items = alim.MENU.filter((m) => m.comida === comida && (modo === "Personal" || m.seco));
      if (!items.length) continue;
      const yaTiene = modo === "Personal" && personales.find((p) => p.comida === comida);
      const hora = items[0].hora;
      const abierta = items.some((i) => alim.abierto(i));
      cuerpo.appendChild(el("section", { class: `alim-comida ${abierta ? "" : "cerrada"}` }, [
        el("div", { class: "alim-comida-head" }, [
          el("h3", {}, comida),
          el("span", { class: `alim-hora ${abierta ? "" : "off"}` }, abierta ? `Pedir hasta las ${hora}` : `Cerrado · era hasta las ${hora}`),
          yaTiene ? el("span", { class: "alim-ya" }, `Ya pidió: ${yaTiene.producto}`) : null,
        ]),
        el("div", { class: "alim-items" }, items.map((item) =>
          el("div", { class: "alim-item" }, [
            el("div", { class: "alim-item-nombre" }, item.nombre),
            el("div", { class: "alim-precios" }, Object.entries(item.precios).map(([prov, precio]) =>
              el("button", {
                class: "alim-prov",
                onclick: () => elegir(item, prov, yaTiene),
              }, [el("span", {}, alim.PROVEEDORES[prov]), el("b", {}, alim.dinero(precio))])
            )),
          ])
        )),
      ]));
    }
  };

  const elegir = async (item, prov, yaTiene) => {
    // Educar: fuera de horario no se procede.
    if (!alim.abierto(item)) {
      await aviso("error", "Fuera de horario",
        `El pedido de <b>${item.comida.toLowerCase()}</b> se recibe <b>hasta las ${item.hora}</b>.<br>Hoy ya no es posible pedirlo.<br><br>Recuerde hacer su pedido antes de las ${item.hora} la próxima vez.`, null, 5000);
      return;
    }
    if (yaTiene) {
      await aviso("aviso", "Ya tiene un pedido",
        `Para ${item.comida.toLowerCase()} ya pidió <b>${yaTiene.producto}</b> (${yaTiene.proveedor}).<br>Si quiere cambiarlo, primero cancele ese pedido arriba.`, null, 4500);
      return;
    }
    const precio = item.precios[prov];
    let cantidad = 1;
    let observacion = "";
    if (modo === "Healthy") {
      const r = await pedirCantidad(item, prov);
      if (!r) return;
      ({ cantidad, observacion } = r);
    }
    const si = await aviso("aviso", "Confirmar pedido",
      modo === "Healthy"
        ? `<b>${cantidad} × ${item.nombre}</b><br>${alim.PROVEEDORES[prov]} · ${alim.dinero(precio)} c/u<br><br>A nombre de <b>Healthy Food</b> (no se descuenta del rol).`
        : `<b>${item.nombre}</b><br>${alim.PROVEEDORES[prov]} · <b>${alim.dinero(precio)}</b><br><br>Este valor se descuenta de su rol de pagos.`,
      [["Cancelar", false, true], ["Confirmar", true]]);
    if (!si) return;
    const res = await alim.pedir({ empleado, item, proveedor: prov, tipo: modo, cantidad, observacion });
    if (res.ok) {
      await aviso("ok", "¡Pedido registrado!", `${modo === "Healthy" ? `${cantidad} × ` : ""}${item.nombre} · ${alim.PROVEEDORES[prov]}<br><span class="ov-accion">¡Buen provecho!</span>`, null, 2500);
      pintar();
    } else if (res.motivo === "fueraHorario") {
      await aviso("error", "Fuera de horario", `El pedido se recibe hasta las ${item.hora}.`, null, 4000);
    } else if (res.motivo === "yaPidio") {
      await aviso("aviso", "Ya tiene un pedido", `Ya pidió ${res.pedido.producto} para ${item.comida.toLowerCase()}.`, null, 4000);
      pintar();
    }
  };

  // Cantidad para pedidos a nombre de Healthy (teclado en pantalla, como el PIN).
  const pedirCantidad = (item, prov) =>
    new Promise((resolve) => {
      let n = "";
      const valor = el("div", { class: "pin-input" }, " ");
      const nota = el("input", { type: "text", class: "alim-nota", placeholder: "Área o motivo (opcional)" });
      const pintarN = () => (valor.textContent = n || " ");
      const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar", "0"].map((d) =>
        el("button", { class: d === "borrar" ? "pad-borrar" : "", onclick: () => {
          if (d === "borrar") n = n.slice(0, -1);
          else if (n.length < 2) n = (n + d).replace(/^0+/, "");
          pintarN();
        } }, d === "borrar" ? "Borrar" : d));
      const capa = el("div", { class: "ov ov-aviso ov-sobre" }, [
        el("div", { class: "ov-card" }, [
          el("div", { class: "ov-titulo" }, "¿Cuántos?"),
          el("div", { class: "ov-cuerpo" }, `${item.nombre} · ${alim.PROVEEDORES[prov]}`),
          valor,
          el("div", { class: "pad pin-pad" }, teclas),
          nota,
          el("div", { class: "ov-botones" }, [
            el("button", { class: "ov-btn ov-btn-sec", onclick: () => { capa.remove(); resolve(null); } }, "Cancelar"),
            el("button", { class: "ov-btn", onclick: () => {
              const c = parseInt(n, 10);
              if (!c) return;
              capa.remove();
              resolve({ cantidad: c, observacion: nota.value.trim() });
            } }, "Continuar"),
          ]),
        ]),
      ]);
      document.body.appendChild(capa);
    });

  root().innerHTML = "";
  root().appendChild(box);
  tocar();
  await pintar();
  // Lo pedido en la otra tablet, al momento.
  alim.syncRemotoPedidos(empleado.empleadoId).then(() => box.isConnected && pintar());
}

// ================= Panel TH =================

export async function vistaAlimentacion(body) {
  body.innerHTML = "";
  const hoy = ymd(new Date());
  const desde = el("input", { type: "date", value: hoy });
  const hasta = el("input", { type: "date", value: hoy });
  const verCancelados = el("input", { type: "checkbox" });
  const zona = el("div");
  let pedidos = [];

  const descargar = (contenido, nombre) => {
    const a = el("a", { href: URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" })), download: nombre });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const tabla = (cabecera, filas) =>
    el("table", {}, [
      el("thead", {}, el("tr", {}, cabecera.map((c) => el("th", {}, c)))),
      el("tbody", {}, filas.map((f) => el("tr", {}, f.map((c) => el("td", {}, c))))),
    ]);

  const pintar = (soloLocal) => {
    zona.innerHTML = "";
    if (soloLocal) zona.appendChild(el("p", { class: "vacio err" }, "Sin conexión con SharePoint: se muestra solo lo guardado en ESTA tablet."));
    const activos = pedidos.filter((p) => p.estado === "Activo");
    const totalPersonal = activos.filter((p) => p.tipo === "Personal").reduce((s, p) => s + p.costo * p.cantidad, 0);
    const totalHealthy = activos.filter((p) => p.tipo === "Healthy").reduce((s, p) => s + p.costo * p.cantidad, 0);

    zona.appendChild(el("div", { class: "rep-resumen" }, [
      [activos.reduce((s, p) => s + p.cantidad, 0), "porciones"],
      [new Set(activos.filter((p) => p.tipo === "Personal").map((p) => p.empleadoId)).size, "personas"],
      [alim.dinero(totalPersonal), "a descontar"],
      [alim.dinero(totalHealthy), "a cargo de Healthy"],
    ].map(([n, t]) => el("div", { class: "kpi" }, [el("b", {}, String(n)), el("span", {}, t)]))));

    // 1. Por proveedor (lo que hay que pedirle a cada uno)
    const cons = alim.consolidar(pedidos);
    zona.appendChild(el("h3", { class: "alim-h3" }, "Pedido por proveedor"));
    if (!Object.keys(cons).length) zona.appendChild(el("p", { class: "vacio" }, "Sin pedidos en el rango."));
    for (const [prov, filasObj] of Object.entries(cons)) {
      const filas = Object.values(filasObj).sort((a, b) => a.producto.localeCompare(b.producto));
      // Para el proveedor da igual quién paga: se suman personales + Healthy.
      const porProducto = {};
      for (const f of filas) (porProducto[f.producto] ||= { producto: f.producto, cantidad: 0 }).cantidad += f.cantidad;
      const texto = alim.textoProveedor(prov, Object.values(porProducto), desde.value === hasta.value ? desde.value : `${desde.value} a ${hasta.value}`);
      const total = filas.reduce((s, f) => s + f.total, 0);
      zona.appendChild(el("div", { class: "tab-sec alim-prov-sec" }, [
        el("div", { class: "alim-prov-head" }, [
          el("h3", {}, `${prov} · ${alim.dinero(total)}`),
          el("button", { class: "ov-btn ov-btn-sec", onclick: async (e) => {
            try { await navigator.clipboard.writeText(texto); e.currentTarget.textContent = "¡Copiado!"; } catch { prompt("Copie el pedido:", texto); }
          } }, "Copiar pedido"),
        ]),
        el("div", { class: "rep-tabla" }, tabla(["Producto", "Tipo", "Cantidad", "Costo", "Total"],
          filas.map((f) => [f.producto, f.tipo === "Healthy" ? "Healthy (sin descuento)" : "Personal", String(f.cantidad), alim.dinero(f.costo), alim.dinero(f.total)]))),
      ]));
    }

    // 2. Descuento por persona (rol de pagos)
    const desc = alim.descuentos(pedidos);
    zona.appendChild(el("div", { class: "alim-prov-head" }, [
      el("h3", { class: "alim-h3" }, "Descuento por persona (rol de pagos)"),
      el("button", { class: "ov-btn ov-btn-sec", onclick: () => descargar(alim.descuentosACsv(desc), `Descuentos_alimentacion_${desde.value}_a_${hasta.value}.csv`) }, "Descargar Excel"),
    ]));
    zona.appendChild(el("div", { class: "rep-tabla" }, desc.length
      ? tabla(["ID", "Nombre", "Pedidos", "Total"], desc.map((d) => [d.empleadoId, d.nombre, String(d.pedidos), alim.dinero(d.total)]))
      : el("p", { class: "vacio" }, "Sin pedidos personales.")));

    // 3. Detalle
    const det = verCancelados.checked ? pedidos : activos;
    zona.appendChild(el("div", { class: "alim-prov-head" }, [
      el("h3", { class: "alim-h3" }, "Detalle de pedidos"),
      el("button", { class: "ov-btn ov-btn-sec", onclick: () => descargar(alim.pedidosACsv(pedidos), `Pedidos_alimentacion_${desde.value}_a_${hasta.value}.csv`) }, "Descargar Excel"),
    ]));
    zona.appendChild(el("div", { class: "rep-tabla" }, det.length
      ? tabla(["Fecha", "Hora", "ID", "Nombre", "Producto", "Proveedor", "Cant.", "Total", "Tipo", "Estado"], det.map((p) => [
          p.fecha.slice(5).split("-").reverse().join("/"),
          new Date(p.ts).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", hour12: false }),
          p.empleadoId, p.nombre, p.producto, p.proveedor, String(p.cantidad), alim.dinero(p.costo * p.cantidad),
          p.tipo === "Healthy" ? `Healthy${p.observacion ? ` · ${p.observacion}` : ""}` : "Personal",
          p.estado + (p.pendiente ? " (por enviar)" : ""),
        ]))
      : el("p", { class: "vacio" }, "Sin pedidos.")));
  };

  const consultar = async () => {
    zona.innerHTML = "<p class='vacio'>Consultando…</p>";
    const r = await alim.pedidosRango(desde.value, hasta.value);
    pedidos = r.pedidos;
    pintar(r.soloLocal);
  };

  verCancelados.addEventListener("change", () => pintar());
  body.append(
    el("div", { class: "rep-filtros" }, [
      el("label", {}, ["Desde ", desde]),
      el("label", {}, ["Hasta ", hasta]),
      el("label", { class: "chk" }, [verCancelados, " Ver cancelados en el detalle"]),
      el("button", { class: "ov-btn", onclick: consultar }, "Consultar"),
    ]),
    zona
  );
  consultar();
}

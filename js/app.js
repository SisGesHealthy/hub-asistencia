// Arranque del kiosco.
import { CONFIG } from "./config.js";
import { initAuth, puedeRenovar, renovarSesion } from "./auth.js";
import * as store from "./store.js";
import { iniciarKiosco, kioscoLibre } from "./kiosk.js";
import { pedirPin, abrirPanel } from "./admin.js";

async function main() {
  let cuenta = null;
  if (!CONFIG.useMock) cuenta = await initAuth().catch((e) => console.warn("MSAL:", e));
  if (!CONFIG.useMock && !cuenta) store.marcarSinSesion();

  // Almacenamiento persistente: que el navegador nunca borre por espacio las
  // marcaciones guardadas en la tablet que aún no se envían.
  navigator.storage?.persist?.().catch(() => {});

  // Empleados: primero la copia local (instantáneo), luego refresco.
  const locales = await store.cargarEmpleadosLocales();
  const refresco = store.refrescarEmpleados().catch((e) => console.warn("Empleados:", e.message));
  if (locales === 0) await refresco;

  await iniciarKiosco({ onAdmin: () => pedirPin(abrirPanel) });

  store.purgarViejos();
  store.syncRemoto().then(() => store.sync());
  setInterval(() => store.sync(), 20000);
  setInterval(() => store.syncRemoto(), CONFIG.segundosSyncRemoto * 1000);
  setInterval(() => store.refrescarEmpleados().catch(() => {}), CONFIG.minutosRefrescoEmpleados * 60000);
  window.addEventListener("online", () => store.sync());

  // Sesión vencida (Microsoft corta la renovación silenciosa a las 24 h):
  // renovarla sola, sin pantalla de login, apenas el kiosco esté libre.
  if (!CONFIG.useMock) {
    setInterval(() => {
      if (store.getSyncState().estado === "sesion" && puedeRenovar() && kioscoLibre()) {
        renovarSesion().catch((e) => console.warn("Renovación de sesión:", e));
      }
    }, 15000);
  }

  if ("serviceWorker" in navigator && location.hostname !== "localhost") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // Pantalla siempre encendida en el kiosco, si el navegador lo permite.
  try {
    await navigator.wakeLock?.request("screen");
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") navigator.wakeLock?.request("screen").catch(() => {});
    });
  } catch {}
}

main();

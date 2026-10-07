// Envoltorio sobre MSAL (vendor/msal-browser.min.js). Solo se usa con
// CONFIG.useMock === false.
//
// Diferencia clave con los otros hubs: esto es un KIOSCO. Un operador nunca
// debe toparse con la pantalla de login de Microsoft a mitad de una
// marcación, así que la sincronización solo pide token en silencio
// (getAccessTokenSilent). Si el token ya no se puede renovar solo, la
// marcación se guarda igual en la tablet y el panel de TH muestra "Sesión
// vencida": alguien de TH/Sistemas entra al panel y vuelve a iniciar sesión.

import { CONFIG } from "./config.js";

let msalInstance = null;
let account = null;

const SCOPES = ["Sites.ReadWrite.All"];

function getMsal() {
  if (!msalInstance) {
    msalInstance = new msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.msal.clientId,
        authority: CONFIG.msal.authority,
        redirectUri: CONFIG.msal.redirectUri,
      },
      cache: { cacheLocation: "localStorage" },
    });
  }
  return msalInstance;
}

export async function initAuth() {
  const app = getMsal();
  await app.initialize();
  const result = await app.handleRedirectPromise().catch(() => null);
  if (result && result.account) {
    account = result.account;
  } else {
    const accounts = app.getAllAccounts();
    if (accounts.length > 0) account = accounts[0];
  }
  return account;
}

export function login() {
  // select_account: que siempre se pueda elegir con qué cuenta queda la tablet
  // (si el navegador ya tiene abierta otra, ej. la de administrador).
  return getMsal().loginRedirect({ scopes: SCOPES, prompt: "select_account" });
}

export function logout() {
  return getMsal().logoutRedirect({ account });
}

export function getCurrentUser() {
  return account;
}

export class SesionVencidaError extends Error {}

// Renovación automática de la sesión del kiosco.
// Microsoft limita a 24 h el "refresh token" de las apps web: pasado ese
// plazo acquireTokenSilent falla aunque la cuenta siga activa, y la tablet
// dejaba de enviar (las marcaciones quedaban guardadas en la tablet, en
// espera). La salida es un ida y vuelta a login.microsoftonline.com con
// prompt "none": si la cookie de Microsoft sigue válida vuelve sola en ~2 s
// con un token nuevo, SIN mostrar ninguna pantalla; si de verdad hace falta
// escribir la contraseña, vuelve con error (no se queda en la página de
// login) y el chip rojo pide a TH iniciar sesión.
// app.js solo la llama con el kiosco libre y como máximo cada 20 min.
const LS_RENOVACION = "hub-asistencia:ultima-renovacion";

export function puedeRenovar() {
  if (!account) return false;
  let ultima = 0;
  try {
    ultima = Number(localStorage.getItem(LS_RENOVACION) || 0);
  } catch {}
  return Date.now() - ultima > 20 * 60 * 1000;
}

export function renovarSesion() {
  try {
    localStorage.setItem(LS_RENOVACION, String(Date.now()));
  } catch {}
  return getMsal().acquireTokenRedirect({ scopes: SCOPES, account, prompt: "none" });
}

// Nunca redirige: lanza SesionVencidaError y el que llama decide.
export async function getAccessTokenSilent() {
  if (!account) throw new SesionVencidaError("No hay sesión iniciada en esta tablet.");
  try {
    const result = await getMsal().acquireTokenSilent({ scopes: SCOPES, account });
    return result.accessToken;
  } catch (e) {
    throw new SesionVencidaError("La sesión de Microsoft venció; inicia sesión desde el panel de TH.");
  }
}

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
  return getMsal().loginRedirect({ scopes: SCOPES });
}

export function logout() {
  return getMsal().logoutRedirect();
}

export function getCurrentUser() {
  return account;
}

export class SesionVencidaError extends Error {}

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

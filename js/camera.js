// Cámara + detección de rostro + captura de la foto de evidencia.
//
// La detección NO identifica a la persona: solo confirma que hay una cara
// frente a la cámara (no guarda datos biométricos). Detector, en orden:
//   1. FaceDetector nativo del navegador, si existe.
//   2. MediaPipe Face Detector (BlazeFace, ~230 KB), cargado desde CDN la
//      primera vez; el service worker lo deja en caché para trabajar sin red.
// Si ninguno carga, el registro se permite igual y queda "No verificada".

import { CONFIG } from "./config.js";

let stream = null;
let video = null;
let detector = null; // { detectar(video) -> Promise<boolean> }
let detectorEstado = "cargando"; // cargando | listo | no_disponible
let ultimaCaraTs = 0;
let loopId = null;
const listeners = new Set();

export const onCaraChange = (fn) => listeners.add(fn);

export async function iniciarCamara(videoEl) {
  video = videoEl;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    return true;
  } catch (e) {
    console.warn("Cámara no disponible:", e);
    return false;
  }
}

export const camaraActiva = () => !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");

async function cargarDetector() {
  const cfg = CONFIG.deteccionCara;
  if (!cfg.activa) return null;
  if ("FaceDetector" in window) {
    try {
      const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      return { detectar: async (v) => (await fd.detect(v)).length > 0 };
    } catch {}
  }
  const vision = await import(/* @vite-ignore */ cfg.moduloUrl);
  const fileset = await vision.FilesetResolver.forVisionTasks(cfg.wasmUrl);
  const fd = await vision.FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: cfg.modeloUrl },
    runningMode: "VIDEO",
    minDetectionConfidence: cfg.confianzaMinima,
  });
  return { detectar: async (v) => fd.detectForVideo(v, performance.now()).detections.length > 0 };
}

// Revisa la cámara ~3 veces por segundo y avisa si hay cara (para pintar el
// recuadro verde y que la persona sepa que está bien ubicada).
export async function iniciarDeteccion() {
  try {
    detector = await cargarDetector();
    detectorEstado = detector ? "listo" : "no_disponible";
  } catch (e) {
    console.warn("Detector de rostro no disponible:", e);
    detectorEstado = "no_disponible";
  }
  if (!detector) return;
  let ocupado = false;
  loopId = setInterval(async () => {
    if (ocupado || !camaraActiva() || video.readyState < 2) return;
    ocupado = true;
    try {
      const hay = await detector.detectar(video);
      if (hay) ultimaCaraTs = Date.now();
      listeners.forEach((fn) => fn(hay));
    } catch {}
    ocupado = false;
  }, 300);
}

export const getDetectorEstado = () => detectorEstado;

// Resultado que se guarda en la columna Cara del registro.
export function estadoCara() {
  if (!camaraActiva()) return "Sin cámara";
  if (detectorEstado !== "listo") return "No verificada";
  return Date.now() - ultimaCaraTs < 1500 ? "Detectada" : "No detectada";
}

export async function capturarFoto() {
  if (!camaraActiva() || video.readyState < 2) return null;
  const { ancho, calidad } = CONFIG.foto;
  const alto = Math.round((ancho * video.videoHeight) / video.videoWidth) || Math.round(ancho * 0.75);
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, ancho, alto);
  // Sello de fecha/hora dentro de la foto (evidencia aunque se renombre el archivo).
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(0, alto - 22, ancho, 22);
  ctx.fillStyle = "#fff";
  ctx.font = "13px sans-serif";
  ctx.fillText(new Date().toLocaleString("es-EC"), 8, alto - 7);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", calidad));
}

// Configuración del Hub Asistencia (kiosco de marcación de planta).
// En modo demo (useMock: true) los empleados salen de data/empleados_demo.json
// y las marcaciones solo se guardan en la tablet (IndexedDB). Para conectar a
// producción: registrar la app en Entra ID, completar clientId/authority y
// cambiar useMock a false (ver README.md).

export const CONFIG = {
  useMock: false,

  msal: {
    clientId: "6ddebf41-051f-4360-bbab-225efdca198d",
    authority: "https://login.microsoftonline.com/8f9b210d-f5e5-404f-9fed-a0a827154105",
    // Siempre la carpeta, sin "index.html": la app instalada abre
    // .../index.html y Entra ID solo tiene registrada la URL de la carpeta.
    redirectUri: window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
  },

  graph: {
    // Mismo sitio donde hoy viven las listas de la Power App — graph.js
    // resuelve siteId e id de cada lista por nombre en el primer uso.
    siteHostname: "marcalman.sharepoint.com",
    sitePath: "/sites/EspacioColaborativo",
    listNames: {
      // Lista existente: se lee tal cual (los nombres internos de sus
      // columnas se resuelven por nombre visible, ver graph.js).
      empleados: "Empleados",
      // Lista NUEVA (ver README): la vieja "Asistencias" queda como histórico.
      registros: "RegistrosAsistencia",
    },
    // Biblioteca existente donde ya se guardan las fotos de la Power App.
    photoLibraryName: "FotosBiometrico",
  },

  // Columnas de la lista Empleados, por su nombre VISIBLE en SharePoint.
  // (La columna de cédula se llama así, con el error de escritura original.)
  columnasEmpleados: {
    nombre: "NombreCompleto",
    empleadoId: "EmpleadoID",
    departamento: "Departamento",
    puesto: "Puesto",
    activo: "Activo",
  },

  // PIN para abrir el panel de Talento Humano desde el botón de la esquina.
  // Cámbialo antes de dejar las tablets en planta.
  pinAdmin: "2580",

  // La misma acción repetida por la misma persona dentro de este plazo se
  // considera doble toque y NO se registra (problema #1 de la Power App).
  minutosAntiDuplicado: 5,

  // Una jornada abierta (sin Salida) más vieja que esto ya no se considera
  // abierta: la siguiente marcación empieza una jornada nueva.
  horasMaxJornada: 16,

  // Cada cuánto se descargan las marcaciones de la OTRA tablet, para que
  // las dos conozcan el estado de cada persona.
  segundosSyncRemoto: 45,

  // Cada cuánto se refresca la lista de empleados desde SharePoint.
  minutosRefrescoEmpleados: 30,

  // Segundos que se muestra el nombre y los botones antes de limpiar la
  // pantalla si nadie presiona nada.
  segundosInactividad: 20,

  // Foto de evidencia: tamaño y calidad JPEG (~40-60 KB, frente a 0,5-1 MB
  // de los PNG que sube hoy la Power App).
  foto: { ancho: 480, calidad: 0.7 },

  // Detección de cara antes de registrar (no es reconocimiento: solo
  // confirma que hay un rostro frente a la cámara). Si el detector no se
  // puede cargar (sin internet la primera vez), se registra igual y queda
  // marcado "No verificada" para revisión de TH.
  deteccionCara: {
    activa: true,
    wasmUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    moduloUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
    modeloUrl:
      "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    confianzaMinima: 0.6,
  },
};

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
      // Lista NUEVA para los pedidos de alimentación (ver README).
      pedidos: "PedidosAlimentacion",
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

  // Tiempo de alimentación (entre Inicio y Fin). Al marcar Fin la tablet
  // avisa si se pasó del máximo (queda como novedad para TH) o si tomó
  // menos del mínimo.
  tiempoAlimentacion: { maximo: 30, minimo: 20 }, // maximo = tiempo oficial (30 min); minimo = por debajo de esto se avisa

  // ---- Pedido de alimentación ----
  // Cada persona pide en la tablet con su código; TH ve el consolidado por
  // proveedor y el descuento por persona. "hora" = hasta qué hora se acepta
  // el pedido del día (después, la tablet no lo deja pasar y explica por qué).
  // "precios" = costo por proveedor; si un proveedor no lo ofrece, no va.
  // "comida" agrupa: una persona puede tener UN pedido por comida al día.
  // Para cambiar precios u horarios, editar solo esta tabla.
  alimentacion: {
    proveedores: {
      monica: "Mónica",
      yanacallo: "María Yanacallo (frente)",
    },
    menu: [
      { id: "seco_desayuno", nombre: "Seco desayuno", comida: "Desayuno", hora: "07:00", precios: { yanacallo: 2.25 }, seco: true },
      { id: "desayuno_pan", nombre: "Desayuno pan, leche, huevos", comida: "Desayuno", hora: "07:00", precios: { yanacallo: 1.5 } },
      { id: "desayuno_agua", nombre: "Desayuno completo con agua", comida: "Desayuno", hora: "07:00", precios: { yanacallo: 3 } },
      { id: "desayuno_leche", nombre: "Desayuno completo con leche", comida: "Desayuno", hora: "07:00", precios: { yanacallo: 3 } },
      { id: "seco_almuerzo", nombre: "Seco almuerzo", comida: "Almuerzo", hora: "09:00", precios: { monica: 2, yanacallo: 2.25 }, seco: true },
      { id: "almuerzo", nombre: "Almuerzo", comida: "Almuerzo", hora: "09:00", precios: { monica: 3, yanacallo: 3 } },
      { id: "seco_dieta", nombre: "Seco dieta", comida: "Almuerzo", hora: "09:00", precios: { monica: 2.5 }, seco: true },
      { id: "sopa", nombre: "Sopa", comida: "Sopa", hora: "09:00", precios: { yanacallo: 1.5 } },
      { id: "seco_merienda", nombre: "Seco merienda", comida: "Merienda", hora: "15:00", precios: { monica: 2, yanacallo: 2.25 }, seco: true },
      { id: "merienda", nombre: "Merienda", comida: "Merienda", hora: "15:00", precios: { monica: 3, yanacallo: 3 } },
    ],
    // Quién puede pedir "a nombre de Healthy" (secos que no se descuentan
    // del rol): Puesto en la lista Empleados que contenga alguna de estas palabras.
    puestosPedidoHealthy: ["SUPERVISOR", "JEFE", "GERENTE"],
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

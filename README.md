# Hub Asistencia — Control de Asistencia de Planta

Reemplazo de la Power App "Registro de asistencia". Corre en las 2 tablets de
planta como app web instalable (kiosco), con el mismo esquema de Hub
Agrícola / Hub Limpieza: JavaScript sin frameworks, IndexedDB en la tablet y
Microsoft Graph directo contra SharePoint (sin servidor propio).

## Qué resuelve frente a la Power App

| Problema hoy | Cómo lo resuelve |
|---|---|
| Lentitud / "no responde" al marcar | La marcación se guarda en la tablet y se confirma al instante; la subida a SharePoint va por detrás con reintentos. |
| Ingresos/salidas duplicados por doble toque | La misma acción de la misma persona en menos de 5 min no se registra ("Ya está registrado"). |
| Secuencias rotas (fin de almuerzo sin inicio, dos ingresos) | Solo se resaltan los botones que corresponden; otro botón pide confirmación y queda marcado "Fuera de secuencia". |
| Salida después de medianoche cae en el día siguiente | Cada marcación lleva `Jornada` (fecha del turno), no solo fecha calendario. |
| Fotos PNG de 0,5–1 MB | JPEG de ~50 KB con fecha/hora impresa, mismo nombre de archivo en FotosBiometrico. |
| "Verificación facial" que no verificaba | Detección real de rostro: sin cara frente a la cámara no se registra. (No identifica a la persona ni guarda biometría.) |
| Se cae el internet → no se puede marcar | Sigue marcando sin red; envía todo al volver la conexión. |
| Lista que crece sin índice (límite 5.000 / delegación) | Lista nueva con `Jornada` y `EmpleadoID` indexadas; la app nunca consulta toda la lista. |
| TH arma reportes a mano | Panel TH (botón de la esquina + PIN): jornadas con horas, novedades y descarga a Excel. |

## Puesta en marcha

### 1. Lista nueva en SharePoint (sitio EspacioColaborativo)

Crear la lista **RegistrosAsistencia** (la vieja *Asistencias* queda como
histórico, sin tocarla). Al crear cada columna, escribir el nombre EXACTO
de la tabla — así su nombre interno queda igual al que usa la app. Detalle
en `Hub_Asistencia_Lista_SharePoint.xlsx`.

| Columna | Tipo | Notas |
|---|---|---|
| Title (ya existe) | Una línea de texto | Guarda el IdLocal (GUID). **Indexar.** |
| EmpleadoID | Una línea de texto | **Indexar.** |
| Nombre | Una línea de texto | |
| Accion | Elección | Ingreso, Inicio_Almuerzo, Fin_Almuerzo, Salida |
| FechaHora | Fecha y hora (incluir hora) | En UTC, SharePoint la muestra en hora local. |
| FechaHoraLocal | Una línea de texto | Mismo formato que la lista vieja. |
| Jornada | Una línea de texto | yyyy-mm-dd del turno. **Indexar.** |
| Dispositivo | Una línea de texto | Nombre de la tablet. |
| Foto | Una línea de texto | URL de la foto en FotosBiometrico. |
| Cara | Una línea de texto | Detectada / No detectada / No verificada / Sin cámara |
| FueraSecuencia | Sí/No | |
| Observacion | Varias líneas de texto | |

Índices: Configuración de la lista → Columnas indizadas → crear uno para
Title, EmpleadoID y Jornada.

### 2. Registro de la app en Entra ID

Igual que Hub Limpieza: Registro de aplicaciones → Nueva → "Hub Asistencia",
plataforma **SPA** con la URL donde se publique (y `http://localhost:8793/`
para pruebas), permiso delegado `Sites.ReadWrite.All` + consentimiento de
administrador. Copiar el clientId a `js/config.js` y poner `useMock: false`.

### 3. Tablets

1. Chrome (Android) o Edge/Chrome (Windows). Abrir la URL publicada →
   "Instalar app" / "Agregar a pantalla de inicio".
2. Permitir la cámara cuando la pida (una sola vez).
3. Botón de la esquina → PIN de TH → **Esta tablet**: poner nombre
   (ej. `Tablet-Ingreso`, `Tablet-Comedor`) e **Iniciar sesión** con una
   cuenta M365 que tenga permiso de edición en EspacioColaborativo.
4. Android: activar "Fijar pantalla" (App pinning) para que no se salgan de
   la app. Windows: Acceso asignado (modo quiosco).
5. Cambiar `pinAdmin` en `js/config.js` antes de publicar.

### 4. Transición sugerida

Una semana en paralelo: la Power App sigue en una tablet, Hub Asistencia en
la otra; comparar en el panel TH que no falte nadie. Luego apagar la Power App.

## Sesión de Microsoft en el kiosco

La app nunca muestra la pantalla de login a un operador. Si la sesión vence,
las marcaciones siguen guardándose en la tablet, el indicador inferior se
pone rojo ("Sesión vencida · N en espera") y alguien de TH/Sistemas entra al
panel y vuelve a iniciar sesión; ahí se envía todo lo pendiente.

## Empleados

Se leen de la lista **Empleados** existente (no se modifica). No puede marcar
quien tenga `_` al final del EmpleadoID o `Activo = NO`. Pendiente de
limpieza en esa lista: 24 vigentes con `Activo` vacío, 5 desvinculados con
`Activo = SI` (3003_, 1003_, 2006_, 1036_, 1037_), cédula 1724123748
repetida en 1014 y 2006_, "PRODUCCION" vs "PRODUCCIÓN".

## Desarrollo

```
python serve_dev.py 8793
```

`useMock: true` usa `data/empleados_demo.json` (no versionado: contiene
datos de personal). En el panel TH → Esta tablet → "Cargar marcaciones de
ejemplo" carga el export real del 01/10/2026 para probar el reporte.

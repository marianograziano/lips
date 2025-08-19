# Detección de ejercicios de labios (MediaPipe + WebAudio)

Frontend básico para correr en local o en GitHub Pages que:
- Detecta ejercicios orofaciales usando MediaPipe Face Mesh (labios/mandíbula).
- Muestra el estado en tiempo real con “pills”.
- Opcionalmente dibuja el contorno de labios.
- Permite grabar video (canvas con overlay) + audio (micrófono) en .webm.
- Genera un log .json con las detecciones por frame durante la grabación.

Ejercicios detectados:  
- Trompa Lateral (izquierda/derecha)
- Fruncir y Sonreír (secuencia fruncir → sonreír)
- Mantener Trompa (barra de progreso)
- Morder Labios (superior/inferior y alternando)
- Besos Ruidosos
- Sello de Sopapa
- Vibrar Labios

## Requisitos

- Navegador: Chrome, Edge o Firefox recientes (MediaRecorder y getUserMedia).
  - Safari: soporte limitado para `.webm`. Si falla, usar Chrome/Edge/Firefox.
- Permisos de cámara y micrófono.
- Servir los archivos desde un servidor (para local) o usar GitHub Pages (HTTPS).

## Estructura de archivos

```
.
├─ index.html      # Interfaz y carga de scripts de MediaPipe
├─ app.js          # Inicialización, render, UI, grabación y orquestación
├─ detectors.js    # Heurísticas y máquinas de estado de ejercicios
└─ mic.js          # Análisis de audio: transientes y modulación de amplitud
```

## Cómo ejecutarlo en GitHub Pages (sin descargar nada)

1) Crea un repo nuevo (público), por ejemplo: `lip-exercises-demo`.
2) Agrega los 4 archivos de este README (Add file > Create new file).
3) Ve a Settings > Pages > Build and deployment > Deploy from a branch:
   - Branch: `main`
   - Folder: `/ (root)`
4) Abre la URL que muestra Pages (HTTPS), concede permisos de cámara y micrófono.

## Grabación

- Pulsa “Grabar” y luego “Detener”. Se descargarán:
  - `ejercicios_YYYYMMDD_HHMMSS.webm` (video del canvas + audio del mic)
  - `ejercicios_YYYYMMDD_HHMMSS.json` (log de detecciones)

Ejemplo de entrada del log:
```json
{
  "t_ms": 1240,
  "state": {
    "trompaLateral": "left",
    "fruncirYSonreir": "pucker",
    "mantenerTrompa": 0.37,
    "morderLabios": "idle",
    "besosRuidosos": false,
    "selloSopapa": false,
    "vibrarLabios": false
  },
  "audio": {
    "rmsDb": -42.7,
    "transientDb": 12.3,
    "envelopeHz": 18.9
  }
}
```

## Personalización

Ajusta umbrales en `app.js` al crear `ExerciseDetectors`, o en `detectors.js` (valores por defecto):
- `puckerProtrusion`, `puckerNarrow`, `lateralShift`, `mouthClosed`, `mouthOpen`, `smileCornersUp`, `popTransientDb`, `trillMinHz`, `trillMaxHz`, `holdSeconds`.

## Notas

- Todo corre en el navegador; solo se descargan librerías de MediaPipe desde jsDelivr.
- Si no hay audio en la grabación, revisa permisos y que el micrófono esté activo.
- Safari puede no reproducir `.webm`.

¿Querés que te empuje estos archivos al repo cuando lo crees? Decime el nombre exacto del repo (por ejemplo, `marianograziano/lip-exercises-demo`) y lo hago.
import { ExerciseDetectors } from './detectors.js';
import { MicAnalyzer } from './mic.js';



// UI
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const showLipsChk = document.getElementById('showLips');
const statePill = document.getElementById('statePill');
const fpsPill = document.getElementById('fpsPill');

const recordBtn = document.getElementById('recordBtn');
const stopRecBtn = document.getElementById('stopRecBtn');
const recPill = document.getElementById('recPill');

const pTrompa = document.getElementById('p-trompa');
const pFruncir = document.getElementById('p-fruncir');
const pMantener = document.getElementById('p-mantener');
const pMorder = document.getElementById('p-morder');
const pBesos = document.getElementById('p-besos');
const pSopapa = document.getElementById('p-sopapa');
const pVibrar = document.getElementById('p-vibrar');

const videoEl = document.getElementById('inputVideo');
const canvasEl = document.getElementById('outputCanvas');
const ctx = canvasEl.getContext('2d');

// State
let camera = null;
let faceMesh = null;
let detectors = null;
let mic = null;

// FPS
let lastTS = performance.now();
let fpsEMA = null;
const FPS_ALPHA = 0.2;
function updateFPS() {
  const now = performance.now();
  const dt = (now - lastTS) / 1000;
  lastTS = now;
  const fps = 1 / Math.max(dt, 1e-6);
  fpsEMA = fpsEMA == null ? fps : FPS_ALPHA * fps + (1 - FPS_ALPHA) * fpsEMA;
  fpsPill.textContent = `fps: ${fpsEMA.toFixed(1)}`;
}

// MediaRecorder
let mediaRecorder = null;
let recordedChunks = [];
let recTimer = null;
let recStartMS = 0;
const detectionLog = [];

function isRecording() {
  return mediaRecorder && mediaRecorder.state === 'recording';
}

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  for (const mt of candidates) {
    if ('MediaRecorder' in window && MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return 'video/webm';
}

function getRecordStream() {
  const canvasStream = canvasEl.captureStream(30); // captura el render con overlay
  const mixed = new MediaStream();
  const vtrack = canvasStream.getVideoTracks()[0];
  if (vtrack) mixed.addTrack(vtrack);
  const atrack = mic?.stream?.getAudioTracks?.()[0];
  if (atrack) mixed.addTrack(atrack);
  return mixed;
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function setPill(el, text, ok = false, warn = false) {
  el.textContent = text;
  el.classList.remove('ok', 'warn');
  if (ok) el.classList.add('ok');
  if (warn) el.classList.add('warn');
}

function updateRecUI() {
  if (isRecording()) {
    const elapsed = Date.now() - recStartMS;
    setPill(recPill, `Grabando… ${fmtTime(elapsed)}`, true);
  } else {
    setPill(recPill, 'Grabación: inactiva');
  }
}

function startRecording() {
  const stream = getRecordStream();
  if (!stream) {
    alert('No se pudo crear el stream para grabar.');
    return;
  }
  recordedChunks = [];
  const mimeType = pickMimeType();
  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType });
  } catch (e) {
    console.error(e);
    alert('MediaRecorder no soportado en este navegador.');
    return;
  }
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    saveRecording();
    saveDetectionLog();
  };
  mediaRecorder.start(1000); // fragmentos de 1s
  recStartMS = Date.now();
  recTimer = setInterval(updateRecUI, 250);
  updateRecUI();
  recordBtn.disabled = true;
  stopRecBtn.disabled = false;
}

function stopRecording() {
  if (!isRecording()) return;
  mediaRecorder.stop();
  clearInterval(recTimer);
  recTimer = null;
  updateRecUI();
  recordBtn.disabled = false;
  stopRecBtn.disabled = true;
}

function saveRecording() {
  const type = mediaRecorder?.mimeType || 'video/webm';
  const blob = new Blob(recordedChunks, { type });
  const name = `ejercicios_${tsName(recStartMS)}.webm`;
  downloadBlob(blob, name);
}

function saveDetectionLog() {
  const blob = new Blob([JSON.stringify(detectionLog, null, 2)], { type: 'application/json' });
  const name = `ejercicios_${tsName(recStartMS)}.json`;
  downloadBlob(blob, name);
  detectionLog.length = 0; // limpiar
}

function tsName(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

// Init MediaPipe
async function initMediaPipe() {
  // Compat: algunas builds exponen FaceMesh como clase directa y otras como namespace.FaceMesh
  const FaceMeshCtor = window.FaceMesh?.FaceMesh || window.FaceMesh;
  if (!FaceMeshCtor) {
    throw new Error('MediaPipe FaceMesh no se cargó. Revisa las etiquetas <script> y la consola.');
  }
  faceMesh = new FaceMeshCtor({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  faceMesh.onResults(onResults);

  // Compat para Camera (algunas builds lo exponen en window.Camera)
  const CameraCtor = window.Camera || window.cameraUtils?.Camera || window.CameraUtils?.Camera;
  if (!CameraCtor) {
    throw new Error('MediaPipe CameraUtils no se cargó. Revisa la etiqueta camera_utils.js');
  }
  camera = new CameraCtor(videoEl, {
    onFrame: async () => { await faceMesh.send({ image: videoEl }); },
    width: 640,
    height: 480
  });

  await camera.start();
}

async function initDetectorsAndMic() {
  detectors = new ExerciseDetectors({
    puckerProtrusion: 0.006,
    puckerNarrow: 0.08,
    lateralShift: 0.07,
    holdSeconds: 3.0
  });
  mic = new MicAnalyzer();
  try {
    await mic.init();
  } catch (e) {
    console.warn('Micrófono no disponible, continúo sin audio:', e);
    mic = null;
  }
}

// Render + detection loop (called by MediaPipe)
function onResults(results) {
  updateFPS();

  canvasEl.width = videoEl.videoWidth || 640;
  canvasEl.height = videoEl.videoHeight || 480;

  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.drawImage(results.image, 0, 0, canvasEl.width, canvasEl.height);

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];

    // Dibujo opcional del contorno de labios
    if (showLipsChk.checked && window.drawConnectors && window.FACEMESH_LIPS) {
      const scaled = landmarks.map(pt => ({ x: pt.x * canvasEl.width, y: pt.y * canvasEl.height }));
      drawConnectors(ctx, scaled, FACEMESH_LIPS, { color: '#4fd1c5', lineWidth: 2 });
    }

    // Mic audio features (si está listo)
    const audioFeat = mic ? mic.sample() : null;

    // Detectores
    if (detectors) {
      const exState = detectors.update(landmarks, audioFeat, performance.now() / 1000);
      renderExerciseState(exState);

      // Log de detecciones durante la grabación
      if (isRecording()) {
        detectionLog.push({
          t_ms: Date.now() - recStartMS,
          state: exState,
          audio: audioFeat
        });
      }
    }
  }

  ctx.restore();
}

function renderExerciseState(s) {
  // Trompa lateral
  const tl = s.trompaLateral;
  setPill(pTrompa, `Trompa Lateral: ${tl === 'none' ? '—' : (tl === 'left' ? 'izquierda' : 'derecha')}`, tl !== 'none');

  // Fruncir y Sonreír
  let ftxt = '—';
  if (s.fruncirYSonreir === 'pucker') ftxt = 'fruncir';
  else if (s.fruncirYSonreir === 'smile') ftxt = 'sonreír';
  else if (s.fruncirYSonreir === 'done') ftxt = 'completado ✔';
  setPill(pFruncir, `Fruncir y Sonreír: ${ftxt}`, s.fruncirYSonreir === 'done');

  // Mantener Trompa
  const pct = Math.round(s.mantenerTrompa * 100);
  setPill(pMantener, `Mantener Trompa: ${pct}%`, pct >= 100);

  // Morder Labios
  let mtxt = '—';
  if (s.morderLabios === 'upper') mtxt = 'morder labio superior';
  else if (s.morderLabios === 'lower') mtxt = 'morder labio inferior';
  else if (s.morderLabios === 'alternating') mtxt = 'alternando ✔';
  setPill(pMorder, `Morder Labios: ${mtxt}`, s.morderLabios === 'alternating');

  // Besos ruidosos
  setPill(pBesos, `Besos Ruidosos: ${s.besosRuidosos ? 'sí ✔' : 'no'}`, s.besosRuidosos);

  // Sello de Sopapa
  setPill(pSopapa, `Sello de Sopapa: ${s.selloSopapa ? 'sí ✔' : 'no'}`, s.selloSopapa);

  // Vibrar labios
  setPill(pVibrar, `Vibrar Labios: ${s.vibrarLabios ? 'sí ✔' : 'no'}`, s.vibrarLabios);
}

// Button handlers
startBtn.addEventListener('click', async () => {
  try {
    startBtn.disabled = true;
    statePill.textContent = 'Estado: inicializando…';
    await initMediaPipe();
    await initDetectorsAndMic();
    resetBtn.disabled = false;
    recordBtn.disabled = false;
    statePill.textContent = 'Estado: listo';
  } catch (err) {
    console.error(err);
    statePill.textContent = 'Estado: error (ver consola)';
    alert('Error al iniciar cámara/micrófono. Concede permisos y usa HTTPS o localhost.');
    startBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', async () => {
  detectors = new ExerciseDetectors(); // reset rápido
  renderExerciseState({
    trompaLateral: 'none',
    fruncirYSonreir: 'idle',
    mantenerTrompa: 0,
    morderLabios: 'idle',
    besosRuidosos: false,
    selloSopapa: false,
    vibrarLabios: false
  });
});
recordBtn.addEventListener('click', startRecording);
stopRecBtn.addEventListener('click', stopRecording);
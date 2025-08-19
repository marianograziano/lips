// Utilidades geométricas y detectores de ejercicios con MediaPipe FaceMesh (468 landmarks)
// Índices clave (MediaPipe):
// - 13 (upper inner lip mid), 14 (lower inner lip mid)
// - 61 (left mouth corner), 291 (right mouth corner)
// - 1 (nariz/tabique), 152 (mentón)
// Nota: los valores z de FaceMesh son relativos; usamos diferencias relativas.

function hypot2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.hypot(dx, dy);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function computeLipFeatures(landmarks) {
  const L_UP = 13, L_LO = 14, L_L = 61, L_R = 291, NOSE = 1, CHIN = 152;

  const pU = landmarks[L_UP];
  const pL = landmarks[L_LO];
  const pLft = landmarks[L_L];
  const pRgt = landmarks[L_R];
  const pN = landmarks[NOSE];
  const pC = landmarks[CHIN];

  if (!pU || !pL || !pLft || !pRgt || !pN || !pC) return null;

  const mouthW = hypot2(pLft.x, pLft.y, pRgt.x, pRgt.y) + 1e-6;
  const mouthH = Math.hypot(pU.x - pL.x, pU.y - pL.y);
  const ratioVH = mouthH / mouthW;

  // Centro de boca e índice lateral relativo al tabique de la nariz
  const mouthCx = (pLft.x + pRgt.x) / 2;
  const lateral = (mouthCx - pN.x) / mouthW; // >0 derecha, <0 izquierda

  // Protrusión: labios vs nariz (z), mayor => hacia cámara
  const lipsZ = (pU.z + pL.z + pLft.z + pRgt.z) / 4;
  const protrusion = pN.z - lipsZ;

  // Elevación de comisuras: y menor es más arriba
  const cornersY = (pLft.y + pRgt.y) / 2;
  const cornersUp = (pN.y - cornersY) / (mouthW + 1e-6);

  // Mandíbula estable: distancia nariz-mentón
  const noseChin = hypot2(pN.x, pN.y, pC.x, pC.y);

  // Orden relativo labio sup/inf (para mordidas)
  const lipOrder = (pU.y - pL.y) / (mouthH + 1e-6);

  return {
    mouthW, mouthH, ratioVH, lateral, protrusion, cornersUp,
    noseChin, lipOrder,
    points: { pU, pL, pLft, pRgt, pN, pC }
  };
}

// Filtros temporales simples
export class EMA {
  constructor(alpha, v0 = null) { this.a = alpha; this.v = v0; }
  update(x) { this.v = this.v == null ? x : this.a * x + (1 - this.a) * this.v; return this.v; }
  value() { return this.v; }
}

export class Derivative {
  constructor() { this.prev = null; this.prevT = null; }
  update(x, t) {
    const dt = this.prevT == null ? 0 : Math.max(1e-6, t - this.prevT);
    const dx = this.prev == null ? 0 : (x - this.prev) / dt;
    this.prev = x; this.prevT = t;
    return dx;
  }
}

// Máquinas de estado por ejercicio
export class ExerciseDetectors {
  constructor(opts = {}) {
    this.opts = {
      // Umbrales empíricos (ajusta con tu cámara/iluminación)
      puckerProtrusion: 0.008,   // protrusión mínima para “trompa”
      puckerNarrow: 0.075,       // ratioVH máximo para trompa (boca angosta)
      smileCornersUp: 0.12,      // comisuras arriba relativo a nariz
      mouthClosed: 0.035,        // altura mínima para considerar labios “cerrados”
      mouthOpen: 0.06,           // altura para “abierto moderado”
      lateralShift: 0.08,        // desplazamiento lateral relativo al ancho
      jawStableFrac: 0.04,       // variación tolerada nariz-mentón (fracción)
      popTransientDb: 9.0,       // pico de audio sobre RMS
      trillMinHz: 12,            // vibración de labios (envolvente) mínima
      trillMaxHz: 35,            // vibración de labios (envolvente) máxima
      holdSeconds: 3.0,          // mantener trompa
      ...opts
    };

    // Filtros
    this.emaRatio = new EMA(0.4);
    this.emaProtrusion = new EMA(0.4);
    this.emaLateral = new EMA(0.4);
    this.emaNoseChin = new EMA(0.2);
    this.dMouthH = new Derivative();

    // Estados
    this.last = {
      time: performance.now() / 1000,
      noseChin0: null,
      puckerStart: null,
      closedStart: null,
      holdStart: null,
      lastSide: null,
      lastBiteSign: 0,
      lastPuckerTime: 0,
    };

    this.state = {
      trompaLateral: 'none',            // 'left' | 'right' | 'none'
      fruncirYSonreir: 'idle',          // 'pucker' | 'smile' | 'done'
      mantenerTrompa: 0,                // progreso [0..1]
      morderLabios: 'idle',             // 'upper' | 'lower' | 'idle' | 'alternating'
      besosRuidosos: false,
      selloSopapa: false,
      vibrarLabios: false,
    };

    this.seq = { phase: 'idle', tPucker: 0, tSmile: 0 }; // pucker -> smile
    this.altBite = { lastType: null, count: 0, lastTime: 0 }; // alternancia
  }

  update(landmarks, audio, nowSec = performance.now() / 1000) {
    const f = computeLipFeatures(landmarks);
    if (!f) return this.state;

    const { puckerProtrusion, puckerNarrow, smileCornersUp, mouthClosed, mouthOpen,
            lateralShift, jawStableFrac, popTransientDb, trillMinHz, trillMaxHz, holdSeconds } = this.opts;

    // Suavizados
    const ratioVH = this.emaRatio.update(f.ratioVH);
    const protrusion = this.emaProtrusion.update(f.protrusion);
    const lateral = this.emaLateral.update(f.lateral);
    const noseChin = this.emaNoseChin.update(f.noseChin);

    // Estabilidad de mandíbula
    if (this.last.noseChin0 == null) this.last.noseChin0 = noseChin;
    const jawStable = Math.abs(noseChin - this.last.noseChin0) <= jawStableFrac * this.last.noseChin0;

    // Derivada de apertura
    const dH = this.dMouthH.update(f.mouthH, nowSec);

    // Señales base
    const isPucker = protrusion > puckerProtrusion && ratioVH < puckerNarrow;
    const isSmile = ratioVH < (mouthClosed * 0.8) && f.cornersUp > smileCornersUp && (f.mouthW > 0.4);
    const isClosed = ratioVH < mouthClosed;
    const isOpen = ratioVH > mouthOpen;

    // 1) Trompa lateral
    let side = 'none';
    if (isPucker && jawStable) {
      if (lateral > lateralShift) side = 'right';
      else if (lateral < -lateralShift) side = 'left';
    }
    this.state.trompaLateral = side;

    // 2) Fruncir y Sonreír (FSM)
    if (this.seq.phase === 'idle') {
      if (isPucker) { this.seq.phase = 'pucker'; this.seq.tPucker = nowSec; }
    } else if (this.seq.phase === 'pucker') {
      if (isSmile || (f.cornersUp > smileCornersUp && isOpen)) {
        this.seq.phase = 'smile'; this.seq.tSmile = nowSec;
      }
    } else if (this.seq.phase === 'smile') {
      if (nowSec - this.seq.tSmile > 0.4) {
        this.state.fruncirYSonreir = 'done';
        this.seq.phase = 'idle';
      }
    }
    if (this.seq.phase === 'idle') this.state.fruncirYSonreir = 'idle';
    else if (this.seq.phase === 'pucker') this.state.fruncirYSonreir = 'pucker';
    else if (this.seq.phase === 'smile') this.state.fruncirYSonreir = 'smile';

    // 3) Mantener Trompa
    if (isPucker) {
      if (this.last.holdStart == null) this.last.holdStart = nowSec;
      const held = nowSec - this.last.holdStart;
      this.state.mantenerTrompa = clamp(held / holdSeconds, 0, 1);
    } else {
      this.last.holdStart = null;
      this.state.mantenerTrompa = 0;
    }

    // 4) Morder Labios alternando
    const biteSign = Math.sign(f.lipOrder); // >0 normal; <0 inversión
    let biteType = 'idle';
    if (isClosed && Math.abs(f.lipOrder) < 0.1) {
      biteType = (this.last.lastBiteSign >= 0 && biteSign < 0) ? 'upper' :
                 (this.last.lastBiteSign <= 0 && biteSign > 0) ? 'lower' : 'idle';
    }
    if (biteType !== 'idle' && nowSec - this.altBite.lastTime > 0.25) {
      if (this.altBite.lastType && this.altBite.lastType !== biteType) this.altBite.count++;
      this.altBite.lastType = biteType;
      this.altBite.lastTime = nowSec;
    }
    this.state.morderLabios = (this.altBite.count >= 1) ? 'alternating' : (biteType !== 'idle' ? biteType : 'idle');
    this.last.lastBiteSign = biteSign;

    // 5) Besos Ruidosos
    let kiss = false;
    if (isPucker) this.last.lastPuckerTime = nowSec;
    if (audio && audio.transientDb != null) {
      if ((nowSec - this.last.lastPuckerTime) < 0.6 && audio.transientDb > popTransientDb) kiss = true;
    }
    this.state.besosRuidosos = kiss;

    // 6) Sello de Sopapa
    if (isClosed) {
      if (this.last.closedStart == null) this.last.closedStart = nowSec;
    } else {
      const wasClosed = this.last.closedStart != null && (nowSec - this.last.closedStart) > 0.25;
      const suddenOpen = dH > 0.6; // apertura rápida (ajustar según FPS)
      const pop = audio && audio.transientDb > popTransientDb;
      this.state.selloSopapa = wasClosed && suddenOpen && !!pop;
      this.last.closedStart = null;
    }

    // 7) Vibrar Labios (audio)
    if (audio && audio.envelopeHz) {
      this.state.vibrarLabios = audio.envelopeHz > trillMinHz && audio.envelopeHz < trillMaxHz && audio.rmsDb > -45;
    } else {
      this.state.vibrarLabios = false;
    }

    this.last.time = nowSec;
    return this.state;
  }
}
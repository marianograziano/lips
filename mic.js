// Análisis de micrófono para detectar transientes ("pop") y vibración de labios (trill) por modulación de amplitud.
// Devuelve por frame: { rmsDb, transientDb, envelopeHz }


// Expone this.stream (MediaStream) para mezclar en la grabación.

export class MicAnalyzer {
  constructor({ fftSize = 2048, smoothing = 0.5 } = {}) {
    this.ctx = null;
    this.an = null;
    this.src = null;
    this.stream = null; // <— expuesto para grabación
    this.last = { emaFast: null, emaSlow: null, wasHigh: false, peaks: [] };
    this.tmp = { floatBuf: null };
    this.config = { fftSize, smoothing };
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    });
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = this.config.fftSize;
    this.an.smoothingTimeConstant = this.config.smoothing;
    this.src.connect(this.an);
    return this;
  }

  // Llamar por frame (~30-60 Hz)
  sample(nowSec = performance.now() / 1000) {
    if (!this.an) return null;
    const N = this.an.fftSize;
    if (!this.tmp.floatBuf || this.tmp.floatBuf.length !== N) this.tmp.floatBuf = new Float32Array(N);
    this.an.getFloatTimeDomainData(this.tmp.floatBuf);

    // RMS
    let sum = 0;
    for (let i = 0; i < N; i++) { const v = this.tmp.floatBuf[i]; sum += v * v; }
    const rms = Math.sqrt(sum / N);
    const rmsDb = 20 * Math.log10(rms + 1e-8);

    // Envolvente rápida vs lenta
    const aFast = 0.4, aSlow = 0.05;
    this.last.emaFast = this.last.emaFast == null ? rms : aFast * rms + (1 - aFast) * this.last.emaFast;
    this.last.emaSlow = this.last.emaSlow == null ? rms : aSlow * rms + (1 - aSlow) * this.last.emaSlow;

    const transient = Math.max(0, this.last.emaFast - this.last.emaSlow);
    const transientDb = 20 * Math.log10(transient + 1e-8) - 20 * Math.log10(this.last.emaSlow + 1e-8);

    // Frecuencia de modulación (conteo de picos en envolvente)
    const env = this.last.emaFast;
    const threshHi = this.last.emaSlow * 1.15;
    const threshLo = this.last.emaSlow * 1.02;
    let envelopeHz = null;

    const t = nowSec;
    const wasHigh = this.last.wasHigh || false;
    const isHigh = env > threshHi ? true : (env < threshLo ? false : wasHigh);
    if (!wasHigh && isHigh) {
      this.last.peaks.push(t);
      while (this.last.peaks.length > 0 && (t - this.last.peaks[0]) > 2.0) this.last.peaks.shift();
      if (this.last.peaks.length >= 2) {
        const periods = [];
        for (let i = 1; i < this.last.peaks.length; i++) periods.push(this.last.peaks[i] - this.last.peaks[i - 1]);
        const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
        envelopeHz = 1 / Math.max(1e-6, avgPeriod);
      }
    }
    this.last.wasHigh = isHigh;

    return { rmsDb, transientDb, envelopeHz };
  }
}
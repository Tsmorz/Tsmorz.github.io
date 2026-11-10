// Speech to text for the tag tracker's notes and voice commands: Whisper tiny.en through Transformers.js, in a module
// Worker so the model never blocks the page. WebGPU where the browser has it, WebAssembly otherwise.
// Audio never leaves the computer. The only traffic is the library (pinned; jsDelivr, then unpkg) and the model
// weights (Hugging Face Hub), downloaded on first use and served from the browser's cache after that.
//
// In:  { type: 'load' }                          start loading (the first 'transcribe' does too)
//      { type: 'transcribe', id, audio }         audio: Float32Array, mono, 16 kHz
// Out: { type: 'progress', value }               download, 0..100
//      { type: 'ready', device }                 'webgpu' or 'wasm'
//      { type: 'error', message }                the model could not load
//      { type: 'result', id, text } or { type: 'result', id, error }
const LIB = '@huggingface/transformers@4.3.2';
const MODEL = 'Xenova/whisper-tiny.en';
const SAMPLE_RATE = 16000;

let ready = null, asr = null;

const progress = (p) => {
  if (p.status === 'progress_total') self.postMessage({ type: 'progress', value: p.progress });
  else if (p.status === 'progress' && p.total) self.postMessage({ type: 'progress', value: p.progress, file: p.file });
};

async function load() {
  const { pipeline, env } = await import(`https://cdn.jsdelivr.net/npm/${LIB}`).catch(() => import(`https://unpkg.com/${LIB}`));
  env.allowLocalModels = false; // a static site has no local model files
  const hasGpu = 'gpu' in navigator && !!(await navigator.gpu.requestAdapter().catch(() => null));
  const tries = hasGpu
    ? [{ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } }, { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  let lastError;
  for (const opts of tries) {
    try {
      asr = await pipeline('automatic-speech-recognition', MODEL, { ...opts, progress_callback: progress });
      await asr(new Float32Array(SAMPLE_RATE)); // warm up, so the first real clip doesn't pay for compiling kernels
      return opts.device;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function start() {
  if (!ready) {
    ready = load().then(
      (device) => { self.postMessage({ type: 'ready', device }); },
      (e) => { self.postMessage({ type: 'error', message: String((e && e.message) || e) }); throw e; },
    );
    ready.catch(() => {});
  }
  return ready;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') { start(); return; }
  if (data.type !== 'transcribe') return;
  try {
    await start();
    const out = await asr(data.audio, { chunk_length_s: 30, stride_length_s: 5 });
    self.postMessage({ type: 'result', id: data.id, text: (out && out.text) || '' });
  } catch (e) {
    self.postMessage({ type: 'result', id: data.id, error: String((e && e.message) || e) });
  }
};

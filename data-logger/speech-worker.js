// Speech to text for the board's microphone (speech-view.js): Whisper tiny.en through
// Transformers.js, in a module Worker so the model never blocks the page. WebGPU where the browser
// has it, WebAssembly otherwise. The audio never leaves this computer. The only traffic is the
// library (pinned; jsDelivr, then unpkg) and the model weights (Hugging Face Hub), downloaded on
// first use and served from the browser's cache after that. The same worker as the tag tracker's
// (personal-site tag-tracker/speech-worker.js).
//
// In:  { type: "load" }                          start loading (the first "transcribe" does too)
//      { type: "transcribe", id, audio }         audio: Float32Array, mono, 16 kHz
// Out: { type: "progress", value }               download, 0..100
//      { type: "ready", device }                 "webgpu" or "wasm"
//      { type: "error", message }                the model could not load
//      { type: "result", id, text } or { type: "result", id, error }
const LIB = "@huggingface/transformers@4.3.2";
const MODEL = "Xenova/whisper-tiny.en";
const SAMPLE_RATE = 16000;

let ready = null;
let asr = null;

const progress = (p) => {
  if (p.status === "progress_total") self.postMessage({ type: "progress", value: p.progress });
  else if (p.status === "progress" && p.total) self.postMessage({ type: "progress", value: p.progress, file: p.file });
};

async function load() {
  const { pipeline, env } = await import(`https://cdn.jsdelivr.net/npm/${LIB}`).catch(() => import(`https://unpkg.com/${LIB}`));
  env.allowLocalModels = false; // a static page has no local model files
  const hasGpu = "gpu" in navigator && Boolean(await navigator.gpu.requestAdapter().catch(() => null));
  const tries = hasGpu
    ? [{ device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } }, { device: "wasm", dtype: "q8" }]
    : [{ device: "wasm", dtype: "q8" }];
  let lastError;
  for (const options of tries) {
    try {
      asr = await pipeline("automatic-speech-recognition", MODEL, { ...options, progress_callback: progress });
      await asr(new Float32Array(SAMPLE_RATE)); // warm up, so the first real take doesn't pay for compiling kernels
      return options.device;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function start() {
  if (!ready) {
    ready = load().then(
      (device) => self.postMessage({ type: "ready", device }),
      (error) => {
        self.postMessage({ type: "error", message: String(error?.message ?? error) });
        throw error;
      },
    );
    ready.catch(() => {});
  }
  return ready;
}

self.onmessage = async ({ data }) => {
  if (data.type === "load") return void start();
  if (data.type !== "transcribe") return;
  try {
    await start();
    const out = await asr(data.audio, { chunk_length_s: 30, stride_length_s: 5 });
    self.postMessage({ type: "result", id: data.id, text: out?.text ?? "" });
  } catch (error) {
    self.postMessage({ type: "result", id: data.id, error: String(error?.message ?? error) });
  }
};

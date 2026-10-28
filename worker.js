// Reconhecimento de voz (Whisper) a correr DENTRO do telemóvel.
// O áudio chega aqui em memória, é transcrito e descartado. Nada é enviado para fora.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true; // o modelo fica guardado no telemóvel após o 1.º download

let asr = null;
let chaveAtual = null;
let motorAtual = null;

async function suportaWebGPU() {
  try {
    if (!navigator.gpu) return null;
    const adaptador = await navigator.gpu.requestAdapter();
    if (!adaptador) return null;
    return { fp16: adaptador.features.has('shader-f16') };
  } catch { return null; }
}

function progresso(p) {
  if (p.status === 'progress' && p.total) {
    self.postMessage({ type: 'progresso', ficheiro: p.file, carregado: p.loaded, total: p.total });
  }
}

async function carregar(modelo, motor) {
  const chave = modelo + '|' + motor;
  if (asr && chave === chaveAtual) { self.postMessage({ type: 'pronto', motor: motorAtual }); return; }
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }

  const id = 'onnx-community/whisper-' + modelo;
  let gpu = motor === 'cpu' ? null : await suportaWebGPU();

  if (gpu) {
    try {
      asr = await pipeline('automatic-speech-recognition', id, {
        device: 'webgpu',
        dtype: { encoder_model: gpu.fp16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' },
        progress_callback: progresso,
      });
      motorAtual = 'GPU';
    } catch (e) {
      asr = null; // falhou a GPU: tenta CPU
    }
  }
  if (!asr) {
    asr = await pipeline('automatic-speech-recognition', id, {
      device: 'wasm',
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback: progresso,
    });
    motorAtual = 'CPU';
  }
  chaveAtual = chave;
  self.postMessage({ type: 'pronto', motor: motorAtual });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'carregar') {
      await carregar(m.modelo, m.motor);
    } else if (m.type === 'transcrever') {
      if (!asr) throw new Error('Modelo de voz ainda não carregado.');
      const t0 = performance.now();
      const saida = await asr(m.audio, {
        language: m.lingua,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      m.audio = null;
      self.postMessage({ type: 'texto', id: m.id, texto: (saida.text || '').trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    self.postMessage({ type: 'erro', id: m.id, mensagem: String(err && err.message || err) });
  }
};

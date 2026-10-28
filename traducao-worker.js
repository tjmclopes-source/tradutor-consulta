// Tradução DENTRO do aparelho (modelo NLLB-200). Nada é enviado para fora.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

let tradutor = null;

function progresso(p) {
  if (p.status === 'progress' && p.total) {
    self.postMessage({ type: 'progresso', ficheiro: p.file, carregado: p.loaded, total: p.total });
  }
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'carregar') {
      if (!tradutor) {
        tradutor = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
          device: 'wasm', dtype: 'q8', progress_callback: progresso,
        });
      }
      self.postMessage({ type: 'pronto' });
    } else if (m.type === 'traduzir') {
      if (!tradutor) throw new Error('Modelo de tradução ainda não carregado.');
      // Frase a frase: o modelo tende a saltar a 2.ª frase quando recebe várias juntas
      const frases = m.texto.split(/(?<=[.!?。！？۔।])\s*/).map((f) => f.trim()).filter(Boolean);
      const partes = [];
      for (const f of frases) {
        const saida = await tradutor(f, { src_lang: m.de, tgt_lang: m.para, max_new_tokens: 200 });
        partes.push(saida[0].translation_text);
      }
      self.postMessage({ type: 'texto', id: m.id, texto: partes.join(' ') });
    }
  } catch (err) {
    self.postMessage({ type: 'erro', id: m.id, mensagem: String(err && err.message || err) });
  }
};

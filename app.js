'use strict';

// ---- Línguas ----
const PT = { whisper: 'portuguese', de: 'pt', para: 'pt-pt', nllb: 'por_Latn' };
const LINGUAS = {
  it: { nome: 'Italiano', whisper: 'italian', azure: 'it', nllb: 'ita_Latn', falar: 'Parli' },
  fr: { nome: 'Français', whisper: 'french', azure: 'fr', nllb: 'fra_Latn', falar: 'Parlez' },
  ru: { nome: 'Русский', whisper: 'russian', azure: 'ru', nllb: 'rus_Cyrl', falar: 'Говорите' },
  ur: { nome: 'اردو (Urdu)', whisper: 'urdu', azure: 'ur', nllb: 'urd_Arab', falar: 'بولیں', rtl: true },
  // Reconhecimento de voz fraco nestas duas: sugerir que o utente escreva
  ne: { nome: 'नेपाली (Nepali)', whisper: 'nepali', azure: 'ne', nllb: 'npi_Deva', falar: 'बोल्नुहोस्', vozFraca: true, escreva: 'यहाँ लेख्नुहोस्…' },
  bn: { nome: 'বাংলা (Bengali)', whisper: 'bengali', azure: 'bn', nllb: 'ben_Beng', falar: 'কথা বলুন', vozFraca: true, escreva: 'এখানে লিখুন…' },
  // O Whisper às vezes escreve em caracteres tradicionais: deteção automática na entrada
  zh: { nome: '中文 (Mandarim)', whisper: 'chinese', azure: 'zh-Hans', nllb: 'zho_Hans', azureDe: '', falar: '请说话' },
};

// ---- Definições (só neste telemóvel) ----
function lerCfg(k, def) { try { return localStorage.getItem(k) ?? def; } catch { return def; } }
function gravarCfg(k, v) { try { localStorage.setItem(k, v); } catch {} }
const cfg = {
  get chave() { return lerCfg('azureChave', ''); },
  get regiao() { return lerCfg('azureRegiao', 'westeurope'); },
  get modelo() { return lerCfg('modelo', 'small'); },
  get motor() { return lerCfg('motor', 'auto'); },
  get lingua() { return lerCfg('lingua', 'fr'); },
  get tradutor() { return lerCfg('tradutor', 'local'); }, // 'local' (no aparelho) ou 'azure'
};

let modeloPronto = false;
let tradLocalPronto = false;
const $ = (id) => document.getElementById(id);
const el = {
  lingua: $('lingua'), estado: $('estado'), barra: $('barra'), conversa: $('conversa'), vazio: $('vazio'),
  btnMedico: $('btnMedico'), btnUtente: $('btnUtente'), acaoUtente: $('acaoUtente'),
  txt: $('txt'), txtMedico: $('txtMedico'), txtUtente: $('txtUtente'),
  ei: $('ecraInteiro'), eiTexto: $('eiTexto'),
};

function estado(msg, erro = false) {
  el.estado.textContent = msg;
  el.estado.classList.toggle('erro', erro);
}

// ---- Seletor de língua ----
for (const [cod, l] of Object.entries(LINGUAS)) {
  const o = document.createElement('option');
  o.value = cod; o.textContent = l.nome;
  el.lingua.appendChild(o);
}
el.lingua.value = cfg.lingua;
function atualizarLingua() {
  gravarCfg('lingua', el.lingua.value);
  const l = LINGUAS[el.lingua.value];
  el.acaoUtente.textContent = l.falar;
  el.txt.placeholder = l.escreva ? `Ou escreva aqui… / ${l.escreva}` : 'Ou escreva aqui…';
  if (l.vozFraca) estado(`Atenção: em ${l.nome} o reconhecimento de voz é pouco fiável. Se possível, peça ao utente para escrever na caixa abaixo e toque em →PT.`, true);
  else if (modeloPronto) estado('Pronto.');
}
el.lingua.addEventListener('change', atualizarLingua);
atualizarLingua();

// ---- Reconhecimento de voz (worker local) ----
const worker = new Worker('worker.js', { type: 'module' });
let proxId = 1;
const pendentes = new Map();
const progressoFicheiros = {};

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progresso') {
    progressoFicheiros[m.ficheiro] = [m.carregado, m.total];
    let c = 0, t = 0;
    for (const [a, b] of Object.values(progressoFicheiros)) { c += a; t += b; }
    el.barra.hidden = false;
    el.barra.firstElementChild.style.width = (100 * c / t).toFixed(0) + '%';
    estado(`A carregar o modelo de voz (o 1.º download demora; depois fica no telemóvel): ${(c / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`);
  } else if (m.type === 'pronto') {
    modeloPronto = true;
    el.barra.hidden = true;
    el.btnMedico.disabled = false;
    el.btnUtente.disabled = false;
    if (cfg.tradutor === 'local' && !tradLocalPronto) carregarTradutorLocal();
    else mensagemPronto();
  } else if (m.type === 'texto' || m.type === 'erro') {
    const p = pendentes.get(m.id);
    if (!p) {
      if (m.type === 'erro') estado('Erro no modelo de voz: ' + m.mensagem, true);
      return;
    }
    pendentes.delete(m.id);
    m.type === 'texto' ? p.ok(m) : p.falha(new Error(m.mensagem));
  }
};

function carregarModelo() {
  modeloPronto = false;
  el.btnMedico.disabled = true;
  el.btnUtente.disabled = true;
  for (const k in progressoFicheiros) delete progressoFicheiros[k];
  estado('A carregar o modelo de voz…');
  worker.postMessage({ type: 'carregar', modelo: cfg.modelo, motor: cfg.motor });
}

function transcrever(audio, lingua) {
  return new Promise((ok, falha) => {
    const id = proxId++;
    pendentes.set(id, { ok, falha });
    worker.postMessage({ type: 'transcrever', id, audio, lingua }, [audio.buffer]);
  });
}

function mensagemPronto() {
  if (cfg.tradutor === 'azure' && !cfg.chave) estado('Pronto. Falta a chave do Azure — toque em ⚙️.', true);
  else atualizarLingua();
}

// ---- Tradução no aparelho (worker local, NLLB) ----
let trabTrad = null;
const progressoTrad = {};
function carregarTradutorLocal() {
  if (!trabTrad) {
    trabTrad = new Worker('traducao-worker.js', { type: 'module' });
    trabTrad.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progresso') {
        progressoTrad[m.ficheiro] = [m.carregado, m.total];
        let c = 0, t = 0;
        for (const [a, b] of Object.values(progressoTrad)) { c += a; t += b; }
        el.barra.hidden = false;
        el.barra.firstElementChild.style.width = (100 * c / t).toFixed(0) + '%';
        estado(`A carregar o modelo de tradução (só da 1.ª vez demora): ${(c / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`);
      } else if (m.type === 'pronto') {
        tradLocalPronto = true;
        el.barra.hidden = true;
        mensagemPronto();
      } else {
        const p = pendentes.get(m.id);
        if (!p) { if (m.type === 'erro') estado('Erro no modelo de tradução: ' + m.mensagem, true); return; }
        pendentes.delete(m.id);
        m.type === 'texto' ? p.ok(m.texto) : p.falha(new Error(m.mensagem));
      }
    };
  }
  estado('A carregar o modelo de tradução…');
  trabTrad.postMessage({ type: 'carregar' });
}

function traduzirLocal(texto, de, para) {
  if (!tradLocalPronto) return Promise.reject(new Error('O modelo de tradução ainda está a carregar. Aguarde.'));
  return new Promise((ok, falha) => {
    const id = proxId++;
    pendentes.set(id, { ok, falha });
    trabTrad.postMessage({ type: 'traduzir', id, texto, de, para });
  });
}

// ---- Gravação: só em memória, microfone desligado no fim ----
let gravador = null;
let quemGrava = null;

async function iniciarGravacao(quem) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const pedacos = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
  rec.start();
  gravador = { rec, stream, pedacos };
  quemGrava = quem;
}

function pararGravacao() {
  return new Promise((ok) => {
    const g = gravador;
    gravador = null;
    g.rec.onstop = () => {
      g.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(g.pedacos, { type: g.rec.mimeType });
      g.pedacos.length = 0;
      ok(blob);
    };
    g.rec.stop();
  });
}

async function paraAmostras16k(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(buf);
    return audio.getChannelData(0).slice();
  } finally {
    ctx.close();
  }
}

function silencioso(a) {
  if (a.length < 16000 * 0.4) return true;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length) < 0.004;
}

// Frases que o Whisper "inventa" em silêncio ou ruído
const ALUCINACOES = /amara\.org|legendas|subt[ií]tulos|obrigad[oa] por (assistir|ver)|sous-titr|продолжение следует|субтитр/i;

async function botaoFalar(quem) {
  const btn = quem === 'medico' ? el.btnMedico : el.btnUtente;
  const outro = quem === 'medico' ? el.btnUtente : el.btnMedico;

  if (!gravador) {
    try {
      await iniciarGravacao(quem);
    } catch (e) {
      estado('Sem acesso ao microfone. Autorize o microfone nas definições do Chrome.', true);
      return;
    }
    btn.classList.add('gravar');
    btn.querySelector('.acao').dataset.antes = btn.querySelector('.acao').textContent;
    btn.querySelector('.acao').textContent = '■ Parar';
    outro.disabled = true;
    estado('A ouvir…');
    return;
  }
  if (quemGrava !== quem) return;

  const blob = await pararGravacao();
  btn.classList.remove('gravar');
  btn.querySelector('.acao').textContent = btn.querySelector('.acao').dataset.antes;
  outro.disabled = false;

  const lingua = LINGUAS[el.lingua.value];
  const cartao = novoCartao(quem, lingua);
  try {
    estado('A reconhecer a voz…');
    const amostras = await paraAmostras16k(blob);
    if (silencioso(amostras)) { cartao.remove(); estado('Não se ouviu nada. Tente outra vez, mais perto do telemóvel.'); return; }
    const r = await transcrever(amostras, quem === 'medico' ? PT.whisper : lingua.whisper);
    if (!r.texto || ALUCINACOES.test(r.texto)) { cartao.remove(); estado('Não percebi. Tente outra vez.'); return; }
    await preencherCartao(cartao, quem, lingua, r.texto, r.ms);
  } catch (e) {
    erroCartao(cartao, e);
  }
}

el.btnMedico.addEventListener('click', () => botaoFalar('medico'));
el.btnUtente.addEventListener('click', () => botaoFalar('utente'));

// ---- Tradução (Azure Translator: só texto) ----
async function traduzir(texto, de, para) {
  if (!cfg.chave) throw new Error('Falta a chave do Azure Translator (⚙️).');
  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0${de ? '&from=' + de : ''}&to=${para}`;
  const cab = { 'Ocp-Apim-Subscription-Key': cfg.chave, 'Content-Type': 'application/json' };
  if (cfg.regiao) cab['Ocp-Apim-Subscription-Region'] = cfg.regiao;
  const r = await fetch(url, { method: 'POST', headers: cab, body: JSON.stringify([{ Text: texto }]), referrerPolicy: 'no-referrer' });
  if (!r.ok) {
    let det = '';
    try { det = (await r.json()).error.message; } catch {}
    if (r.status === 401) throw new Error('Chave ou região do Azure inválida (⚙️). ' + det);
    throw new Error(`Tradutor respondeu ${r.status}. ${det}`);
  }
  return (await r.json())[0].translations[0].text;
}

// ---- Cartões da conversa (só em memória) ----
function novoCartao(quem, lingua) {
  el.vazio.hidden = true;
  const c = document.createElement('div');
  c.className = 'cartao a-processar ' + quem;
  c.innerHTML = '<div class="cab"><span class="quem"></span><span class="tempo"></span></div><div class="original"></div><div class="traducao">…</div>';
  c.querySelector('.quem').textContent = quem === 'medico' ? `Médico → ${lingua.nome}` : `Utente (${lingua.nome}) → Português`;
  el.conversa.appendChild(c);
  c.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return c;
}

async function preencherCartao(c, quem, lingua, texto, msVoz) {
  const orig = c.querySelector('.original');
  const trad = c.querySelector('.traducao');
  orig.textContent = texto;
  orig.dir = quem === 'utente' && lingua.rtl ? 'rtl' : 'auto';
  estado('A traduzir…');
  const t0 = performance.now();
  let resultado;
  if (cfg.tradutor === 'local') {
    resultado = quem === 'medico'
      ? await traduzirLocal(texto, PT.nllb, lingua.nllb)
      : await traduzirLocal(texto, lingua.nllb, PT.nllb);
  } else {
    resultado = quem === 'medico'
      ? await traduzir(texto, PT.de, lingua.azure)
      : await traduzir(texto, lingua.azureDe ?? lingua.azure, PT.para);
  }
  const msTrad = Math.round(performance.now() - t0);
  trad.textContent = resultado;
  trad.dir = quem === 'medico' && lingua.rtl ? 'rtl' : 'auto';
  trad.onclick = () => mostrarEcraInteiro(resultado, trad.dir);
  c.classList.remove('a-processar', 'erro');
  c.querySelector('.tempo').textContent = msVoz != null ? `voz ${(msVoz / 1000).toFixed(1)} s · trad. ${(msTrad / 1000).toFixed(1)} s` : '';

  // Retro-tradução: o médico confirma em português o que o utente vai ler (não atrasa a tradução)
  let retro = c.querySelector('.retro');
  if (quem === 'medico') {
    if (!retro) { retro = document.createElement('div'); retro.className = 'retro'; trad.after(retro); }
    retro.textContent = '↩ a verificar…';
    (cfg.tradutor === 'local'
      ? traduzirLocal(resultado, lingua.nllb, PT.nllb)
      : traduzir(resultado, lingua.azureDe ?? lingua.azure, PT.para)
    ).then((t) => { if (trad.textContent === resultado) retro.textContent = '↩ ' + t; })
     .catch(() => { retro.textContent = ''; });
  } else if (retro) retro.remove();

  // Corrigir o texto reconhecido e voltar a traduzir
  if (!c.querySelector('.editar')) {
    const b = document.createElement('button');
    b.className = 'editar';
    b.textContent = 'corrigir texto';
    b.onclick = async () => {
      const novo = prompt('Corrigir o texto reconhecido:', orig.textContent);
      if (novo && novo.trim() && novo !== orig.textContent) {
        c.classList.add('a-processar');
        try { await preencherCartao(c, quem, lingua, novo.trim(), null); } catch (e) { erroCartao(c, e); }
      }
    };
    c.appendChild(b);
  }
  estado('Pronto.');
  c.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function erroCartao(c, e) {
  c.classList.remove('a-processar');
  c.classList.add('erro');
  c.querySelector('.traducao').textContent = '⚠ ' + (e && e.message || e);
  estado('Ocorreu um erro.', true);
}

// ---- Texto escrito ----
async function traduzirEscrito(quem) {
  const t = el.txt.value.trim();
  if (!t) return;
  el.txt.value = '';
  const lingua = LINGUAS[el.lingua.value];
  const c = novoCartao(quem, lingua);
  try { await preencherCartao(c, quem, lingua, t, null); } catch (e) { erroCartao(c, e); }
}
el.txtMedico.addEventListener('click', () => traduzirEscrito('medico'));
el.txtUtente.addEventListener('click', () => traduzirEscrito('utente'));
el.txt.addEventListener('keydown', (e) => { if (e.key === 'Enter') traduzirEscrito('medico'); });

// ---- Ecrã inteiro para mostrar ao utente ----
function mostrarEcraInteiro(texto, dir) {
  el.eiTexto.textContent = texto;
  el.eiTexto.dir = dir || 'auto';
  el.eiTexto.classList.remove('virado');
  el.ei.hidden = false;
}
$('eiVirar').onclick = () => el.eiTexto.classList.toggle('virado');
$('eiFechar').onclick = () => { el.ei.hidden = true; };

// ---- Limpar ----
$('btnLimpar').onclick = () => {
  el.conversa.querySelectorAll('.cartao').forEach((c) => c.remove());
  el.vazio.hidden = false;
  estado(modeloPronto ? 'Conversa apagada.' : el.estado.textContent);
};

// ---- Definições ----
const dlg = $('dlgDef');
function abrirDefinicoes() {
  $('cfgTradutor').value = cfg.tradutor;
  $('cfgChave').value = cfg.chave;
  $('cfgRegiao').value = cfg.regiao;
  $('cfgModelo').value = cfg.modelo;
  $('cfgMotor').value = cfg.motor;
  dlg.showModal();
}
$('btnDef').onclick = abrirDefinicoes;
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'guardar') return;
  const mudouModelo = $('cfgModelo').value !== cfg.modelo || $('cfgMotor').value !== cfg.motor;
  gravarCfg('tradutor', $('cfgTradutor').value);
  gravarCfg('azureChave', $('cfgChave').value.trim());
  gravarCfg('azureRegiao', $('cfgRegiao').value.trim());
  gravarCfg('modelo', $('cfgModelo').value);
  gravarCfg('motor', $('cfgMotor').value);
  if (mudouModelo) carregarModelo();
  else if (cfg.tradutor === 'local' && !tradLocalPronto) carregarTradutorLocal();
  else if (modeloPronto) mensagemPronto();
});

// ---- Manter o ecrã ligado durante a consulta ----
let wakeLock = null;
async function pedirEcraLigado() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', pedirEcraLigado);
pedirEcraLigado();

// ---- App instalável / funciona com rede fraca ----
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

carregarModelo();
if (cfg.tradutor === 'azure' && !cfg.chave) abrirDefinicoes();

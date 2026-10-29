const TIPOS = ['Vinho tinto', 'Vinho branco', 'Vinho rosé', 'Espumante', 'Cerveja', 'Destilado', 'Outros'];

// Cor da cápsula da garrafa por tipo
const CAPSULA = {
  'Vinho tinto': '#8a2f3c',
  'Vinho branco': '#d9c98c',
  'Vinho rosé': '#dc9c9c',
  'Espumante': '#c8b46a',
  'Cerveja': '#c98a3c',
  'Destilado': '#9c7d5b',
  'Outros': '#8b8b85',
};

const ESTOQUE_BAIXO = 5;

const estado = {
  bebidas: [],
  tipo: '',
  busca: '',
  editandoId: null,
  salvarEstoque: new Map(), // id -> timer do debounce
};

const $ = (s) => document.querySelector(s);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const resp = await fetch('/api' + caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = resp.status === 204 ? null : await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(dados?.erro || `Erro ${resp.status}`);
  return dados;
}

// ---------------------------------------------------------------- Visual
const garrafaSvg = (tipo) => `
  <svg class="garrafa" viewBox="0 0 16 40" aria-hidden="true">
    <path d="M6 1h4v9c0 2 4 3.5 4 8v19.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 37.5V18c0-4.5 4-6 4-8z" fill="#0d0d0c" stroke="#d9d5cc" stroke-width="1.1"/>
    <rect x="5.6" y="1" width="4.8" height="5" rx=".6" fill="${CAPSULA[tipo] ?? CAPSULA.Outros}"/>
    <rect x="4" y="22" width="8" height="9" rx="1" fill="#e9e5dc"/>
    <path d="M5.5 25h5M6 27.5h4" stroke="#6b6963" stroke-width=".7"/>
  </svg>`;

function pillsEstoque(estoque) {
  if (estoque === 0) return '<span class="pill esgotado">Esgotado</span>';
  if (estoque <= ESTOQUE_BAIXO) return '<span class="pill alerta">Estoque baixo</span>';
  return '';
}

const subtitulo = (b) => [b.produtor, b.safra, b.volume_ml && b.volume_ml !== 750 ? `${b.volume_ml} ml` : null]
  .filter(Boolean).join(' · ') || b.tipo;

function contarAte(el, valor, formatar) {
  const inicio = Number(el.dataset.valor ?? 0);
  el.dataset.valor = valor;
  const duracao = 900;
  const t0 = performance.now();
  const passo = (t) => {
    const p = Math.min((t - t0) / duracao, 1);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = formatar(inicio + (valor - inicio) * e);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function toast(titulo, texto = '', tipo = 'ok') {
  const el = document.createElement('div');
  el.className = `aviso${tipo === 'erro' ? ' erro' : ''}`;
  el.innerHTML = `<span class="aviso-icone"></span><div><strong>${esc(titulo)}</strong>${texto ? `<p>${esc(texto)}</p>` : ''}</div>`;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('sumindo');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 3600);
}

// ---------------------------------------------------------------- Lista
function linhaBebida(b, i) {
  return `
    <li class="item" data-id="${b.id}" style="--i:${Math.min(i, 12)}">
      <button class="item-abrir" type="button" aria-label="Abrir ${esc(b.nome)}">
        <span class="thumb">${garrafaSvg(b.tipo)}</span>
        <span class="item-info">
          <span class="item-nome">${esc(b.nome)}</span>
          <span class="item-sub">${esc(subtitulo(b))}</span>
          <span class="pills"><span class="pill">${esc(b.tipo)}</span>${pillsEstoque(b.estoque)}</span>
        </span>
      </button>
      <div class="item-direita">
        <span class="item-preco">${brl.format(b.preco)}</span>
        <div class="stepper" aria-label="Estoque">
          <button type="button" data-delta="-1" aria-label="Diminuir estoque">−</button>
          <output>${b.estoque}</output>
          <button type="button" data-delta="1" aria-label="Aumentar estoque">+</button>
        </div>
      </div>
    </li>`;
}

function renderLista() {
  const lista = $('#lista');
  lista.innerHTML = estado.bebidas.map(linhaBebida).join('');
  $('#vazio').hidden = estado.bebidas.length > 0;
  const n = estado.bebidas.length;
  $('#contagem').textContent = `${n} ${n === 1 ? 'rótulo' : 'rótulos'}`;
}

async function carregarBebidas() {
  const params = new URLSearchParams();
  if (estado.busca) params.set('busca', estado.busca);
  if (estado.tipo) params.set('tipo', estado.tipo);
  try {
    estado.bebidas = await api('/bebidas?' + params);
    renderLista();
  } catch (e) {
    toast('Não foi possível carregar a adega', e.message, 'erro');
  }
}

async function carregarResumo() {
  try {
    const r = await api('/resumo');
    contarAte($('#stat-rotulos'), r.rotulos, (v) => inteiro.format(Math.round(v)));
    contarAte($('#stat-garrafas'), r.garrafas, (v) => inteiro.format(Math.round(v)));
    contarAte($('#stat-valor'), r.valor, (v) => brl.format(v));
  } catch { /* o toast da lista já avisa */ }
}

function alterarEstoque(id, delta, botao) {
  const b = estado.bebidas.find((x) => x.id === id);
  if (!b) return;
  const novo = Math.max(0, b.estoque + delta);
  if (novo === b.estoque) return;
  b.estoque = novo;

  const li = botao.closest('.item');
  const out = li.querySelector('output');
  out.textContent = novo;
  out.classList.remove('sobe', 'desce');
  void out.offsetWidth; // reinicia a animação
  out.classList.add(delta > 0 ? 'sobe' : 'desce');
  li.querySelector('.pills').innerHTML = `<span class="pill">${esc(b.tipo)}</span>${pillsEstoque(novo)}`;

  // Junta cliques rápidos em uma única requisição
  clearTimeout(estado.salvarEstoque.get(id));
  estado.salvarEstoque.set(id, setTimeout(async () => {
    estado.salvarEstoque.delete(id);
    try {
      await api(`/bebidas/${id}/estoque`, { metodo: 'PATCH', corpo: { estoque: b.estoque } });
      carregarRanking();
      carregarResumo();
    } catch (e) {
      toast('Erro ao atualizar estoque', e.message, 'erro');
      carregarBebidas();
    }
  }, 450));
}

// ---------------------------------------------------------------- Ranking (Redis)
async function carregarRanking() {
  try {
    const r = await api('/ranking?limite=10');
    $('#redis-off').hidden = r.redis;
    renderRanking(r.itens);
  } catch (e) {
    toast('Erro ao carregar ranking', e.message, 'erro');
  }
}

function renderRanking(itens) {
  const ol = $('#ranking');
  const existentes = new Map([...ol.querySelectorAll('.rank-item')].map((li) => [li.dataset.id, li]));
  const posAntes = new Map([...existentes].map(([id, li]) => [id, li.getBoundingClientRect().top]));
  const maximo = Math.max(1, ...itens.map((i) => i.estoque));

  const novos = itens.map((it, i) => {
    const id = String(it.id);
    let li = existentes.get(id);
    if (!li) {
      li = document.createElement('li');
      li.className = 'rank-item novo';
      li.dataset.id = id;
      li.style.setProperty('--i', i);
      li.innerHTML = `
        <span class="rank-pos"></span>
        <div style="min-width:0"><div class="rank-nome"></div><div class="rank-sub"></div></div>
        <span class="rank-valor"></span>
        <div class="rank-barra"><span></span></div>`;
    }
    li.querySelector('.rank-pos').textContent = i + 1;
    li.querySelector('.rank-nome').textContent = it.nome || `Bebida #${id}`;
    li.querySelector('.rank-sub').textContent = [it.produtor, it.safra, it.tipo].filter(Boolean).join(' · ');
    li.querySelector('.rank-valor').innerHTML = `${inteiro.format(it.estoque)}<small>${it.estoque === 1 ? 'unidade' : 'unidades'}</small>`;
    li._largura = `${(it.estoque / maximo) * 100}%`;
    return li;
  });

  ol.replaceChildren(...novos);
  if (!itens.length) ol.innerHTML = '<li class="ranking-vazio">Nenhuma bebida no ranking ainda.</li>';

  // FLIP: anima cada item da posição antiga até a nova
  for (const li of novos) {
    const antes = posAntes.get(li.dataset.id);
    if (antes != null) {
      const dy = antes - li.getBoundingClientRect().top;
      if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 550, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const li of novos) li.querySelector('.rank-barra span').style.width = li._largura;
  }));
}

async function sincronizarRanking() {
  const btn = $('#btn-sync');
  btn.classList.add('girando');
  btn.disabled = true;
  try {
    const [{ total }] = await Promise.all([api('/ranking/sincronizar', { metodo: 'POST' }), esperar(600)]);
    toast('Ranking reconstruído', `${total} bebidas sincronizadas do Supabase para o Redis.`);
    carregarRanking();
  } catch (e) {
    toast('Falha ao sincronizar', e.message, 'erro');
  } finally {
    btn.classList.remove('girando');
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- Formulário
const form = $('#form');
const fundo = $('#sheet-fundo');
const btnExcluir = $('#btn-excluir');
let timerConfirmar;

function abrirSheet() {
  fundo.hidden = false;
  void fundo.offsetWidth; // aplica o estado inicial antes de animar
  fundo.classList.add('aberto');
  document.body.style.overflow = 'hidden';
}

function fecharSheet() {
  fundo.classList.remove('aberto');
  document.body.style.overflow = '';
  setTimeout(() => { if (!fundo.classList.contains('aberto')) fundo.hidden = true; }, 400);
}

function prepararForm(b) {
  form.reset();
  $('#form-erro').textContent = '';
  form.querySelectorAll('.invalido').forEach((el) => el.classList.remove('invalido'));
  estado.editandoId = b?.id ?? null;
  resetarExcluir();

  $('#form-eyebrow').textContent = b ? `Bebida #${b.id}` : 'Cadastro';
  $('#form-titulo').textContent = b ? b.nome : 'Nova bebida';
  btnExcluir.hidden = !b;

  if (b) {
    for (const campo of form.elements) {
      if (campo.name && campo.name in b) campo.value = b[campo.name] ?? '';
    }
  }
}

function novaBebida() {
  prepararForm(null);
  abrirSheet();
  setTimeout(() => form.nome.focus(), 350);
}

async function editarBebida(id) {
  try {
    const b = await api(`/bebidas/${id}`); // consulta sempre o dado mais recente
    prepararForm(b);
    abrirSheet();
  } catch (e) {
    toast('Não foi possível abrir a bebida', e.message, 'erro');
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const dados = Object.fromEntries(new FormData(form));

  form.nome.classList.toggle('invalido', !dados.nome.trim());
  if (!dados.nome.trim()) {
    $('#form-erro').textContent = 'Informe o nome da bebida.';
    form.nome.focus();
    return;
  }

  const btn = $('#btn-salvar');
  btn.disabled = true;
  try {
    const editando = estado.editandoId;
    const salvo = editando
      ? await api(`/bebidas/${editando}`, { metodo: 'PUT', corpo: dados })
      : await api('/bebidas', { metodo: 'POST', corpo: dados });
    fecharSheet();
    toast(editando ? 'Alterações salvas' : 'Bebida cadastrada', `${salvo.nome} · ${salvo.estoque} em estoque`);
    await Promise.all([carregarBebidas(), carregarRanking(), carregarResumo()]);
  } catch (e) {
    $('#form-erro').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

function resetarExcluir() {
  clearTimeout(timerConfirmar);
  btnExcluir.classList.remove('confirmar');
  btnExcluir.textContent = 'Excluir';
}

btnExcluir.addEventListener('click', async () => {
  if (!btnExcluir.classList.contains('confirmar')) {
    btnExcluir.classList.add('confirmar');
    btnExcluir.textContent = 'Confirmar exclusão';
    timerConfirmar = setTimeout(resetarExcluir, 3500);
    return;
  }
  const id = estado.editandoId;
  const nome = form.nome.value;
  btnExcluir.disabled = true;
  try {
    await api(`/bebidas/${id}`, { metodo: 'DELETE' });
    fecharSheet();
    const li = document.querySelector(`.item[data-id="${id}"]`);
    if (li) {
      li.classList.add('saindo');
      await esperar(320);
    }
    toast('Bebida excluída', nome);
    await Promise.all([carregarBebidas(), carregarRanking(), carregarResumo()]);
  } catch (e) {
    $('#form-erro').textContent = e.message;
  } finally {
    btnExcluir.disabled = false;
    resetarExcluir();
  }
});

// ---------------------------------------------------------------- Eventos
function montarFiltros() {
  $('#campo-tipo').innerHTML = TIPOS.map((t) => `<option>${t}</option>`).join('');
  $('#chips').innerHTML = ['', ...TIPOS]
    .map((t) => `<button type="button" class="chip${t === '' ? ' ativo' : ''}" data-tipo="${t}">${t || 'Todos'}</button>`)
    .join('');
}

$('#chips').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip || chip.classList.contains('ativo')) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('ativo', c === chip));
  estado.tipo = chip.dataset.tipo;
  carregarBebidas();
});

let timerBusca;
$('#busca').addEventListener('input', (ev) => {
  clearTimeout(timerBusca);
  timerBusca = setTimeout(() => {
    estado.busca = ev.target.value.trim();
    carregarBebidas();
  }, 280);
});

$('#lista').addEventListener('click', (ev) => {
  const li = ev.target.closest('.item');
  if (!li) return;
  const id = Number(li.dataset.id);
  const passo = ev.target.closest('[data-delta]');
  if (passo) return alterarEstoque(id, Number(passo.dataset.delta), passo);
  if (ev.target.closest('.item-abrir')) editarBebida(id);
});

$('#btn-novo').addEventListener('click', novaBebida);
$('#btn-sync').addEventListener('click', sincronizarRanking);

fundo.addEventListener('click', (ev) => {
  if (ev.target === fundo || ev.target.closest('[data-fechar]')) fecharSheet();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !fundo.hidden) fecharSheet();
});

document.querySelector('.segmentos').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-view]');
  if (!btn) return;
  document.body.dataset.view = btn.dataset.view;
  document.querySelectorAll('.segmentos button').forEach((b) => b.classList.toggle('ativo', b === btn));
});

// ---------------------------------------------------------------- Início
montarFiltros();
$('#lista').innerHTML = '<li class="esqueleto"></li>'.repeat(5);
carregarBebidas();
carregarResumo();
carregarRanking();

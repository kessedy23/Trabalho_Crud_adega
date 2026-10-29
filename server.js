import 'dotenv/config';
import express from 'express';
import { createClient as criarSupabase } from '@supabase/supabase-js';
import { createClient as criarRedis } from 'redis';
import ws from 'ws';

const { SUPABASE_URL, SUPABASE_KEY, REDIS_URL = 'redis://localhost:6379', PORT = 3000 } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_KEY no arquivo .env (veja o .env.example).');
  process.exit(1);
}

const TIPOS = ['Vinho tinto', 'Vinho branco', 'Vinho rosé', 'Espumante', 'Cerveja', 'Destilado', 'Outros'];

// ---------------------------------------------------------------- Supabase
const supabase = criarSupabase(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }, // Node 20 não tem WebSocket nativo
});
const tabela = () => supabase.from('bebidas');

// ---------------------------------------------------------------- Redis
// Ranking = sorted set (membro: id da bebida, score: estoque)
// Detalhes para exibir o ranking sem ir ao Supabase = hash por bebida
const CHAVE_RANKING = 'adega:ranking:estoque';
const chaveBebida = (id) => `adega:bebida:${id}`;

const redis = criarRedis({
  url: REDIS_URL,
  socket: { reconnectStrategy: (tentativas) => Math.min(tentativas * 500, 5000) },
});

let avisouErroRedis = false;
redis.on('error', (e) => {
  if (!avisouErroRedis) console.warn(`[redis] indisponível (${e.code || e.message}). O CRUD segue funcionando; o ranking volta quando o Redis voltar.`);
  avisouErroRedis = true;
});
redis.on('ready', () => {
  avisouErroRedis = false;
  console.log('[redis] conectado');
  sincronizarRanking()
    .then((n) => console.log(`[redis] ranking sincronizado com ${n} bebidas`))
    .catch((e) => console.warn('[redis] falha ao sincronizar:', e.message));
});
redis.connect().catch(() => {});

const camposHash = (b) => ({
  nome: b.nome,
  produtor: b.produtor ?? '',
  tipo: b.tipo,
  safra: b.safra == null ? '' : String(b.safra),
});

// Falha no Redis nunca derruba uma operação do CRUD
const semFalhar = (promessa) => promessa.catch((e) => console.warn('[redis]', e.message));

function rankingSalvar(b) {
  if (!redis.isReady) return;
  return semFalhar(
    redis.multi()
      .zAdd(CHAVE_RANKING, { score: b.estoque, value: String(b.id) })
      .hSet(chaveBebida(b.id), camposHash(b))
      .exec(),
  );
}

function rankingRemover(id) {
  if (!redis.isReady) return;
  return semFalhar(redis.multi().zRem(CHAVE_RANKING, String(id)).del(chaveBebida(id)).exec());
}

async function sincronizarRanking() {
  const { data, error } = await tabela().select('id, nome, produtor, tipo, safra, estoque');
  if (error) throw error;

  const antigos = await redis.zRange(CHAVE_RANKING, 0, -1);
  const tx = redis.multi().del(CHAVE_RANKING);
  for (const id of antigos) tx.del(chaveBebida(id));
  for (const b of data) {
    tx.zAdd(CHAVE_RANKING, { score: b.estoque, value: String(b.id) });
    tx.hSet(chaveBebida(b.id), camposHash(b));
  }
  await tx.exec();
  return data.length;
}

// ---------------------------------------------------------------- Validação
function limparBebida(corpo = {}) {
  const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const numero = (v) => (v === '' || v == null ? null : Number(v));

  const b = {
    nome: texto(corpo.nome),
    produtor: texto(corpo.produtor),
    tipo: corpo.tipo,
    safra: numero(corpo.safra),
    regiao: texto(corpo.regiao),
    volume_ml: numero(corpo.volume_ml) ?? 750,
    preco: numero(corpo.preco) ?? 0,
    estoque: numero(corpo.estoque) ?? 0,
    descricao: texto(corpo.descricao),
  };

  if (!b.nome) return { erro: 'Informe o nome da bebida.' };
  if (b.nome.length > 120) return { erro: 'O nome pode ter no máximo 120 caracteres.' };
  if (!TIPOS.includes(b.tipo)) return { erro: 'Tipo de bebida inválido.' };
  if (b.safra !== null && !(Number.isInteger(b.safra) && b.safra >= 1900 && b.safra <= 2100))
    return { erro: 'A safra deve ser um ano entre 1900 e 2100.' };
  if (!Number.isInteger(b.volume_ml) || b.volume_ml <= 0) return { erro: 'Volume deve ser um número inteiro de ml.' };
  if (!Number.isFinite(b.preco) || b.preco < 0) return { erro: 'Preço inválido.' };
  if (!Number.isInteger(b.estoque) || b.estoque < 0) return { erro: 'Estoque deve ser um inteiro maior ou igual a zero.' };

  return { bebida: b };
}

function lerId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ erro: 'ID inválido.' });
    return null;
  }
  return id;
}

// Supabase devolve PGRST116 quando .single() não encontra a linha
const naoEncontrado = (error) => error?.code === 'PGRST116';

// ---------------------------------------------------------------- API
const app = express();
app.use(express.json());
app.use(express.static('public'));

const rota = (fn) => (req, res, next) => fn(req, res).catch(next);

// Listar / consultar com filtros
app.get('/api/bebidas', rota(async (req, res) => {
  let consulta = tabela().select('*').order('nome');

  const busca = String(req.query.busca ?? '').replace(/[,()%*]/g, ' ').trim();
  if (busca) consulta = consulta.or(`nome.ilike.%${busca}%,produtor.ilike.%${busca}%,regiao.ilike.%${busca}%`);
  if (TIPOS.includes(req.query.tipo)) consulta = consulta.eq('tipo', req.query.tipo);

  const { data, error } = await consulta;
  if (error) throw error;
  res.json(data);
}));

// Consultar por ID
app.get('/api/bebidas/:id', rota(async (req, res) => {
  const id = lerId(req, res);
  if (!id) return;
  const { data, error } = await tabela().select('*').eq('id', id).single();
  if (naoEncontrado(error)) return res.status(404).json({ erro: 'Bebida não encontrada.' });
  if (error) throw error;
  res.json(data);
}));

// Cadastrar
app.post('/api/bebidas', rota(async (req, res) => {
  const { bebida, erro } = limparBebida(req.body);
  if (erro) return res.status(400).json({ erro });
  const { data, error } = await tabela().insert(bebida).select().single();
  if (error) throw error;
  await rankingSalvar(data);
  res.status(201).json(data);
}));

// Atualizar
app.put('/api/bebidas/:id', rota(async (req, res) => {
  const id = lerId(req, res);
  if (!id) return;
  const { bebida, erro } = limparBebida(req.body);
  if (erro) return res.status(400).json({ erro });
  const { data, error } = await tabela().update(bebida).eq('id', id).select().single();
  if (naoEncontrado(error)) return res.status(404).json({ erro: 'Bebida não encontrada.' });
  if (error) throw error;
  await rankingSalvar(data);
  res.json(data);
}));

// Ajuste rápido de estoque (botões − / +)
app.patch('/api/bebidas/:id/estoque', rota(async (req, res) => {
  const id = lerId(req, res);
  if (!id) return;
  const estoque = Number(req.body?.estoque);
  if (!Number.isInteger(estoque) || estoque < 0) return res.status(400).json({ erro: 'Estoque inválido.' });
  const { data, error } = await tabela().update({ estoque }).eq('id', id).select().single();
  if (naoEncontrado(error)) return res.status(404).json({ erro: 'Bebida não encontrada.' });
  if (error) throw error;
  await rankingSalvar(data);
  res.json(data);
}));

// Excluir
app.delete('/api/bebidas/:id', rota(async (req, res) => {
  const id = lerId(req, res);
  if (!id) return;
  const { data, error } = await tabela().delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) return res.status(404).json({ erro: 'Bebida não encontrada.' });
  await rankingRemover(id);
  res.status(204).end();
}));

// Números do topo da página
app.get('/api/resumo', rota(async (_req, res) => {
  const { data, error } = await tabela().select('estoque, preco');
  if (error) throw error;
  res.json({
    rotulos: data.length,
    garrafas: data.reduce((s, b) => s + b.estoque, 0),
    valor: data.reduce((s, b) => s + b.estoque * Number(b.preco), 0),
  });
}));

// Ranking das bebidas com mais estoque (lido 100% do Redis)
app.get('/api/ranking', rota(async (req, res) => {
  if (!redis.isReady) return res.json({ redis: false, itens: [] });
  const limite = Math.min(Math.max(Number(req.query.limite) || 10, 1), 50);

  const top = await redis.zRangeWithScores(CHAVE_RANKING, 0, limite - 1, { REV: true });
  const detalhes = top.length
    ? await top.reduce((tx, { value }) => tx.hGetAll(chaveBebida(value)), redis.multi()).exec()
    : [];

  res.json({
    redis: true,
    itens: top.map(({ value, score }, i) => ({ id: Number(value), estoque: score, ...detalhes[i] })),
  });
}));

// Reconstrói o ranking a partir do Supabase
app.post('/api/ranking/sincronizar', rota(async (_req, res) => {
  if (!redis.isReady) return res.status(503).json({ erro: 'Redis indisponível.' });
  res.json({ total: await sincronizarRanking() });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: err.message || 'Erro interno.' });
});

app.listen(PORT, () => console.log(`Adega do Renan rodando em http://localhost:${PORT}`));

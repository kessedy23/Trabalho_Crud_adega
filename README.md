# Adega do Renan

CRUD de bebidas com **Supabase** (banco principal) e **Redis** (ranking das bebidas com mais estoque).

## Vídeo de apresentação

▶️ **[Assista à demonstração do projeto](video/apresentacao.mp4)**

O vídeo apresenta a proposta do projeto, as telas e funcionalidades, a integração com o Supabase, uma demonstração prática do Redis e a explicação de onde, por que e com quais benefícios o Redis foi usado.

## Como rodar

1. **Supabase**: crie um projeto em supabase.com, abra o *SQL Editor* e rode o arquivo `schema.sql`
   (ele cria a tabela `bebidas` e insere 10 bebidas de exemplo).
2. **Redis**: escolha um
   - local: `sudo apt install redis-server` (ele já sobe como serviço na porta 6379)
   - nuvem: crie um banco grátis no Upstash e copie a URL `rediss://...`
3. Copie `.env.example` para `.env` e preencha:
   - `SUPABASE_URL` e `SUPABASE_KEY` (a chave **service_role**, em *Project Settings → API*)
   - `REDIS_URL`
4. Rode:
   ```bash
   npm install
   npm start
   ```
5. Abra http://localhost:3000

## Como o Redis é usado

| Chave | Tipo | Conteúdo |
|---|---|---|
| `adega:ranking:estoque` | Sorted set | membro = id da bebida, score = estoque |
| `adega:bebida:<id>` | Hash | nome, produtor, tipo e safra, para montar o ranking sem consultar o Supabase |

- Cadastro, edição e ajuste de estoque fazem `ZADD` + `HSET`; a exclusão faz `ZREM` + `DEL`.
- O ranking é lido com `ZRANGE ... REV WITHSCORES` (top 10).
- Ao iniciar o servidor (ou pelo botão ↻ na tela), o ranking é reconstruído a partir do Supabase.
- Se o Redis cair, o CRUD continua funcionando e a tela avisa que o ranking está offline.

## API

| Método | Rota | Ação |
|---|---|---|
| GET | `/api/bebidas?busca=&tipo=` | Listar / pesquisar |
| GET | `/api/bebidas/:id` | Consultar uma bebida |
| POST | `/api/bebidas` | Cadastrar |
| PUT | `/api/bebidas/:id` | Atualizar |
| PATCH | `/api/bebidas/:id/estoque` | Ajustar estoque |
| DELETE | `/api/bebidas/:id` | Excluir |
| GET | `/api/resumo` | Totais do topo da página |
| GET | `/api/ranking?limite=10` | Ranking (Redis) |
| POST | `/api/ranking/sincronizar` | Reconstruir ranking |

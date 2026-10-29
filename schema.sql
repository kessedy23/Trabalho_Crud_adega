-- Adega do Renan — rode este script no Supabase (SQL Editor → New query → Run)

create table if not exists public.bebidas (
  id            bigint generated always as identity primary key,
  nome          text not null check (char_length(nome) between 1 and 120),
  produtor      text,
  tipo          text not null default 'Vinho tinto'
                check (tipo in ('Vinho tinto', 'Vinho branco', 'Vinho rosé', 'Espumante',
                                'Cerveja', 'Destilado', 'Outros')),
  safra         int check (safra between 1900 and 2100),
  regiao        text,
  volume_ml     int not null default 750 check (volume_ml > 0),
  preco         numeric(10, 2) not null default 0 check (preco >= 0),
  estoque       int not null default 0 check (estoque >= 0),
  descricao     text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Mantém atualizado_em sempre correto
create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists bebidas_atualizado_em on public.bebidas;
create trigger bebidas_atualizado_em
  before update on public.bebidas
  for each row execute function public.tocar_atualizado_em();

-- RLS ligado: só o servidor (chave service_role) acessa a tabela
alter table public.bebidas enable row level security;

-- Dados de exemplo
insert into public.bebidas (nome, produtor, tipo, safra, regiao, volume_ml, preco, estoque, descricao) values
  ('Catena Malbec',          'Catena Zapata',   'Vinho tinto',  2021, 'Mendoza, Argentina',    750, 129.90, 18, 'Frutas negras, violeta e taninos macios.'),
  ('Casillero del Diablo',   'Concha y Toro',   'Vinho tinto',  2022, 'Vale Central, Chile',   750,  64.90, 42, 'Cabernet Sauvignon fácil de beber.'),
  ('Terroir Merlot',         'Miolo',           'Vinho tinto',  2020, 'Vale dos Vinhedos, RS', 750,  98.00, 11, null),
  ('Sauvignon Blanc Reserva','Casa Silva',      'Vinho branco', 2023, 'Colchagua, Chile',      750,  79.90, 23, 'Cítrico e fresco, ótimo com frutos do mar.'),
  ('Brut Rosé',              'Casa Valduga',    'Espumante',    null, 'Serra Gaúcha, RS',      750, 112.00,  7, 'Método tradicional, perlage fina.'),
  ('Nature 130',             'Casa Valduga',    'Espumante',    null, 'Serra Gaúcha, RS',      750, 189.00,  3, null),
  ('Mateus Rosé',            'Sogrape',         'Vinho rosé',   null, 'Portugal',              750,  69.90, 15, null),
  ('Colorado Appia',         'Cervejaria Colorado','Cerveja',   null, 'Ribeirão Preto, SP',    600,  22.90, 60, 'Cerveja de trigo com mel.'),
  ('Gin Tanqueray',          'Diageo',          'Destilado',    null, 'Reino Unido',           750, 139.90,  9, null),
  ('Cachaça Salinas',        'Salinas',         'Destilado',    null, 'Salinas, MG',           700,  54.90, 27, 'Envelhecida em bálsamo.');

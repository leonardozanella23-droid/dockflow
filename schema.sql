-- DockFlow: execute UMA VEZ no SQL Editor do Supabase.
-- Autenticação: crie um usuário operador em Authentication > Users,
-- depois cadastre seu UUID em public.admins conforme README.
create extension if not exists pgcrypto;

create table if not exists public.docks (
  id bigint generated always as identity primary key,
  name text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  tracking_token uuid not null unique default gen_random_uuid(),
  number bigint generated always as identity unique,
  first_name text not null,
  last_name text not null,
  plate text not null,
  status text not null default 'waiting' check (status in ('waiting','called','done','cancelled')),
  dock_id bigint references public.docks(id),
  created_at timestamptz not null default now(),
  called_at timestamptz,
  finished_at timestamptz
);
create index if not exists tickets_waiting_idx on public.tickets(created_at,number) where status='waiting';
create unique index if not exists tickets_active_plate_idx on public.tickets(plate) where status in ('waiting','called');
create unique index if not exists tickets_active_dock_idx on public.tickets(dock_id) where status='called';
create index if not exists tickets_created_idx on public.tickets(created_at desc);

insert into public.docks(name) values ('Doca 01'),('Doca 02'),('Doca 03') on conflict(name) do nothing;

alter table public.docks enable row level security;
alter table public.admins enable row level security;
alter table public.tickets enable row level security;
revoke all on public.docks, public.admins, public.tickets from anon, authenticated;

create or replace function public.is_dock_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admins where user_id = auth.uid()) $$;
revoke all on function public.is_dock_admin() from public;
grant execute on function public.is_dock_admin() to authenticated;

-- As tabelas não têm políticas de leitura anônima. O acesso acontece SOMENTE
-- por funções com resposta restrita (motorista) ou autorização (operador).
create or replace function public.driver_checkin(p_first_name text, p_last_name text, p_plate text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_first text := btrim(p_first_name); v_last text := btrim(p_last_name);
        v_plate text := upper(regexp_replace(coalesce(p_plate,''),'[^a-zA-Z0-9]','','g'));
        v_ticket public.tickets;
begin
  if v_first is null or length(v_first) not between 2 and 60
     or v_last is null or length(v_last) not between 2 and 80
     or v_first !~ '^[[:alpha:]][[:alpha:] ''-]*$'
     or v_last !~ '^[[:alpha:]][[:alpha:] ''-]*$' then
    raise exception 'Informe nome e sobrenome válidos.' using errcode='P0001';
  end if;
  if v_plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
    raise exception 'Informe uma placa brasileira válida.' using errcode='P0001';
  end if;
  insert into public.tickets(first_name,last_name,plate)
  values(v_first,v_last,v_plate) returning * into v_ticket;
  return jsonb_build_object('tracking_token',v_ticket.tracking_token,'number',v_ticket.number);
exception when unique_violation then
  raise exception 'Esta placa já está aguardando ou em atendimento.' using errcode='P0001';
end $$;
revoke all on function public.driver_checkin(text,text,text) from public;
grant execute on function public.driver_checkin(text,text,text) to anon, authenticated;

create or replace function public.driver_status(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_ticket public.tickets; v_position bigint; v_dock text;
begin
 select * into v_ticket from public.tickets where tracking_token=p_token;
 if not found then return null; end if;
 if v_ticket.status='waiting' then
   select count(*) into v_position from public.tickets
   where status='waiting' and (created_at,number) <= (v_ticket.created_at,v_ticket.number);
 end if;
 select name into v_dock from public.docks where id=v_ticket.dock_id;
 return jsonb_build_object('number',v_ticket.number,'plate',v_ticket.plate,
   'status',v_ticket.status,'position',v_position,'dock',v_dock,'created_at',v_ticket.created_at);
end $$;
revoke all on function public.driver_status(uuid) from public;
grant execute on function public.driver_status(uuid) to anon,authenticated;

create or replace function public.admin_dashboard()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_docks jsonb; v_tickets jsonb;
begin
 if not public.is_dock_admin() then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) into v_docks
 from (select id,name,enabled from public.docks) d;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.number),'[]'::jsonb) into v_tickets
 from (select id,number,first_name,last_name,plate,status,dock_id,created_at,called_at,finished_at
       from public.tickets
       where status in ('waiting','called') or created_at >= date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
       order by created_at,number limit 1000) t;
 return jsonb_build_object('docks',v_docks,'tickets',v_tickets);
end $$;
revoke all on function public.admin_dashboard() from public;
grant execute on function public.admin_dashboard() to authenticated;

create or replace function public.admin_call_next(p_dock_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_ticket public.tickets; v_dock public.docks;
begin
 if not public.is_dock_admin() then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 select * into v_dock from public.docks where id=p_dock_id for update;
 if not found or not v_dock.enabled then raise exception 'Doca indisponível.' using errcode='P0001'; end if;
 if exists(select 1 from public.tickets where dock_id=p_dock_id and status='called') then
   raise exception 'A doca já está ocupada.' using errcode='P0001';
 end if;
 select * into v_ticket from public.tickets where status='waiting'
 order by created_at,number limit 1 for update skip locked;
 if not found then raise exception 'Não há motoristas na fila.' using errcode='P0001'; end if;
 update public.tickets set status='called',dock_id=p_dock_id,called_at=now()
 where id=v_ticket.id returning * into v_ticket;
 return jsonb_build_object('number',v_ticket.number,'plate',v_ticket.plate);
end $$;
revoke all on function public.admin_call_next(bigint) from public;
grant execute on function public.admin_call_next(bigint) to authenticated;

create or replace function public.admin_finish(p_ticket_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
 if not public.is_dock_admin() then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 update public.tickets set status='done',finished_at=now() where id=p_ticket_id and status='called';
 if not found then raise exception 'Atendimento não encontrado.' using errcode='P0001'; end if;
end $$;
revoke all on function public.admin_finish(uuid) from public;
grant execute on function public.admin_finish(uuid) to authenticated;

create or replace function public.admin_cancel(p_ticket_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
 if not public.is_dock_admin() then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 update public.tickets set status='cancelled',finished_at=now()
 where id=p_ticket_id and status in ('waiting','called');
 if not found then raise exception 'Senha não está ativa.' using errcode='P0001'; end if;
end $$;
revoke all on function public.admin_cancel(uuid) from public;
grant execute on function public.admin_cancel(uuid) to authenticated;

-- Segurança adicional: impedir execução pública de funções recém-criadas não é automática
-- no Supabase; os REVOKE/GRANT acima limitam o uso das funções do projeto.

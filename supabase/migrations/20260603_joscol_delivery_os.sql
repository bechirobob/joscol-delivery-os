-- JOSCOL Delivery OS Supabase/Postgres schema
-- Apply from the Supabase SQL editor or psql before setting JOSCOL_STORAGE_ADAPTER=postgres.

create table if not exists public.joscol_orders (
  id text primary key,
  status text not null,
  rider_id text,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists joscol_orders_status_idx on public.joscol_orders (status);
create index if not exists joscol_orders_rider_id_idx on public.joscol_orders (rider_id);
create index if not exists joscol_orders_updated_at_idx on public.joscol_orders (updated_at desc);

create table if not exists public.joscol_riders (
  id text primary key,
  status text not null,
  zone text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists joscol_riders_status_zone_idx on public.joscol_riders (status, zone);

create table if not exists public.joscol_order_events (
  order_id text not null references public.joscol_orders(id) on delete cascade,
  event_index integer not null,
  actor text,
  label text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (order_id, event_index)
);

create index if not exists joscol_order_events_order_created_idx on public.joscol_order_events (order_id, created_at);

create table if not exists public.joscol_rider_locations (
  rider_id text primary key references public.joscol_riders(id) on delete cascade,
  sharing boolean not null default false,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists joscol_rider_locations_sharing_updated_idx on public.joscol_rider_locations (sharing, updated_at desc);

create table if not exists public.joscol_staff_sessions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('dispatch', 'rider', 'ops')),
  session_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists joscol_staff_sessions_role_expires_idx on public.joscol_staff_sessions (role, expires_at desc);

alter table public.joscol_orders enable row level security;
alter table public.joscol_riders enable row level security;
alter table public.joscol_order_events enable row level security;
alter table public.joscol_rider_locations enable row level security;
alter table public.joscol_staff_sessions enable row level security;

-- The Node service uses the server-side Supabase service-role key from Render env.
-- Do not create public anon policies for these operational tables.

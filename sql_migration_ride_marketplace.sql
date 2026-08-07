begin;

-- ---------------------------------------------------------------------------
-- Driver Rate Profiles (default-first, but driver can set custom values)
-- ---------------------------------------------------------------------------
create table if not exists public.driver_rate_profiles (
    id uuid primary key default gen_random_uuid(),
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    is_active boolean not null default true,
    minimum_fare numeric(10,2) not null default 3.50,
    first_mile_fare numeric(10,2) not null default 4.00,
    per_mile_2_3 numeric(10,2) not null default 2.50,
    per_mile_after_3 numeric(10,2) not null default 2.10,
    per_minute_waiting numeric(10,2) not null default 0.20,
    airport_dropoff_fare numeric(10,2) not null default 32.00,
    airport_pickup_fare numeric(10,2) not null default 35.00,
    dog_charge numeric(10,2) not null default 2.00,
    estate_car_charge numeric(10,2) not null default 3.00,
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now()),
    constraint driver_rate_profiles_driver_unique unique (driver_id)
);

create index if not exists driver_rate_profiles_driver_idx on public.driver_rate_profiles(driver_id);

alter table public.driver_rate_profiles enable row level security;

drop policy if exists driver_rates_public_read_active on public.driver_rate_profiles;
create policy driver_rates_public_read_active
on public.driver_rate_profiles
for select
to public
using (
    is_active = true
    and exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.status = 'online'
    )
);

drop policy if exists driver_rates_owner_manage on public.driver_rate_profiles;
create policy driver_rates_owner_manage
on public.driver_rate_profiles
for all
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
)
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Ride Request Enhancements for estimate + bid tracking + rate snapshots
-- ---------------------------------------------------------------------------
alter table public.ride_requests
    add column if not exists estimated_min numeric(10,2),
    add column if not exists estimated_max numeric(10,2),
    add column if not exists about_price numeric(10,2),
    add column if not exists estimated_distance_miles numeric(10,2),
    add column if not exists rate_snapshot jsonb,
    add column if not exists matched_by text,
    add column if not exists bid_window_ends_at timestamptz,
    add column if not exists payment_method text,
    add column if not exists payment_status text default 'unpaid',
    add column if not exists rider_paid_at timestamptz,
    add column if not exists driver_paid_at timestamptz;

drop policy if exists drivers_read_own_rides on public.ride_requests;
create policy drivers_read_own_rides
on public.ride_requests
for select
to authenticated
using (
    assigned_driver_id in (
        select d.id
        from public.active_drivers d
        where d.user_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Driver Territory (territorial matching support)
-- ---------------------------------------------------------------------------
create extension if not exists postgis;

create table if not exists public.driver_territories (
    id uuid primary key default gen_random_uuid(),
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    label text,
    center geography(point, 4326) not null,
    radius_meters integer not null default 3218, -- ~2 miles
    is_active boolean not null default true,
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists driver_territories_driver_idx on public.driver_territories(driver_id);
create index if not exists driver_territories_center_gix on public.driver_territories using gist(center);

alter table public.driver_territories enable row level security;

drop policy if exists driver_territories_owner_manage on public.driver_territories;
create policy driver_territories_owner_manage
on public.driver_territories
for all
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
)
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Ride Offers + Driver Bids (marketplace negotiation tracking)
-- ---------------------------------------------------------------------------
create table if not exists public.ride_offers (
    id uuid primary key default gen_random_uuid(),
    ride_id uuid not null references public.ride_requests(id) on delete cascade,
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    suggested_amount numeric(10,2) not null,
    status text not null default 'pending', -- pending, accepted, rejected, expired
    expires_at timestamptz,
    created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists ride_offers_ride_idx on public.ride_offers(ride_id);
create index if not exists ride_offers_driver_idx on public.ride_offers(driver_id);

alter table public.ride_offers enable row level security;

drop policy if exists ride_offers_driver_insert on public.ride_offers;
create policy ride_offers_driver_insert
on public.ride_offers
for insert
to authenticated
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

drop policy if exists ride_offers_rider_read on public.ride_offers;
create policy ride_offers_rider_read
on public.ride_offers
for select
to authenticated
using (
    ride_id in (
        select r.id from public.ride_requests r
        where r.rider_id = auth.uid()
    )
);

drop policy if exists ride_offers_driver_read_own on public.ride_offers;
create policy ride_offers_driver_read_own
on public.ride_offers
for select
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

create table if not exists public.driver_bids (
    id uuid primary key default gen_random_uuid(),
    ride_id uuid not null references public.ride_requests(id) on delete cascade,
    driver_id uuid not null references public.active_drivers(id) on delete cascade,
    bid_amount numeric(10,2) not null,
    status text not null default 'pending', -- pending, accepted, rejected, expired
    expires_at timestamptz,
    created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists driver_bids_ride_idx on public.driver_bids(ride_id);
create index if not exists driver_bids_driver_idx on public.driver_bids(driver_id);

alter table public.driver_bids enable row level security;

drop policy if exists driver_bids_driver_insert on public.driver_bids;
create policy driver_bids_driver_insert
on public.driver_bids
for insert
to authenticated
with check (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

drop policy if exists driver_bids_driver_read_own on public.driver_bids;
create policy driver_bids_driver_read_own
on public.driver_bids
for select
to authenticated
using (
    exists (
        select 1 from public.active_drivers d
        where d.id = driver_id
          and d.user_id = auth.uid()
    )
);

drop policy if exists driver_bids_rider_read on public.driver_bids;
create policy driver_bids_rider_read
on public.driver_bids
for select
to authenticated
using (
    ride_id in (
        select r.id from public.ride_requests r
        where r.rider_id = auth.uid()
    )
);

-- ---------------------------------------------------------------------------
-- Device Push Tokens (for notifications when driver is off-screen)
-- ---------------------------------------------------------------------------
create table if not exists public.device_push_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    token text not null,
    platform text not null default 'unknown', -- ios, android, web
    enabled boolean not null default true,
    last_seen_at timestamptz not null default timezone('utc'::text, now()),
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now()),
    constraint device_push_tokens_unique unique (user_id, token)
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists push_tokens_owner_manage on public.device_push_tokens;
create policy push_tokens_owner_manage
on public.device_push_tokens
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Clinch Audit Guarantees (every ride linked to a clinch + server-side audit)
-- ---------------------------------------------------------------------------
create index if not exists clinch_history_clinch_changed_idx
on public.clinch_history(clinch_id, changed_at desc);

create or replace function public.ensure_ride_has_clinch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    generated_clinch_id uuid;
begin
    if new.clinch_id is not null then
        return new;
    end if;

    insert into public.clinches (
        sender_id,
        sender_name,
        sender_phone,
        recipient_phone,
        terms,
        status
    )
    values (
        null,
        coalesce(new.rider_name, 'Rider'),
        null,
        'Driver Phone',
        format(
            'Auto ride clinch. Destination: %s. Start meter: £%s.',
            coalesce(new.destination_text, 'Unknown'),
            to_char(coalesce(new.current_bid, 0), 'FM999999990.00')
        ),
        'pending'
    )
    returning id into generated_clinch_id;

    new.clinch_id := generated_clinch_id;
    return new;
end;
$$;

drop trigger if exists trg_ride_requests_require_clinch on public.ride_requests;
create trigger trg_ride_requests_require_clinch
before insert on public.ride_requests
for each row
execute function public.ensure_ride_has_clinch();

create or replace function public.audit_ride_request_to_clinch_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target_clinch_id uuid := coalesce(new.clinch_id, old.clinch_id);
    actor_phone text := coalesce(auth.jwt() ->> 'phone', 'system');
    bid_delta numeric := 0;
begin
    if target_clinch_id is null then
        return new;
    end if;

    if tg_op = 'INSERT' then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format(
                'RIDE_CREATED status=%s bid=£%s',
                coalesce(new.status, 'unknown'),
                to_char(coalesce(new.current_bid, 0), 'FM999999990.00')
            ),
            actor_phone,
            timezone('utc'::text, now())
        );
        return new;
    end if;

    if new.status is distinct from old.status then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('RIDE_STATUS %s -> %s', coalesce(old.status, 'null'), coalesce(new.status, 'null')),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.assigned_driver_id is distinct from old.assigned_driver_id
       and new.assigned_driver_id is not null then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('DRIVER_ASSIGNED %s', new.assigned_driver_id::text),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    bid_delta := abs(coalesce(new.current_bid, 0) - coalesce(old.current_bid, 0));

    -- Avoid noisy writes from second-by-second meter updates. Persist meaningful jumps only.
    if new.current_bid is distinct from old.current_bid and bid_delta >= 0.20 then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format(
                'RIDE_BID £%s -> £%s',
                to_char(coalesce(old.current_bid, 0), 'FM999999990.00'),
                to_char(coalesce(new.current_bid, 0), 'FM999999990.00')
            ),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.matched_by is distinct from old.matched_by and new.matched_by is not null then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('MATCHED_BY %s', new.matched_by),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.payment_status is distinct from old.payment_status then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format(
                'PAYMENT_STATUS %s -> %s',
                coalesce(old.payment_status, 'null'),
                coalesce(new.payment_status, 'null')
            ),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    if new.payment_method is distinct from old.payment_method and new.payment_method is not null then
        insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
        values (
            target_clinch_id,
            'RIDE_AUDIT_EVENT',
            format('PAYMENT_METHOD %s', new.payment_method),
            actor_phone,
            timezone('utc'::text, now())
        );
    end if;

    return new;
end;
$$;

drop trigger if exists trg_ride_requests_audit_clinch on public.ride_requests;
create trigger trg_ride_requests_audit_clinch
after insert or update on public.ride_requests
for each row
execute function public.audit_ride_request_to_clinch_history();

create or replace function public.audit_driver_bid_to_clinch_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target_clinch_id uuid;
    actor_phone text := coalesce(auth.jwt() ->> 'phone', 'driver');
begin
    select r.clinch_id into target_clinch_id
    from public.ride_requests r
    where r.id = new.ride_id;

    if target_clinch_id is null then
        return new;
    end if;

    insert into public.clinch_history (clinch_id, previous_terms, new_terms, changed_by_phone, changed_at)
    values (
        target_clinch_id,
        'RIDE_AUDIT_EVENT',
        format(
            'DRIVER_BID_LOG £%s (%s)',
            to_char(coalesce(new.bid_amount, 0), 'FM999999990.00'),
            coalesce(new.driver_id::text, 'unknown_driver')
        ),
        actor_phone,
        timezone('utc'::text, now())
    );

    return new;
end;
$$;

drop trigger if exists trg_driver_bids_audit_clinch on public.driver_bids;
create trigger trg_driver_bids_audit_clinch
after insert on public.driver_bids
for each row
execute function public.audit_driver_bid_to_clinch_history();

commit;

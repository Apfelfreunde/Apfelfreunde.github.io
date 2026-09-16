-- Vorbereitung für eine spätere zentrale Apfelbuch-Datenbank (Supabase/PostgreSQL).
-- Noch NICHT mit der Test-App verbunden.

create table if not exists varieties (
  id bigint generated always as identity primary key,
  fruit_type text not null check (fruit_type in ('apple','pear')),
  name text not null,
  synonyms text,
  origin text,
  tastes jsonb not null default '[]'::jsonb,
  ripeness_start smallint,
  ripeness_end smallint,
  ripeness_note text,
  usage text,
  storage text,
  description text,
  traits jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(fruit_type, name)
);

create table if not exists tree_findings (
  id bigint generated always as identity primary key,
  variety_name text not null,
  region_label text,
  -- Koordinaten nur grob/anonymisiert speichern (ca. 100 m Raster in der Testidee)
  latitude_approx numeric(8,3),
  longitude_approx numeric(8,3),
  tree_condition text,
  age_estimate text,
  notes text,
  created_at timestamptz not null default now()
);

-- Später mit Anmeldung/Rollen:
-- RLS aktivieren und SELECT auf tree_findings ausschließlich für Admins erlauben.
-- Normale Nutzer sollen keine Fundkarte oder Fundpunkte lesen können.

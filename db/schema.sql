-- ─────────────────────────────────────────────────────────────────────────────
-- Honda Door-to-Door Service Platform – PostgreSQL Schema
-- Run: psql -U postgres -d honda_service -f schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUMS ───────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'coordinator', 'driver', 'customer');

CREATE TYPE job_status AS ENUM (
  'booking_confirmed',
  'driver_assigned',
  'vehicle_picked_up',
  'inspection_done',
  'at_workshop',
  'in_progress',
  'waiting_approval',
  'service_completed',
  'ready_delivery',
  'out_delivery',
  'delivered'
);

CREATE TYPE task_type AS ENUM ('pickup', 'delivery');

CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'declined');

-- ─── USERS ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(180)  UNIQUE NOT NULL,
  phone         VARCHAR(30)   UNIQUE NOT NULL,
  password_hash TEXT          NOT NULL,
  role          user_role     NOT NULL DEFAULT 'customer',
  avatar_url    TEXT,
  fcm_token     TEXT,                         -- Firebase push token
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);

-- ─── REFRESH TOKENS ──────────────────────────────────────────────────────────

CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ─── VEHICLES ────────────────────────────────────────────────────────────────

CREATE TABLE vehicles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make         VARCHAR(60)  NOT NULL DEFAULT 'Honda',
  model        VARCHAR(80)  NOT NULL,
  year         SMALLINT     NOT NULL,
  plate        VARCHAR(30)  UNIQUE NOT NULL,
  color        VARCHAR(50),
  vin          VARCHAR(17),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vehicles_customer ON vehicles(customer_id);

-- ─── SERVICE CENTERS ─────────────────────────────────────────────────────────

CREATE TABLE service_centers (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name      VARCHAR(120) NOT NULL,
  address   TEXT         NOT NULL,
  city      VARCHAR(80)  NOT NULL DEFAULT 'Dubai',
  phone     VARCHAR(30),
  latitude  NUMERIC(10,7),
  longitude NUMERIC(10,7),
  is_active BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ─── JOBS ────────────────────────────────────────────────────────────────────

CREATE TABLE jobs (
  id                  VARCHAR(30)     PRIMARY KEY,   -- e.g. HON-2025-0421
  customer_id         UUID            NOT NULL REFERENCES users(id),
  vehicle_id          UUID            NOT NULL REFERENCES vehicles(id),
  coordinator_id      UUID            REFERENCES users(id),
  driver_id           UUID            REFERENCES users(id),
  advisor_id          UUID            REFERENCES users(id),
  service_center_id   UUID            REFERENCES service_centers(id),
  service_type        VARCHAR(120)    NOT NULL,
  status              job_status      NOT NULL DEFAULT 'booking_confirmed',
  pickup_address      TEXT            NOT NULL,
  pickup_lat          NUMERIC(10,7),
  pickup_lng          NUMERIC(10,7),
  scheduled_pickup_at TIMESTAMPTZ,
  actual_pickup_at    TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  notes               TEXT,
  customer_rating     SMALLINT        CHECK (customer_rating BETWEEN 1 AND 5),
  customer_feedback   TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_customer    ON jobs(customer_id);
CREATE INDEX idx_jobs_driver      ON jobs(driver_id);
CREATE INDEX idx_jobs_status      ON jobs(status);
CREATE INDEX idx_jobs_created     ON jobs(created_at DESC);

-- Auto-generate HON-YYYY-NNNN id
CREATE SEQUENCE job_seq START 1000;
CREATE OR REPLACE FUNCTION generate_job_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS NULL OR NEW.id = '' THEN
    NEW.id := 'HON-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('job_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_id
  BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION generate_job_id();

-- ─── JOB STATUS HISTORY ──────────────────────────────────────────────────────

CREATE TABLE job_status_history (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id     VARCHAR(30) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status     job_status  NOT NULL,
  changed_by UUID        REFERENCES users(id),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_status_history_job ON job_status_history(job_id);

-- ─── VEHICLE INSPECTIONS ─────────────────────────────────────────────────────

CREATE TABLE inspections (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id              VARCHAR(30) NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  driver_id           UUID        REFERENCES users(id),
  fuel_level          VARCHAR(20),
  mileage             INTEGER,
  exterior_note       TEXT,
  interior_note       TEXT,
  tire_condition      VARCHAR(60),
  windshield_ok       BOOLEAN,
  lights_ok           BOOLEAN,
  additional_notes    TEXT,
  customer_signed     BOOLEAN     NOT NULL DEFAULT FALSE,
  customer_signed_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INSPECTION PHOTOS ───────────────────────────────────────────────────────

CREATE TABLE inspection_photos (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID       NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  url          TEXT        NOT NULL,
  caption      VARCHAR(120),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── QUOTATIONS ──────────────────────────────────────────────────────────────

CREATE TABLE quotations (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          VARCHAR(30)     NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  total_amount    NUMERIC(10,2)   NOT NULL,
  currency        VARCHAR(5)      NOT NULL DEFAULT 'AED',
  approval_status approval_status NOT NULL DEFAULT 'pending',
  approved_at     TIMESTAMPTZ,
  declined_at     TIMESTAMPTZ,
  approved_by     UUID            REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ─── QUOTATION LINE ITEMS ─────────────────────────────────────────────────────

CREATE TABLE quotation_items (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID          NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  name         VARCHAR(160)  NOT NULL,
  description  TEXT,
  quantity     SMALLINT      NOT NULL DEFAULT 1,
  unit_price   NUMERIC(10,2) NOT NULL,
  sort_order   SMALLINT      NOT NULL DEFAULT 0
);

-- ─── DRIVER TASKS ────────────────────────────────────────────────────────────

CREATE TABLE driver_tasks (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id         VARCHAR(30) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  driver_id      UUID        NOT NULL REFERENCES users(id),
  task_type      task_type   NOT NULL,
  address        TEXT        NOT NULL,
  latitude       NUMERIC(10,7),
  longitude      NUMERIC(10,7),
  scheduled_at   TIMESTAMPTZ NOT NULL,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_tasks_driver ON driver_tasks(driver_id);
CREATE INDEX idx_driver_tasks_job    ON driver_tasks(job_id);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     VARCHAR(30) REFERENCES jobs(id) ON DELETE SET NULL,
  title      VARCHAR(120) NOT NULL,
  body       TEXT         NOT NULL,
  type       VARCHAR(50)  NOT NULL,       -- status_update | approval_request | etc.
  is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
  sent_via   TEXT[],                      -- ['push', 'sms', 'email']
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user    ON notifications(user_id);
CREATE INDEX idx_notifications_unread  ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_jobs_updated        BEFORE UPDATE ON jobs        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inspections_updated BEFORE UPDATE ON inspections  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_quotations_updated  BEFORE UPDATE ON quotations   FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ARSH BY HZK — database schema (Postgres). Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  article       TEXT NOT NULL UNIQUE,              -- article code, e.g. A01
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  fit           TEXT NOT NULL DEFAULT '',
  wash          TEXT NOT NULL DEFAULT '',
  fabric        TEXT NOT NULL DEFAULT '',
  price         INTEGER NOT NULL CHECK (price >= 0), -- whole PKR
  edition_size  INTEGER NOT NULL DEFAULT 250 CHECK (edition_size > 0),
  image         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'archived')),
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variants (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size        TEXT NOT NULL,
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sort        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, size)
);

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 10001;

CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled')),
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('cod', 'bank')),
  payment_status   TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT NOT NULL,
  address          JSONB NOT NULL,
  certificate_name TEXT NOT NULL,                  -- name shown on the piece's QR page
  notes            TEXT NOT NULL DEFAULT '',
  subtotal         INTEGER NOT NULL,
  shipping         INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'PKR',
  tracking         TEXT NOT NULL DEFAULT '',
  courier          TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (lower(email));

CREATE TABLE IF NOT EXISTS order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  variant_id  INTEGER NOT NULL REFERENCES variants(id),
  name        TEXT NOT NULL,
  article     TEXT NOT NULL,
  size        TEXT NOT NULL,
  unit_price  INTEGER NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, created_at);

-- QR codes. Printed blank in batches; bound to a physical piece + order line at fulfilment.
CREATE TABLE IF NOT EXISTS qr_batches (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  size        INTEGER NOT NULL,
  product_id  INTEGER REFERENCES products(id),     -- optional: batch reserved for one article
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pieces (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,            -- random, unguessable; encoded in the QR URL
  batch_id        INTEGER NOT NULL REFERENCES qr_batches(id),
  seq             INTEGER NOT NULL,                -- position within the batch (1..size), printed as a small serial
  status          TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'void')),
  product_id      INTEGER REFERENCES products(id),
  order_item_id   INTEGER REFERENCES order_items(id),
  edition_number  INTEGER,
  owner_name      TEXT,
  purchased_at    TIMESTAMPTZ,
  assigned_at     TIMESTAMPTZ,
  assigned_by     TEXT,
  scans           INTEGER NOT NULL DEFAULT 0,
  UNIQUE (batch_id, seq),
  UNIQUE (product_id, edition_number)
);
CREATE INDEX IF NOT EXISTS pieces_item_idx ON pieces (order_item_id);

CREATE TABLE IF NOT EXISTS access_requests (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  interest    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_log (
  id          SERIAL PRIMARY KEY,
  recipient   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Product photography beyond the lineup cutout (products.image): detail shots, on-body, fabric.
CREATE TABLE IF NOT EXISTS product_images (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  alt         TEXT NOT NULL DEFAULT '',
  width       INTEGER,
  height      INTEGER,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (product_id, sort);

-- Waitlist: "Request access" from the landing page and the full /waitlist form.
CREATE SEQUENCE IF NOT EXISTS waitlist_number_seq START 1;
CREATE TABLE IF NOT EXISTS waitlist (
  id          SERIAL PRIMARY KEY,
  number      INTEGER NOT NULL UNIQUE DEFAULT nextval('waitlist_number_seq'),
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  size        TEXT NOT NULL DEFAULT '',
  heard_from  TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'landing',
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'removed')),
  note        TEXT NOT NULL DEFAULT '',
  invited_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_idx ON waitlist (lower(email));
CREATE INDEX IF NOT EXISTS waitlist_status_idx ON waitlist (status, created_at DESC);

-- One-time carry-over of the old access_requests list. NOT EXISTS (not ON CONFLICT) so no sequence numbers are burned on re-runs.
INSERT INTO waitlist (email, source, created_at)
SELECT lower(a.email), 'landing', a.created_at
FROM (SELECT DISTINCT ON (lower(email)) email, created_at FROM access_requests ORDER BY lower(email), created_at) a
WHERE NOT EXISTS (SELECT 1 FROM waitlist w WHERE lower(w.email) = lower(a.email));

-- Which scheduled waitlist emails (countdown reminders) each person has already received.
CREATE TABLE IF NOT EXISTS email_events (
  waitlist_id INTEGER NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (waitlist_id, kind)
);

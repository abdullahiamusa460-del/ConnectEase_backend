-- ConnectEase initial schema
-- All timestamps are stored with time zone. Client-generated UUIDs are kept so
-- offline retries can be made idempotent.

CREATE TABLE installations (
  id uuid PRIMARY KEY,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_records (
  installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'note'
    CHECK (category IN ('note', 'contact', 'resource')),
  pinned boolean NOT NULL DEFAULT false,
  is_sample boolean NOT NULL DEFAULT false,
  client_created_at timestamptz NOT NULL,
  client_updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  server_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, record_id)
);

CREATE INDEX workspace_records_updated_idx
  ON workspace_records (installation_id, client_updated_at DESC);

CREATE TABLE sync_batches (
  installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, batch_id)
);

CREATE INDEX sync_batches_created_idx ON sync_batches (created_at);

CREATE TABLE reports (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  provider text NOT NULL
    CHECK (provider IN ('MTN', 'Airtel', 'Glo', '9mobile', 'Other')),
  location text,
  issue text NOT NULL,
  reported_at timestamptz NOT NULL,
  -- The API never accepts sample/demo reports. This constraint makes that
  -- guarantee structural rather than a convention.
  is_demo boolean NOT NULL DEFAULT false CHECK (is_demo = false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reports_reported_at_idx ON reports (reported_at DESC);
CREATE INDEX reports_provider_idx ON reports (provider);
CREATE INDEX reports_location_lower_idx ON reports (lower(location));
CREATE INDEX reports_installation_idx ON reports (installation_id);

CREATE TABLE network_tests (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  endpoint text,
  latency_ms integer,
  download_mbps numeric(14, 4),
  upload_mbps numeric(14, 4),
  tested_at timestamptz NOT NULL,
  error text,
  available boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_tests_complete_result_check CHECK (
    (
      available = true
      AND latency_ms IS NOT NULL
      AND download_mbps IS NOT NULL
      AND upload_mbps IS NOT NULL
      AND error IS NULL
    )
    OR
    (
      available = false
      AND error IS NOT NULL
    )
  ),
  CONSTRAINT network_tests_non_negative_check CHECK (
    (latency_ms IS NULL OR latency_ms >= 0)
    AND (download_mbps IS NULL OR download_mbps >= 0)
    AND (upload_mbps IS NULL OR upload_mbps >= 0)
  )
);

CREATE INDEX network_tests_tested_at_idx ON network_tests (tested_at DESC);
CREATE INDEX network_tests_available_idx ON network_tests (available);
CREATE INDEX network_tests_installation_idx ON network_tests (installation_id);

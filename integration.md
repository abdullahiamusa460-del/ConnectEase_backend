# ConnectEase Frontend ↔ Backend Integration

This document describes how the existing ConnectEase React frontend is wired to the
Node/Express/PostgreSQL backend. It is derived from the actual source in:

- Frontend: `/home/dazumi/ConnectEase`
- Backend: `/home/dazumi/ConnectEase_backend`

It is not a mock or a proposed contract. Every endpoint, field, storage key, and
status described below exists in the current source.

---

## 1. Architecture at a glance

```text
┌──────────────────────────────────────────────────────────────┐
│ ConnectEase React SPA                                        │
│                                                              │
│  UI components / pages                                       │
│        │                                                     │
│        ▼                                                     │
│  IndexedDB (source of truth for the UI)                      │
│  DB: connectease-offline, version 3                          │
│        │                                                     │
│        │  useSync / lib/sync.ts                              │
│        ▼                                                     │
│  lib/api.ts  ── JSON over HTTPS/HTTP ──┐                     │
└────────────────────────────────────────┼─────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────┐
│ ConnectEase API — Express 5 + TypeScript                     │
│                                                              │
│  /api/v1/installations  anonymous installation registration  │
│  /api/v1/sync           workspace push/pull                  │
│  /api/v1/reports        poor-network reports                 │
│  /api/v1/network-tests  measured speed-test results          │
│  /api/v1/stats          aggregated measured statistics       │
│                                                              │
│  Validation (Zod) → services → PostgreSQL                    │
└──────────────────────────────────────────┬───────────────────┘
                                           │
                                           ▼
                               PostgreSQL 14+ / 18
```

### Key integration rule

The frontend always writes to IndexedDB first. Sync is an additional transport
layer, not the primary data store. If the API is missing, unreachable, disabled,
or offline, the existing local UI continues to work.

The backend never fabricates measurements or sample reports. All network-test
statistics are computed from rows submitted by clients. Demo/sample report data
is kept local and excluded from sync.

---

## 2. Source map

### Frontend files that participate in integration

| File | Responsibility |
|---|---|
| `src/lib/db.ts` | IndexedDB version 3; records, pending changes, reports, tests, sync metadata |
| `src/lib/api.ts` | API base URL, fetch wrapper, anonymous installation credentials, endpoint functions |
| `src/lib/sync.ts` | Orchestrates workspace/report/test sync and stores `last-synced-at` |
| `src/hooks/useSync.ts` | Sync status, automatic triggers, manual sync, debounce, online/offline handling |
| `src/App.tsx` | Calls `useSync`, triggers sync after writes, passes status to `SyncPage`, best-effort remote report deletion |
| `src/pages/SyncPage.tsx` | Displays real sync status, last sync time, pending changes and manual sync action |
| `src/components/network-report/ReportList.tsx` | Shows `Demo · not synced`, `Saved offline`, or `Synced` state |
| `src/lib/networkTest.ts` | Runs the actual browser measurement; the backend only stores the result |
| `.env.example` | Documents `VITE_API_URL` |

### Backend files that implement the contract

| File | Responsibility |
|---|---|
| `src/app.ts` | Express app, middleware order, route mounting |
| `src/config/env.ts` | Environment validation |
| `src/db/pool.ts` | PostgreSQL pool and transactions |
| `src/db/migrate.ts` | SQL migration runner with checksums and advisory lock |
| `migrations/001_initial.sql` | Initial schema |
| `src/middleware/auth.ts` | Bearer installation-token authentication |
| `src/middleware/validate.ts` | Zod validation |
| `src/middleware/error-handler.ts` | Uniform error envelope, no stack leakage |
| `src/middleware/rate-limit.ts` | Global, registration, write and sync limiters |
| `src/routes/*.ts` | HTTP route definitions |
| `src/services/*.ts` | SQL and business logic |
| `src/schemas/*.ts` | Strict request validation |

---

## 3. Runtime configuration

### 3.1 Backend

Copy `.env.example` to `.env` and replace the placeholders.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | API port; default `4000` |
| `LOG_LEVEL` | Pino log level |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | `true` when the database requires SSL |
| `DATABASE_POOL_MAX` | Pool size, 1–50 |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |
| `TRUST_PROXY` | Number of reverse proxies in front of Express |
| `INSTALLATION_PEPPER` | Server-side HMAC pepper for installation secrets; minimum 32 chars |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window |
| `RATE_LIMIT_MAX` | Global requests per window |
| `WRITE_RATE_LIMIT_MAX` | Report/test write requests per window |
| `SYNC_RATE_LIMIT_MAX` | Sync requests per window |
| `REGISTRATION_RATE_LIMIT_MAX` | Registration requests per window |

`INSTALLATION_PEPPER` is required. The server rejects the example placeholder and
values shorter than 32 characters. Generate one with:

```bash
openssl rand -hex 32
```

The backend refuses to start if required environment values are invalid.

### 3.2 Frontend

`src/lib/api.ts` resolves the API origin as follows:

1. If `VITE_API_URL` is set, use it with trailing slashes removed.
2. In Vite development, if it is not set, use
   `window.location.protocol + '//' + window.location.hostname + ':4000'`.
3. In a production build with no `VITE_API_URL`, the API is considered
   **unconfigured**. The app stays local-only and the Sync page reports
   “Sync server not configured”.

`.env.example` in the frontend documents the variable:

```dotenv
VITE_API_URL=http://localhost:4000
```

The API path is always `/api/v1`, so the full URL for registration is, for example:

```text
http://localhost:4000/api/v1/installations/register
```

The frontend origin must also be present in the backend’s `CORS_ORIGINS`. The
example backend configuration allows `http://localhost:5173` and
`http://127.0.0.1:5173` (plus preview ports). If Vite picks another port, add that
exact origin or the browser will receive `403 FORBIDDEN`.

---

## 4. Offline-first behaviour

### 4.1 Local writes

All user actions write to IndexedDB first:

- Workspace create/update writes the record and a pending change to the
  `records` and `changes` stores.
- Workspace delete removes the record and writes a `delete` pending change.
- Reports are written to the `reports` store with no `syncedAt`.
- Network-test results are written to the `networkTests` store with no
  `syncedAt`.

The UI reads from IndexedDB, so none of these actions wait for the network.

IndexedDB database:

```text
Name:    connectease-offline
Version: 3
Stores:
  records       keyPath: id
  changes       keyPath: recordId
  settings      keyPath: key
  networkTests  keyPath: id
  reports       keyPath: id
  syncMeta      keyPath: key
```

`syncMeta` holds:

| Key | Value |
|---|---|
| `installation-credentials` | `{ installationId, secret, createdAt }` |
| `last-synced-at` | ISO timestamp of the last successful sync |

The installation secret is generated on the device from 32 random bytes and
encoded as URL-safe base64. It is never returned by the server.

### 4.2 When sync runs

`src/hooks/useSync.ts` schedules sync when all relevant conditions are met:

| Trigger | Delay / behaviour |
|---|---|
| App boot, online, configured, `autoSync` enabled | ~900 ms after mount |
| Transition from offline/simulated-offline to online, `autoSync` enabled | ~400 ms |
| Pending workspace changes exist, `autoSync` enabled | debounced ~1200 ms |
| A report is created | `requestSync()` from `App.tsx`, ~600 ms |
| A network test is saved | `requestSync()` from `App.tsx`, ~600 ms |
| User clicks **Sync now** | Immediate manual sync |

`syncAll()` is single-flight: a module-level promise prevents concurrent sync
runs in the same browser tab. `useSync` also guards against overlapping runs.

### 4.3 Sync sequence

`src/lib/sync.ts` performs these steps in order:

1. Ensure the anonymous installation is registered.
2. Read local records and pending changes.
3. Convert pending changes to the wire format, sorted oldest first.
4. `POST /api/v1/sync` with a fresh `batchId`.
5. Merge the response into IndexedDB.
6. Upload unsynced, non-demo reports one at a time.
7. Upload unsynced network-test results one at a time.
8. Save `last-synced-at`.
9. Ask `App.tsx` to reload workspace and report data so the UI reflects
   `syncedAt`/server merges.

A failed network request leaves all local data and pending markers intact. A
4xx item-level error on a report or test is counted as `skipped` and does not
block the rest of the sync; auth, rate-limit, and server/network errors abort the
run so it can be retried later.

### 4.4 Sync UI states

`SyncStatus` is one of:

```text
idle | syncing | synced | offline | error | unconfigured
```

`SyncPage` uses these to show:

- Connected / Offline / Unreachable / Not configured
- Last successful sync time
- Pending change queue
- A **Sync now** button that is disabled while syncing

### 4.5 Settings caveat

The existing setting `syncOnWifiOnly` is stored in preferences, but
`useSync` currently checks only `autoSync`. There is no Network Information API
integration in the current source, so Wi-Fi-only enforcement is not implemented.
This is an existing frontend limitation, not a backend contract issue.

---

## 5. Anonymous installation authentication

There are no user accounts. Workspace data is scoped to an anonymous installation
created by the browser.

### 5.1 Registration

```http
POST /api/v1/installations/register
Content-Type: application/json

{
  "installationId": "UUID v4 generated on the device",
  "secret": "32-128 URL-safe characters generated on the device"
}
```

The backend:

- Stores only an HMAC-SHA256 hash of the secret, keyed by
  `INSTALLATION_PEPPER`.
- Returns `201` on first registration and `200` for an idempotent retry.
- Returns `409` if the installation id exists with a different secret.
- Never returns the secret.

Response:

```json
{
  "installationId": "b7e5…",
  "registeredAt": "2026-10-23T14:00:00.000Z"
}
```

If the client receives `409` during registration, `src/lib/api.ts` generates a
fresh installation id/secret and retries once. This makes sync recover if local
credentials were partially cleared, at the cost of leaving the orphaned server
installation behind.

### 5.2 Authenticated requests

Every protected request sends:

```http
Authorization: Bearer ce1.<installationId>.<secret>
```

The backend parses the token, looks up `installations.secret_hash`, and compares
it in constant time. Invalid or missing tokens return `401 UNAUTHORIZED`.

Endpoints and protection:

| Endpoint | Auth |
|---|---|
| `POST /api/v1/installations/register` | Public |
| `POST /api/v1/sync` | Required |
| `GET /api/v1/sync/records` | Required |
| `GET /api/v1/reports`, `GET /api/v1/reports/:id` | Public |
| `POST /api/v1/reports`, `DELETE /api/v1/reports/:id` | Required |
| `GET|POST /api/v1/network-tests` | Required |
| `GET /api/v1/stats` | Public |
| `GET /health`, `GET /api/v1/health` | Public |

---

## 6. Data mapping

### 6.1 Workspace records

Local `WorkspaceRecord` / `PendingChange` in `src/types.ts` map to the sync wire
format and then to PostgreSQL:

| Local | Sync request | PostgreSQL column |
|---|---|---|
| `WorkspaceRecord.id` | `recordId` | `workspace_records.record_id` |
| `title` | `record.title` | `title` |
| `body` | `record.body` | `body` |
| `category` | `record.category` | `category` |
| `pinned` | `record.pinned` | `pinned` |
| `isSample` | `record.isSample` | `is_sample` |
| `createdAt` | `record.createdAt` | `client_created_at` |
| `updatedAt` | `record.updatedAt` | `client_updated_at` |
| `PendingChange.changedAt` | `changedAt` | used as the client update timestamp |
| `PendingChange.action` | `action` | `create/update/delete` |

Delete changes create a tombstone row (`deleted_at` set), so deletions can
propagate. The workspace is scoped by `installation_id`; another installation
cannot read or modify it.

### 6.2 Reports

| Local `NetworkReport` | API field | PostgreSQL |
|---|---|---|
| `id` | `id` | `reports.id` |
| `provider` | `provider` | `provider` |
| `location` | `location` | `location` |
| `issue` | `issue` | `issue` |
| `reportedAt` | `reportedAt` | `reported_at` |
| `isDemo` | **not sent** | never accepted server-side |
| `syncedAt` | **local only** | not stored |

Sample reports are created by `persistReport(input, true)` in `src/lib/db.ts`,
which sets `isDemo: true`. `getUnsyncedReports()` filters out both reports that
already have `syncedAt` and reports with `isDemo`. The UI labels them
`Demo data — not a real report` and `Demo · not synced`.

The server schema is `.strict()` and the `reports` table has
`CHECK (is_demo = false)`. A request containing an unexpected `isDemo` field is
rejected with `400 VALIDATION_ERROR`, so sample data cannot enter shared reports
or statistics.

### 6.3 Network tests

| Local `NetworkTestResult` | API field | PostgreSQL |
|---|---|---|
| `id` | `id` | `network_tests.id` |
| `endpoint` | `endpoint` | `endpoint` |
| `latencyMs` | `latencyMs` | `latency_ms` |
| `downloadMbps` | `downloadMbps` | `download_mbps` |
| `uploadMbps` | `uploadMbps` | `upload_mbps` |
| `testedAt` | `testedAt` | `tested_at` |
| `error` | `error` | `error` |
| `available` | `available` | `available` |
| `syncedAt` | **local only** | not stored |

Measurements are produced only by `src/lib/networkTest.ts` in the browser. The
backend stores exactly what was measured; it does not generate or backfill
values.

Validation enforces:

- `available: true` → latency, download, and upload are non-null; `error` is null.
- `available: false` → `error` is non-empty; measurements may be null.
- Values are finite and non-negative, with sane upper bounds.
- `isDemo`/unknown fields are rejected by the strict schema.

### 6.4 Server tables

| Table | Purpose |
|---|---|
| `installations` | Anonymous installation id and secret hash |
| `workspace_records` | Per-installation records plus tombstones |
| `sync_batches` | Idempotency record and cached response per `(installation_id, batch_id)` |
| `reports` | Shared poor-network reports; demo rows structurally impossible |
| `network_tests` | Measured speed-test results; completion consistency enforced by CHECK constraints |

Indexes cover report time, provider, lowercased location, installation, test
time, availability and workspace update time.

---

## 7. API contract

Base path:

```text
/api/v1
```

All request bodies are JSON. Unknown fields are rejected by the strict Zod
schemas. All timestamp fields must be ISO-8601 date-times and no more than
10 minutes in the future; the earliest accepted timestamp is 2020-01-01.

### 7.1 Health

```http
GET /health
GET /api/v1/health
```

Response `200` (or `503` if the database is down):

```json
{
  "status": "ok",
  "service": "connectease-api",
  "database": "up",
  "timestamp": "2026-10-23T14:00:00.000Z",
  "uptimeSeconds": 123
}
```

### 7.2 Register installation

```http
POST /api/v1/installations/register
```

Request:

```json
{
  "installationId": "8d1e2f3a-4b5c-4d6e-8f70-123456789abc",
  "secret": "a-43-character-url-safe-secret-generated-by-the-client"
}
```

Response `201` (new) or `200` (same credentials retried):

```json
{
  "installationId": "8d1e2f3a-4b5c-4d6e-8f70-123456789abc",
  "registeredAt": "2026-10-23T14:00:00.000Z"
}
```

Errors:

- `400 VALIDATION_ERROR` — invalid UUID, short/invalid secret, unknown field
- `409 CONFLICT` — same id, different secret

### 7.3 Sync workspace

```http
POST /api/v1/sync
Authorization: Bearer ce1.<installationId>.<secret>
```

Request:

```json
{
  "batchId": "0e7d1a2b-3c4d-4e5f-8a9b-0123456789ab",
  "changes": [
    {
      "recordId": "1a2b3c4d-5e6f-4a7b-8c9d-0123456789ab",
      "action": "create",
      "changedAt": "2026-10-23T14:00:00.000Z",
      "record": {
        "title": "Field note",
        "body": "Saved while offline.",
        "category": "note",
        "pinned": false,
        "isSample": false,
        "createdAt": "2026-10-23T13:59:00.000Z",
        "updatedAt": "2026-10-23T14:00:00.000Z"
      }
    }
  ]
}
```

`changes` may be empty to pull the current server workspace. Maximum 200 changes
per batch. A delete change only needs `recordId`, `action: "delete"` and
`changedAt`.

Response `200`:

```json
{
  "batchId": "0e7d1a2b-3c4d-4e5f-8a9b-0123456789ab",
  "replayed": false,
  "acknowledgements": [
    {
      "recordId": "1a2b3c4d-5e6f-4a7b-8c9d-0123456789ab",
      "action": "create",
      "status": "applied",
      "changedAt": "2026-10-23T14:00:00.000Z"
    }
  ],
  "records": [
    {
      "recordId": "1a2b3c4d-5e6f-4a7b-8c9d-0123456789ab",
      "title": "Field note",
      "body": "Saved while offline.",
      "category": "note",
      "pinned": false,
      "isSample": false,
      "createdAt": "2026-10-23T13:59:00.000Z",
      "updatedAt": "2026-10-23T14:00:00.000Z"
    }
  ],
  "tombstones": [],
  "serverTime": "2026-10-23T14:00:01.000Z"
}
```

Acknowledgement `status` is `applied` or `conflict`. A conflict means the incoming
`changedAt` is older than the version already stored; `serverUpdatedAt` is then
included. The returned records remain the server truth for the client to merge.

#### Idempotency and duplicate prevention

- `batchId` is the sync idempotency key, scoped per installation.
- Replaying the same `batchId` with the same canonical payload returns the stored
  response with `replayed: true`; changes are not applied twice.
- Reusing a `batchId` with a different payload returns `409 CONFLICT`.
- Record upserts are last-write-wins by client `changedAt`.
- The backend serializes batches per installation with a PostgreSQL advisory
  lock, preventing concurrent batch corruption.

#### Pull records

```http
GET /api/v1/sync/records?since=2026-10-23T14:00:00.000Z
Authorization: Bearer ce1.<installationId>.<secret>
```

Response:

```json
{
  "records": [],
  "tombstones": [],
  "serverTime": "2026-10-23T14:00:01.000Z"
}
```

`since` is optional; when present, only rows with `client_updated_at > since` are
returned. Tombstones let the client remove deleted records.

### 7.4 Reports

#### Create

```http
POST /api/v1/reports
Authorization: Bearer ce1.<installationId>.<secret>
```

Request:

```json
{
  "id": "3c4d5e6f-7a8b-4c9d-8e0f-123456789abc",
  "provider": "MTN",
  "location": "Ikeja, Lagos",
  "issue": "Calls drop repeatedly during the evening.",
  "reportedAt": "2026-10-23T14:00:00.000Z"
}
```

`provider` is one of `MTN`, `Airtel`, `Glo`, `9mobile`, `Other`. `location` may be
`null` or omitted. `issue` is 1–2000 characters. The client-generated `id` makes
offline retries idempotent.

Response `201` on first insert, `200` on an identical retry:

```json
{
  "report": {
    "id": "3c4d5e6f-7a8b-4c9d-8e0f-123456789abc",
    "provider": "MTN",
    "location": "Ikeja, Lagos",
    "issue": "Calls drop repeatedly during the evening.",
    "reportedAt": "2026-10-23T14:00:00.000Z",
    "isDemo": false
  },
  "duplicate": false
}
```

A reused id with different content, or an id owned by another installation,
returns `409 CONFLICT`.

#### List / filter

```http
GET /api/v1/reports?provider=MTN&location=Ikeja&q=drop&from=...&to=...&limit=20&offset=0&sort=newest
```

Query parameters:

| Parameter | Notes |
|---|---|
| `provider` | Exact provider enum |
| `location` | Case-insensitive substring match |
| `q` | Case-insensitive search across issue, location and provider |
| `from`, `to` | Inclusive reported-at range |
| `limit` | 1–100, default 20 |
| `offset` | 0–100000, default 0 |
| `sort` | `newest` (default) or `oldest` |

Response:

```json
{
  "data": [
    {
      "id": "3c4d5e6f-7a8b-4c9d-8e0f-123456789abc",
      "provider": "MTN",
      "location": "Ikeja, Lagos",
      "issue": "Calls drop repeatedly during the evening.",
      "reportedAt": "2026-10-23T14:00:00.000Z",
      "isDemo": false
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  }
}
```

#### Get one

```http
GET /api/v1/reports/:id
```

Response:

```json
{
  "report": {
    "id": "3c4d5e6f-7a8b-4c9d-8e0f-123456789abc",
    "provider": "MTN",
    "location": "Ikeja, Lagos",
    "issue": "Calls drop repeatedly during the evening.",
    "reportedAt": "2026-10-23T14:00:00.000Z",
    "isDemo": false
  }
}
```

#### Delete

```http
DELETE /api/v1/reports/:id
Authorization: Bearer ce1.<installationId>.<secret>
```

- `204` when deleted by the owning installation.
- `404` when the report does not exist.
- `409` when it exists but belongs to another installation.

The frontend calls this only when the report has `syncedAt` and the app is online.
There is no offline tombstone queue for report deletion in the current source.

### 7.5 Network tests

#### Create

```http
POST /api/v1/network-tests
Authorization: Bearer ce1.<installationId>.<secret>
```

Request:

```json
{
  "id": "4d5e6f7a-8b9c-4d0e-9f1a-123456789abc",
  "endpoint": "https://example.com/speed-test",
  "latencyMs": 42,
  "downloadMbps": 12.5,
  "uploadMbps": 4.2,
  "testedAt": "2026-10-23T14:00:00.000Z",
  "error": null,
  "available": true
}
```

Response `201` on first insert, `200` on an identical retry:

```json
{
  "test": {
    "id": "4d5e6f7a-8b9c-4d0e-9f1a-123456789abc",
    "endpoint": "https://example.com/speed-test",
    "latencyMs": 42,
    "downloadMbps": 12.5,
    "uploadMbps": 4.2,
    "testedAt": "2026-10-23T14:00:00.000Z",
    "error": null,
    "available": true,
    "isDemo": false
  },
  "duplicate": false
}
```

#### List own history

```http
GET /api/v1/network-tests?limit=20&offset=0
Authorization: Bearer ce1.<installationId>.<secret>
```

Returns only the authenticated installation’s results:

```json
{
  "data": [],
  "pagination": {
    "total": 0,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  }
}
```

### 7.6 Network statistics

```http
GET /api/v1/stats?provider=MTN&location=Ikeja&from=...&to=...
```

All parameters are optional. Report filters apply to report counts and
breakdowns. Speed-test statistics are filtered by date only, because
`network_tests` has no provider/location columns.

Response:

```json
{
  "stats": {
    "generatedAt": "2026-10-23T14:00:00.000Z",
    "filters": {
      "provider": "MTN",
      "location": "Ikeja",
      "from": null,
      "to": null
    },
    "reports": {
      "total": 10,
      "last24h": 3,
      "last7d": 8,
      "lastReportedAt": "2026-10-23T13:50:00.000Z",
      "byProvider": [
        { "provider": "MTN", "count": 7 },
        { "provider": "Airtel", "count": 3 }
      ],
      "topLocations": [
        { "location": "Ikeja, Lagos", "count": 4 }
      ]
    },
    "networkTests": {
      "total": 5,
      "completed": 4,
      "unavailable": 1,
      "averageLatencyMs": 48.5,
      "averageDownloadMbps": 14.2,
      "averageUploadMbps": 5.1,
      "p50DownloadMbps": 12.5,
      "p95LatencyMs": 84,
      "latestTestedAt": "2026-10-23T13:55:00.000Z"
    },
    "dataSource": "measured",
    "sampleDataIncluded": false
  }
}
```

The statistics endpoint never returns demo/sample data. Tests marked
`available: false` are counted as unavailable and excluded from average and
percentile calculations. Empty datasets return `0` counts and `null` averages,
not invented values.

The frontend client already exposes `fetchReports()` and `fetchStats()` in
`src/lib/api.ts`, but the current UI does not call them yet. Reports shown in the
UI are the device’s local reports; statistics are available through the API but
are not rendered on a page in the current source.

### 7.7 Error envelope

All API errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "requestId": "b0f1…",
    "details": [
      { "path": "provider", "message": "Invalid option", "code": "invalid_value" }
    ]
  }
}
```

`details` is present for validation errors. `requestId` also appears in the
`x-request-id` response header. Stack traces are never returned.

Common statuses:

| Status | Code | Meaning |
|---|---|---|
| `400` | `VALIDATION_ERROR` / `BAD_REQUEST` | Invalid fields, malformed JSON, oversized body |
| `401` | `UNAUTHORIZED` | Missing/invalid installation token |
| `403` | `FORBIDDEN` | Origin rejected by CORS |
| `404` | `NOT_FOUND` | Unknown route/report |
| `409` | `CONFLICT` | Duplicate id with different data, wrong owner, reused batch id |
| `413` | `BAD_REQUEST` | Body exceeds 64 KB |
| `429` | `RATE_LIMITED` | Limit exceeded |
| `500` | `INTERNAL_ERROR` | Unexpected server/database error |
| `503` | — | Health check only, database unavailable |

### 7.8 Rate limits and security middleware

All limits use `RATE_LIMIT_WINDOW_MS` (default 15 minutes):

| Limiter | Default limit |
|---|---|
| Global per IP | 300 |
| Registration | 20 |
| Report/test writes | 120 |
| Sync | 60 |

The app also enables:

- Helmet security headers
- Explicit CORS origin allowlist, methods `GET, POST, DELETE, OPTIONS`
- Allowed headers `Authorization, Content-Type, X-Request-Id`
- 64 KB JSON body limit
- Request IDs on every response
- Pino request/error logs with authorization and secret redaction
- Parameterized SQL queries
- Strict Zod schemas
- No secret values in API responses

---

## 8. Merge, retry and conflict behaviour

### Workspace

1. The client sends pending changes sorted oldest first.
2. The server accepts a change only when its `changedAt` is greater than or equal
   to the stored `client_updated_at`.
3. An older change is acknowledged as `conflict`; the server copy is returned.
4. The client merges server records only when the server `updatedAt` is not older
   than a newer local pending edit.
5. Acknowledged changes are removed only if the local change has not been
   superseded by a newer edit during the sync.
6. Tombstones delete local records unless a newer pending local change exists.

### Reports and tests

- Both use client-generated UUIDs as the primary key.
- Repeated delivery of the same payload returns `200` with `duplicate: true` and
  does not create another row.
- Thus a sync whose HTTP response was lost can retry safely.
- `syncedAt` is set locally only after the server accepts the item.

### Sync batches

- `sync_batches.response` stores the exact JSON response for replay.
- The request hash is canonicalized, so key ordering does not falsely trigger a
  conflict.
- Reusing a batch id with different content is rejected.

---

## 9. Running and verifying the integration

### Backend

```bash
cd /home/dazumi/ConnectEase_backend
npm install
cp .env.example .env
# Edit .env: DATABASE_URL, INSTALLATION_PEPPER, CORS_ORIGINS
npm run migrate
npm run dev
```

Build and start:

```bash
npm run build
npm start
```

Health check:

```bash
curl http://localhost:4000/api/v1/health
```

### Frontend

```bash
cd /home/dazumi/ConnectEase
npm install
cp .env.example .env.local
# Edit .env.local if the API is not on the default development host:4000
npm run dev
```

If the frontend runs on a different port, add that origin to the backend’s
`CORS_ORIGINS`. For a production build, set `VITE_API_URL` to the public API
origin **before** `npm run build`.

### Automated checks performed against this source

```bash
# Backend
cd /home/dazumi/ConnectEase_backend
npm run typecheck
TEST_DATABASE_URL=postgres://connectease@127.0.0.1:55432/connectease_test npm test

# Frontend
cd /home/dazumi/ConnectEase
npm run build
```

Current result:

- Backend TypeScript typecheck: passed
- Backend tests: **7 files, 44 tests passed**
- Frontend production build: passed

The tests cover health, registration/auth, report creation/filtering/duplicate
handling, measured test storage, stats aggregation, sync idempotency/conflicts,
validation, CORS, security headers, oversized bodies and rate limiting.

### Minimal end-to-end request sequence

```bash
BASE=http://localhost:4000/api/v1

# 1. Register an installation
curl -sS -X POST "$BASE/installations/register" \
  -H 'Content-Type: application/json' \
  -d '{"installationId":"8d1e2f3a-4b5c-4d6e-8f70-123456789abc","secret":"replace-with-a-43-char-url-safe-secret"}'

# 2. Sync a workspace record
curl -sS -X POST "$BASE/sync" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ce1.8d1e2f3a-4b5c-4d6e-8f70-123456789abc.replace-with-a-43-char-url-safe-secret' \
  -d '{
    "batchId":"0e7d1a2b-3c4d-4e5f-8a9b-0123456789ab",
    "changes":[{
      "recordId":"1a2b3c4d-5e6f-4a7b-8c9d-0123456789ab",
      "action":"create",
      "changedAt":"2026-10-23T14:00:00.000Z",
      "record":{
        "title":"Field note",
        "body":"Saved offline.",
        "category":"note",
        "pinned":false,
        "isSample":false,
        "createdAt":"2026-10-23T13:59:00.000Z",
        "updatedAt":"2026-10-23T14:00:00.000Z"
      }
    }]
  }'

# 3. Submit a report
curl -sS -X POST "$BASE/reports" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ce1.8d1e2f3a-4b5c-4d6e-8f70-123456789abc.replace-with-a-43-char-url-safe-secret' \
  -d '{"id":"3c4d5e6f-7a8b-4c9d-8e0f-123456789abc","provider":"MTN","location":"Ikeja, Lagos","issue":"Calls drop at night.","reportedAt":"2026-10-23T14:00:00.000Z"}'

# 4. Read stats
curl -sS "$BASE/stats?provider=MTN"
```

Use real generated credentials rather than the placeholder secret in any actual
environment.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser `403 FORBIDDEN` on API calls | Frontend origin missing from `CORS_ORIGINS` | Add the exact origin and restart the API |
| `401 UNAUTHORIZED` | Missing/invalid token, database was recreated, or credentials mismatch | Clear `installation-credentials` from IndexedDB or let the client re-register |
| `400 VALIDATION_ERROR` on sync | Missing `record` for create/update, `updatedAt > changedAt`, non-UUID id, unknown field, timestamp outside range | Inspect `error.details`; the frontend already builds valid payloads |
| `409 CONFLICT` on sync | `batchId` reused with a different payload | Generate a new batch id for new changes |
| Sync page says “Sync server not configured” | Production build has no `VITE_API_URL` | Set it at build time |
| Sync page says “Sync server unreachable” | API not running, wrong host/port, TLS/CORS/network issue | Check `/api/v1/health`, `VITE_API_URL`, and browser network tab |
| Reports stay “Saved offline” | Demo report, sync disabled/offline, or upload failing | Demo reports are intentionally local-only; check Sync page status |
| Stats contain unexpected rows | Database is shared; stats are public across installations | Use a separate database or filter by provider/location/date |
| `INSTALLATION_PEPPER` startup error | Missing, short, or still the example placeholder | `openssl rand -hex 32`, update `.env`, restart |
| Health returns `503` | Database unavailable or migrations not run | Check `DATABASE_URL`, start PostgreSQL, run `npm run migrate` |

---

## 11. Known limitations / current scope

These are true limitations of the current source and are documented so they are
not mistaken for backend behaviour:

1. Workspace sync is per anonymous installation, not per user account across
   multiple devices. A new installation starts with a new server workspace.
2. The UI does not yet render server-side community reports or network
   statistics. The client functions and API endpoints exist.
3. Report deletion is best-effort and online-only; there is no offline deletion
   queue. Workspace deletion does have tombstones.
4. `syncOnWifiOnly` is stored but not enforced by the current sync hook.
5. `createId()` falls back to a non-UUID string if `crypto.randomUUID` is
   unavailable. Modern secure-context browsers use UUIDs, which the API requires.
6. Network speed tests are executed by the browser against a user-supplied
   endpoint; the backend does not perform or proxy the measurement.
7. Sample/demo dashboard values and sample reports are intentionally local and
   are never presented as measured server data.

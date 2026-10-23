import type { QueryResultRow } from 'pg'
import { conflict } from '../lib/errors.js'
import { query } from '../db/pool.js'
import type { CreateNetworkTestInput } from '../schemas/network-tests.js'

interface NetworkTestRow extends QueryResultRow {
  id: string
  endpoint: string | null
  latency_ms: number | null
  download_mbps: string | null
  upload_mbps: string | null
  tested_at: Date
  error: string | null
  available: boolean
}

export interface NetworkTestDto {
  id: string
  endpoint: string | null
  latencyMs: number | null
  downloadMbps: number | null
  uploadMbps: number | null
  testedAt: string
  error: string | null
  available: boolean
  isDemo: false
}

const NETWORK_TEST_COLUMNS = 'id, endpoint, latency_ms, download_mbps, upload_mbps, tested_at, error, available'

function numericOrNull(value: string | null): number | null {
  return value === null ? null : Number(value)
}

export function toNetworkTestDto(row: NetworkTestRow): NetworkTestDto {
  return {
    id: row.id,
    endpoint: row.endpoint,
    latencyMs: row.latency_ms,
    downloadMbps: numericOrNull(row.download_mbps),
    uploadMbps: numericOrNull(row.upload_mbps),
    testedAt: row.tested_at.toISOString(),
    error: row.error,
    available: row.available,
    isDemo: false,
  }
}

export async function createNetworkTest(
  installationId: string,
  input: CreateNetworkTestInput,
): Promise<{ test: NetworkTestDto; duplicate: boolean }> {
  const inserted = await query<NetworkTestRow>(
    `INSERT INTO network_tests (
       id, installation_id, endpoint, latency_ms, download_mbps, upload_mbps,
       tested_at, error, available
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${NETWORK_TEST_COLUMNS}`,
    [
      input.id,
      installationId,
      input.endpoint,
      input.latencyMs,
      input.downloadMbps,
      input.uploadMbps,
      input.testedAt,
      input.error,
      input.available,
    ],
  )

  if (inserted.rows[0]) {
    return { test: toNetworkTestDto(inserted.rows[0]), duplicate: false }
  }

  const existing = await query<NetworkTestRow & { installation_id: string }>(
    `SELECT ${NETWORK_TEST_COLUMNS}, installation_id FROM network_tests WHERE id = $1`,
    [input.id],
  )
  const row = existing.rows[0]
  if (!row) {
    throw conflict('The network test could not be stored. Please retry.')
  }
  if (row.installation_id !== installationId) {
    throw conflict('That network test id is already in use by another installation.')
  }

  const samePayload =
    row.endpoint === input.endpoint &&
    row.latency_ms === input.latencyMs &&
    numericOrNull(row.download_mbps) === input.downloadMbps &&
    numericOrNull(row.upload_mbps) === input.uploadMbps &&
    row.tested_at.toISOString() === new Date(input.testedAt).toISOString() &&
    row.error === input.error &&
    row.available === input.available

  if (!samePayload) {
    throw conflict('That network test id was already submitted with different content.')
  }

  return { test: toNetworkTestDto(row), duplicate: true }
}

export async function listNetworkTests(
  installationId: string,
  options: { limit: number; offset: number },
) {
  const [rows, total] = await Promise.all([
    query<NetworkTestRow>(
      `SELECT ${NETWORK_TEST_COLUMNS}
       FROM network_tests
       WHERE installation_id = $1
       ORDER BY tested_at DESC, id ASC
       LIMIT $2 OFFSET $3`,
      [installationId, options.limit, options.offset],
    ),
    query<{ total: number }>(
      'SELECT count(*)::int AS total FROM network_tests WHERE installation_id = $1',
      [installationId],
    ),
  ])

  const totalCount = total.rows[0]?.total ?? 0
  return {
    data: rows.rows.map(toNetworkTestDto),
    pagination: {
      total: totalCount,
      limit: options.limit,
      offset: options.offset,
      hasMore: options.offset + rows.rows.length < totalCount,
    },
  }
}

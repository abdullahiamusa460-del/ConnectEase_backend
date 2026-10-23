import type { QueryResultRow } from 'pg'
import { conflict, notFound } from '../lib/errors.js'
import { query, withTransaction } from '../db/pool.js'
import type { CreateReportInput, ReportFilters } from '../schemas/reports.js'

interface ReportRow extends QueryResultRow {
  id: string
  provider: string
  location: string | null
  issue: string
  reported_at: Date
}

export interface ReportDto {
  id: string
  provider: string
  location: string | null
  issue: string
  reportedAt: string
  isDemo: false
}

const REPORT_COLUMNS = 'id, provider, location, issue, reported_at'

export function toReportDto(row: ReportRow): ReportDto {
  return {
    id: row.id,
    provider: row.provider,
    location: row.location,
    issue: row.issue,
    reportedAt: row.reported_at.toISOString(),
    isDemo: false,
  }
}

interface ReportWhere {
  sql: string
  values: unknown[]
}

function buildReportWhere(filters: {
  provider?: string
  location?: string
  q?: string
  from?: string
  to?: string
}): ReportWhere {
  const clauses: string[] = []
  const values: unknown[] = []

  if (filters.provider) {
    values.push(filters.provider)
    clauses.push(`provider = $${values.length}`)
  }
  if (filters.location) {
    values.push(`%${filters.location}%`)
    clauses.push(`location ILIKE $${values.length}`)
  }
  if (filters.q) {
    values.push(`%${filters.q}%`)
    const placeholder = `$${values.length}`
    clauses.push(`(issue ILIKE ${placeholder} OR location ILIKE ${placeholder} OR provider ILIKE ${placeholder})`)
  }
  if (filters.from) {
    values.push(filters.from)
    clauses.push(`reported_at >= $${values.length}`)
  }
  if (filters.to) {
    values.push(filters.to)
    clauses.push(`reported_at <= $${values.length}`)
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  }
}

export async function createReport(
  installationId: string,
  input: CreateReportInput,
): Promise<{ report: ReportDto; duplicate: boolean }> {
  const inserted = await query<ReportRow>(
    `INSERT INTO reports (id, installation_id, provider, location, issue, reported_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${REPORT_COLUMNS}`,
    [input.id, installationId, input.provider, input.location, input.issue, input.reportedAt],
  )

  if (inserted.rows[0]) {
    return { report: toReportDto(inserted.rows[0]), duplicate: false }
  }

  const existing = await query<ReportRow & { installation_id: string }>(
    `SELECT ${REPORT_COLUMNS}, installation_id FROM reports WHERE id = $1`,
    [input.id],
  )
  const row = existing.rows[0]
  if (!row) {
    throw conflict('The report could not be stored. Please retry.')
  }
  if (row.installation_id !== installationId) {
    throw conflict('That report id is already in use by another installation.')
  }

  const samePayload =
    row.provider === input.provider &&
    row.location === input.location &&
    row.issue === input.issue &&
    row.reported_at.toISOString() === new Date(input.reportedAt).toISOString()

  if (!samePayload) {
    throw conflict('That report id was already submitted with different content.')
  }

  return { report: toReportDto(row), duplicate: true }
}

export async function listReports(filters: ReportFilters) {
  const where = buildReportWhere(filters)
  const order = filters.sort === 'oldest' ? 'ASC' : 'DESC'

  const [rows, total] = await Promise.all([
    query<ReportRow>(
      `SELECT ${REPORT_COLUMNS}
       FROM reports
       ${where.sql}
       ORDER BY reported_at ${order}, id ASC
       LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
      [...where.values, filters.limit, filters.offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total FROM reports ${where.sql}`,
      where.values,
    ),
  ])

  const totalCount = total.rows[0]?.total ?? 0
  return {
    data: rows.rows.map(toReportDto),
    pagination: {
      total: totalCount,
      limit: filters.limit,
      offset: filters.offset,
      hasMore: filters.offset + rows.rows.length < totalCount,
    },
  }
}

export async function getReport(id: string): Promise<ReportDto> {
  const result = await query<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1`,
    [id],
  )
  const row = result.rows[0]
  if (!row) throw notFound('Report not found.')
  return toReportDto(row)
}

export async function deleteReport(id: string, installationId: string): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      'DELETE FROM reports WHERE id = $1 AND installation_id = $2 RETURNING id',
      [id, installationId],
    )

    if (result.rows[0]) return

    const exists = await client.query<{ installation_id: string }>(
      'SELECT installation_id FROM reports WHERE id = $1',
      [id],
    )
    const row = exists.rows[0]
    if (!row) throw notFound('Report not found.')
    throw conflict('Only the installation that submitted this report can delete it.')
  })
}

export { buildReportWhere }

import { query } from '../db/pool.js'
import type { StatsFilters } from '../schemas/stats.js'
import { buildReportWhere } from './reports.js'

interface CountRow {
  total: number
  last24h: number
  last7d: number
}

interface ProviderRow {
  provider: string
  count: number
}

interface LocationRow {
  location: string
  count: number
}

interface TestStatsRow {
  total: number
  completed: number
  unavailable: number
  avg_latency: number | null
  avg_download: number | null
  avg_upload: number | null
  p95_latency: number | null
  p50_download: number | null
  latest_tested_at: Date | null
}

export interface NetworkStatsResponse {
  generatedAt: string
  filters: {
    provider: string | null
    location: string | null
    from: string | null
    to: string | null
  }
  reports: {
    total: number
    last24h: number
    last7d: number
    lastReportedAt: string | null
    byProvider: Array<{ provider: string; count: number }>
    topLocations: Array<{ location: string; count: number }>
  }
  networkTests: {
    total: number
    completed: number
    unavailable: number
    averageLatencyMs: number | null
    averageDownloadMbps: number | null
    averageUploadMbps: number | null
    p50DownloadMbps: number | null
    p95LatencyMs: number | null
    latestTestedAt: string | null
  }
  dataSource: 'measured'
  sampleDataIncluded: false
}

function round(value: number | null, digits = 2): number | null {
  if (value === null) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function getNetworkStats(filters: StatsFilters): Promise<NetworkStatsResponse> {
  const reportWhere = buildReportWhere(filters)

  const testClauses: string[] = []
  const testValues: unknown[] = []
  if (filters.from) {
    testValues.push(filters.from)
    testClauses.push(`tested_at >= $${testValues.length}`)
  }
  if (filters.to) {
    testValues.push(filters.to)
    testClauses.push(`tested_at <= $${testValues.length}`)
  }
  const testWhere = testClauses.length > 0 ? `WHERE ${testClauses.join(' AND ')}` : ''

  const reportValues = reportWhere.values

  const [counts, byProvider, topLocations, testStats, latestReport] = await Promise.all([
    query<CountRow>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE reported_at >= now() - interval '24 hours')::int AS last24h,
         count(*) FILTER (WHERE reported_at >= now() - interval '7 days')::int AS last7d
       FROM reports ${reportWhere.sql}`,
      reportValues,
    ),
    query<ProviderRow>(
      `SELECT provider, count(*)::int AS count
       FROM reports ${reportWhere.sql}
       GROUP BY provider
       ORDER BY count DESC, provider ASC`,
      reportValues,
    ),
    query<LocationRow>(
      `SELECT location, count(*)::int AS count
       FROM reports
       ${reportWhere.sql ? `${reportWhere.sql} AND` : 'WHERE'} location IS NOT NULL
       GROUP BY location
       ORDER BY count DESC, location ASC
       LIMIT 10`,
      reportValues,
    ),
    query<TestStatsRow>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE available)::int AS completed,
         count(*) FILTER (WHERE NOT available)::int AS unavailable,
         avg(latency_ms) FILTER (WHERE available)::float8 AS avg_latency,
         avg(download_mbps) FILTER (WHERE available)::float8 AS avg_download,
         avg(upload_mbps) FILTER (WHERE available)::float8 AS avg_upload,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
           FILTER (WHERE available)::float8 AS p95_latency,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY download_mbps)
           FILTER (WHERE available)::float8 AS p50_download,
         max(tested_at) AS latest_tested_at
       FROM network_tests ${testWhere}`,
      testValues,
    ),
    query<{ latest: Date | null }>(
      `SELECT max(reported_at) AS latest FROM reports ${reportWhere.sql}`,
      reportValues,
    ),
  ])

  const countRow = counts.rows[0] ?? { total: 0, last24h: 0, last7d: 0 }
  const tests = testStats.rows[0] ?? {
    total: 0,
    completed: 0,
    unavailable: 0,
    avg_latency: null,
    avg_download: null,
    avg_upload: null,
    p95_latency: null,
    p50_download: null,
    latest_tested_at: null,
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      provider: filters.provider ?? null,
      location: filters.location ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
    reports: {
      total: countRow.total,
      last24h: countRow.last24h,
      last7d: countRow.last7d,
      lastReportedAt: latestReport.rows[0]?.latest
        ? latestReport.rows[0].latest.toISOString()
        : null,
      byProvider: byProvider.rows.map((row) => ({
        provider: row.provider,
        count: row.count,
      })),
      topLocations: topLocations.rows.map((row) => ({
        location: row.location,
        count: row.count,
      })),
    },
    networkTests: {
      total: tests.total,
      completed: tests.completed,
      unavailable: tests.unavailable,
      averageLatencyMs: round(tests.avg_latency, 1),
      averageDownloadMbps: round(tests.avg_download),
      averageUploadMbps: round(tests.avg_upload),
      p50DownloadMbps: round(tests.p50_download),
      p95LatencyMs: round(tests.p95_latency, 1),
      latestTestedAt: tests.latest_tested_at
        ? tests.latest_tested_at.toISOString()
        : null,
    },
    dataSource: 'measured',
    sampleDataIncluded: false,
  }
}

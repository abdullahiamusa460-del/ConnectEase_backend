import { describe, expect, it } from 'vitest'
import {
  app,
  authHeader,
  isoNow,
  registerInstallation,
  request,
  sampleNetworkTest,
  sampleReport,
} from './helpers.js'

describe('network statistics', () => {
  it('aggregates real reports and measured tests only', async () => {
    const installation = await registerInstallation()

    const reports = [
      sampleReport({ provider: 'MTN', location: 'Ikeja, Lagos' }),
      sampleReport({ provider: 'MTN', location: 'Yaba, Lagos' }),
      sampleReport({ provider: 'Airtel', location: 'Ikeja, Lagos' }),
    ]
    for (const report of reports) {
      await request(app)
        .post('/api/v1/reports')
        .set(authHeader(installation.token))
        .send(report)
        .expect(201)
    }

    const tests = [
      sampleNetworkTest({ latencyMs: 40, downloadMbps: 10, uploadMbps: 5 }),
      sampleNetworkTest({ latencyMs: 60, downloadMbps: 20, uploadMbps: 10 }),
      sampleNetworkTest({
        available: false,
        latencyMs: null,
        downloadMbps: null,
        uploadMbps: null,
        error: 'No route to endpoint.',
      }),
    ]
    for (const test of tests) {
      await request(app)
        .post('/api/v1/network-tests')
        .set(authHeader(installation.token))
        .send(test)
        .expect(201)
    }

    const response = await request(app).get('/api/v1/stats').expect(200)
    const stats = response.body.stats

    expect(stats.reports.total).toBe(3)
    expect(stats.reports.byProvider).toEqual([
      { provider: 'MTN', count: 2 },
      { provider: 'Airtel', count: 1 },
    ])
    expect(stats.reports.topLocations).toEqual([
      { location: 'Ikeja, Lagos', count: 2 },
      { location: 'Yaba, Lagos', count: 1 },
    ])
    expect(stats.reports.lastReportedAt).toBeTruthy()

    expect(stats.networkTests).toMatchObject({
      total: 3,
      completed: 2,
      unavailable: 1,
      averageLatencyMs: 50,
      averageDownloadMbps: 15,
      averageUploadMbps: 7.5,
    })
    expect(stats.dataSource).toBe('measured')
    expect(stats.sampleDataIncluded).toBe(false)
  })

  it('applies provider and location filters', async () => {
    const installation = await registerInstallation()
    for (const report of [
      sampleReport({ provider: 'MTN', location: 'Ikeja, Lagos' }),
      sampleReport({ provider: 'Airtel', location: 'Ikeja, Lagos' }),
      sampleReport({ provider: 'Glo', location: 'Ibadan, Oyo' }),
    ]) {
      await request(app)
        .post('/api/v1/reports')
        .set(authHeader(installation.token))
        .send(report)
        .expect(201)
    }

    const byProvider = await request(app).get('/api/v1/stats?provider=MTN').expect(200)
    expect(byProvider.body.stats.reports.total).toBe(1)

    const byLocation = await request(app)
      .get('/api/v1/stats?location=Ikeja')
      .expect(200)
    expect(byLocation.body.stats.reports.total).toBe(2)
    expect(byLocation.body.stats.reports.topLocations).toEqual([
      { location: 'Ikeja, Lagos', count: 2 },
    ])
  })

  it('applies date filters without inventing data', async () => {
    const installation = await registerInstallation()
    await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send(sampleReport())
      .expect(201)

    const old = await request(app)
      .get(`/api/v1/stats?to=${encodeURIComponent(isoNow(-60_000))}`)
      .expect(200)
    expect(old.body.stats.reports.total).toBe(0)
    expect(old.body.stats.reports.byProvider).toEqual([])
    expect(old.body.stats.networkTests.averageDownloadMbps).toBeNull()
    expect(old.body.stats.sampleDataIncluded).toBe(false)
  })

  it('returns zero/null values on an empty database', async () => {
    const response = await request(app).get('/api/v1/stats').expect(200)
    const stats = response.body.stats

    expect(stats.reports).toMatchObject({
      total: 0,
      last24h: 0,
      last7d: 0,
      lastReportedAt: null,
      byProvider: [],
      topLocations: [],
    })
    expect(stats.networkTests).toMatchObject({
      total: 0,
      completed: 0,
      unavailable: 0,
      averageLatencyMs: null,
      averageDownloadMbps: null,
      averageUploadMbps: null,
      latestTestedAt: null,
    })
    expect(stats.sampleDataIncluded).toBe(false)
  })
})

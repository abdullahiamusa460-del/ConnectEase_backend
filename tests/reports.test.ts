import { describe, expect, it } from 'vitest'
import {
  app,
  authHeader,
  isoNow,
  registerInstallation,
  request,
  sampleReport,
} from './helpers.js'

describe('network reports', () => {
  it('creates a real report and marks it as non-demo', async () => {
    const installation = await registerInstallation()
    const report = sampleReport()

    const response = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send(report)
      .expect(201)

    expect(response.body.report.id).toBe(report.id)
    expect(response.body.report.isDemo).toBe(false)
    expect(response.body.duplicate).toBe(false)
    expect(response.body.report.installationId).toBeUndefined()
  })

  it('prevents duplicate submissions from offline retries', async () => {
    const installation = await registerInstallation()
    const report = sampleReport()

    await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send(report)
      .expect(201)

    const retry = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send(report)
      .expect(200)

    expect(retry.body.duplicate).toBe(true)
    expect(retry.body.report.id).toBe(report.id)

    const list = await request(app).get('/api/v1/reports').expect(200)
    expect(list.body.pagination.total).toBe(1)
  })

  it('rejects a different payload reusing an existing report id', async () => {
    const installation = await registerInstallation()
    const report = sampleReport()

    await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send(report)
      .expect(201)

    const response = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send({ ...report, issue: 'A completely different issue description.' })
      .expect(409)

    expect(response.body.error.code).toBe('CONFLICT')
  })

  it('rejects sample/demo reports and unknown fields', async () => {
    const installation = await registerInstallation()

    const response = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send({ ...sampleReport(), isDemo: true })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(response.body.error.details)).toContain('isDemo')
  })

  it('validates report content and timestamps', async () => {
    const installation = await registerInstallation()

    const response = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send(
        sampleReport({
          provider: 'Unknown',
          issue: '',
          reportedAt: isoNow(60 * 60 * 1000),
        }),
      )
      .expect(400)

    const paths = response.body.error.details.map((detail: { path: string }) => detail.path)
    expect(paths).toContain('provider')
    expect(paths).toContain('issue')
    expect(paths).toContain('reportedAt')
  })

  it('filters public reports by provider, location and search text', async () => {
    const installation = await registerInstallation()

    const reports = [
      sampleReport({ provider: 'MTN', location: 'Ikeja, Lagos', issue: 'Slow browsing at night.' }),
      sampleReport({ provider: 'Airtel', location: 'Yaba, Lagos', issue: 'Calls keep dropping.' }),
      sampleReport({ provider: 'MTN', location: 'Wuse, Abuja', issue: 'No signal indoors.' }),
    ]

    for (const report of reports) {
      await request(app)
        .post('/api/v1/reports')
        .set(authHeader(installation.token))
        .send(report)
        .expect(201)
    }

    const byProvider = await request(app).get('/api/v1/reports?provider=MTN').expect(200)
    expect(byProvider.body.pagination.total).toBe(2)

    const byLocation = await request(app)
      .get('/api/v1/reports?location=Ikeja')
      .expect(200)
    expect(byLocation.body.pagination.total).toBe(1)
    expect(byLocation.body.data[0].id).toBe(reports[0]?.id)

    const bySearch = await request(app).get('/api/v1/reports?q=dropping').expect(200)
    expect(bySearch.body.pagination.total).toBe(1)
    expect(bySearch.body.data[0].provider).toBe('Airtel')
  })

  it('paginates results and supports date filters', async () => {
    const installation = await registerInstallation()
    const older = isoNow(-3 * 24 * 60 * 60 * 1000)

    for (let index = 0; index < 3; index += 1) {
      await request(app)
        .post('/api/v1/reports')
        .set(authHeader(installation.token))
        .send(sampleReport({ reportedAt: index === 0 ? older : isoNow(-index * 1000) }))
        .expect(201)
    }

    const page = await request(app).get('/api/v1/reports?limit=2&offset=0').expect(200)
    expect(page.body.data).toHaveLength(2)
    expect(page.body.pagination).toMatchObject({ total: 3, limit: 2, offset: 0, hasMore: true })

    const filtered = await request(app)
      .get(`/api/v1/reports?from=${encodeURIComponent(isoNow(-24 * 60 * 60 * 1000))}`)
      .expect(200)
    expect(filtered.body.pagination.total).toBe(2)
  })

  it('allows the submitting installation to delete its report', async () => {
    const installation = await registerInstallation()
    const report = sampleReport()

    await request(app)
      .post('/api/v1/reports')
      .set(authHeader(installation.token))
      .send(report)
      .expect(201)

    await request(app)
      .delete(`/api/v1/reports/${report.id}`)
      .set(authHeader(installation.token))
      .expect(204)

    await request(app).get(`/api/v1/reports/${report.id}`).expect(404)
  })

  it('does not let another installation delete a report', async () => {
    const owner = await registerInstallation()
    const other = await registerInstallation()
    const report = sampleReport()

    await request(app)
      .post('/api/v1/reports')
      .set(authHeader(owner.token))
      .send(report)
      .expect(201)

    await request(app)
      .delete(`/api/v1/reports/${report.id}`)
      .set(authHeader(other.token))
      .expect(409)
  })
})

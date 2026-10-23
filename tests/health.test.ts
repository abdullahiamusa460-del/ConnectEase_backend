import { describe, expect, it } from 'vitest'
import { app, request } from './helpers.js'

describe('health and API metadata', () => {
  it('reports database health and a request id', async () => {
    const response = await request(app).get('/api/v1/health').expect(200)

    expect(response.body.status).toBe('ok')
    expect(response.body.database).toBe('up')
    expect(response.body.service).toBe('connectease-api')
    expect(response.headers['x-request-id']).toBeTruthy()
  })

  it('returns endpoint metadata at the API root', async () => {
    const response = await request(app).get('/api/v1').expect(200)
    expect(response.body.endpoints.stats).toBe('GET /api/v1/stats')
    expect(response.body.endpoints.reports).toContain('POST')
  })

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app).get('/api/v1/does-not-exist').expect(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
    expect(response.body.error.requestId).toBeTruthy()
  })
})

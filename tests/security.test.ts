import express from 'express'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createLimiter } from '../src/middleware/rate-limit.js'
import { app, request } from './helpers.js'

describe('security middleware', () => {
  it('sets security headers and hides Express', async () => {
    const response = await request(app).get('/health').expect(200)
    expect(response.headers['x-powered-by']).toBeUndefined()
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('allows configured CORS origins and rejects others', async () => {
    const allowed = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200)
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173')

    const blocked = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example')
      .expect(403)
    expect(blocked.body.error.code).toBe('FORBIDDEN')
  })

  it('returns a safe error for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/v1/installations/register')
      .set('Content-Type', 'application/json')
      .send('{"installationId":')
      .expect(400)

    expect(response.body.error.code).toBe('BAD_REQUEST')
    expect(JSON.stringify(response.body)).not.toContain('at Object')
  })

  it('rejects oversized request bodies', async () => {
    const response = await request(app)
      .post('/api/v1/installations/register')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(70 * 1024) }))
      .expect(413)

    expect(response.body.error.code).toBe('BAD_REQUEST')
  })

  it('rate limits repeated requests', async () => {
    const mini = express()
    mini.use(express.json())
    mini.get(
      '/limited',
      createLimiter({ windowMs: 60_000, limit: 2, message: 'Slow down.' }),
      (_request, response) => {
        response.json({ ok: true })
      },
    )
    mini.use(errorHandler)

    await request(mini).get('/limited').expect(200)
    await request(mini).get('/limited').expect(200)
    const limited = await request(mini).get('/limited').expect(429)
    expect(limited.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Slow down.',
    })
  })
})

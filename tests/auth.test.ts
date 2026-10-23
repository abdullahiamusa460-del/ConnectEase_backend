import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { app, authHeader, registerInstallation, request } from './helpers.js'

describe('installation authentication', () => {
  it('registers an anonymous installation and never echoes the secret', async () => {
    const installationId = randomUUID()
    const secret = 'A'.repeat(43)

    const response = await request(app)
      .post('/api/v1/installations/register')
      .send({ installationId, secret })
      .expect(201)

    expect(response.body.installationId).toBe(installationId)
    expect(response.body.registeredAt).toBeTruthy()
    expect(JSON.stringify(response.body)).not.toContain(secret)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('is idempotent for the same id and secret', async () => {
    const installation = await registerInstallation()
    const response = await request(app)
      .post('/api/v1/installations/register')
      .send({ installationId: installation.installationId, secret: installation.secret })
      .expect(200)

    expect(response.body.installationId).toBe(installation.installationId)
  })

  it('rejects reusing an installation id with a different secret', async () => {
    const installation = await registerInstallation()
    const response = await request(app)
      .post('/api/v1/installations/register')
      .send({
        installationId: installation.installationId,
        secret: 'B'.repeat(43),
      })
      .expect(409)

    expect(response.body.error.code).toBe('CONFLICT')
  })

  it('validates registration input', async () => {
    const response = await request(app)
      .post('/api/v1/installations/register')
      .send({ installationId: 'not-a-uuid', secret: 'short', isDemo: true })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.details.length).toBeGreaterThan(0)
  })

  it('requires a valid Bearer token on protected endpoints', async () => {
    await request(app).post('/api/v1/sync').send({ batchId: randomUUID(), changes: [] }).expect(401)

    const installation = await registerInstallation()
    await request(app)
      .post('/api/v1/sync')
      .set(authHeader(`${installation.token}x`))
      .send({ batchId: randomUUID(), changes: [] })
      .expect(401)
  })
})

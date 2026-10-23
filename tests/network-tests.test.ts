import { describe, expect, it } from 'vitest'
import {
  app,
  authHeader,
  registerInstallation,
  request,
  sampleNetworkTest,
} from './helpers.js'

describe('network speed-test results', () => {
  it('stores a measured result', async () => {
    const installation = await registerInstallation()
    const test = sampleNetworkTest()

    const response = await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(installation.token))
      .send(test)
      .expect(201)

    expect(response.body.test).toMatchObject({
      id: test.id,
      latencyMs: 40,
      downloadMbps: 12.5,
      uploadMbps: 4.2,
      available: true,
      isDemo: false,
    })
  })

  it('stores an unavailable result without inventing measurements', async () => {
    const installation = await registerInstallation()
    const response = await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(installation.token))
      .send(
        sampleNetworkTest({
          available: false,
          latencyMs: null,
          downloadMbps: null,
          uploadMbps: null,
          error: 'Endpoint could not be reached.',
        }),
      )
      .expect(201)

    expect(response.body.test.downloadMbps).toBeNull()
    expect(response.body.test.available).toBe(false)
    expect(response.body.test.error).toBe('Endpoint could not be reached.')
  })

  it('rejects incomplete completed results', async () => {
    const installation = await registerInstallation()
    const response = await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(installation.token))
      .send(sampleNetworkTest({ downloadMbps: null }))
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects unavailable results without an explanation', async () => {
    const installation = await registerInstallation()
    await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(installation.token))
      .send(
        sampleNetworkTest({
          available: false,
          latencyMs: null,
          downloadMbps: null,
          uploadMbps: null,
          error: null,
        }),
      )
      .expect(400)
  })

  it('rejects attempts to submit sample measurements', async () => {
    const installation = await registerInstallation()
    const response = await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(installation.token))
      .send({ ...sampleNetworkTest(), isDemo: true })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('deduplicates offline retries by client-generated test id', async () => {
    const installation = await registerInstallation()
    const test = sampleNetworkTest()

    await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(installation.token))
      .send(test)
      .expect(201)

    const retry = await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(installation.token))
      .send(test)
      .expect(200)

    expect(retry.body.duplicate).toBe(true)
  })

  it('lists only the authenticated installation results', async () => {
    const first = await registerInstallation()
    const second = await registerInstallation()
    const test = sampleNetworkTest()

    await request(app)
      .post('/api/v1/network-tests')
      .set(authHeader(first.token))
      .send(test)
      .expect(201)

    const own = await request(app)
      .get('/api/v1/network-tests')
      .set(authHeader(first.token))
      .expect(200)
    expect(own.body.data).toHaveLength(1)

    const other = await request(app)
      .get('/api/v1/network-tests')
      .set(authHeader(second.token))
      .expect(200)
    expect(other.body.data).toHaveLength(0)
  })

  it('requires authentication to store results', async () => {
    await request(app).post('/api/v1/network-tests').send(sampleNetworkTest()).expect(401)
  })
})

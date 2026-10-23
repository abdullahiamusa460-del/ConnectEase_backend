import { randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import { app } from '../src/app.js'

export interface TestInstallation {
  installationId: string
  secret: string
  token: string
}

export async function registerInstallation(): Promise<TestInstallation> {
  const installationId = randomUUID()
  const secret = randomBytes(32).toString('base64url')

  await request(app)
    .post('/api/v1/installations/register')
    .send({ installationId, secret })
    .expect(201)

  return {
    installationId,
    secret,
    token: `ce1.${installationId}.${secret}`,
  }
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` }
}

export function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

export function sampleRecord(overrides: Record<string, unknown> = {}) {
  const now = isoNow()
  return {
    recordId: randomUUID(),
    action: 'create',
    changedAt: now,
    record: {
      title: 'Field note',
      body: 'A note saved while offline.',
      category: 'note',
      pinned: false,
      isSample: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    },
  }
}

export function sampleReport(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    provider: 'MTN',
    location: 'Ikeja, Lagos',
    issue: 'Calls drop repeatedly during the evening.',
    reportedAt: isoNow(),
    ...overrides,
  }
}

export function sampleNetworkTest(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    endpoint: 'https://example.com/speed-test',
    latencyMs: 40,
    downloadMbps: 12.5,
    uploadMbps: 4.2,
    testedAt: isoNow(),
    error: null,
    available: true,
    ...overrides,
  }
}

export { app, request }

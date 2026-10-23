import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  app,
  authHeader,
  isoNow,
  registerInstallation,
  request,
  sampleRecord,
  type TestInstallation,
} from './helpers.js'

async function sync(
  installation: TestInstallation,
  payload: { batchId?: string; changes?: unknown[] },
  expectedStatus = 200,
) {
  return request(app)
    .post('/api/v1/sync')
    .set(authHeader(installation.token))
    .send({ batchId: payload.batchId ?? randomUUID(), changes: payload.changes ?? [] })
    .expect(expectedStatus)
}

describe('offline workspace synchronisation', () => {
  it('applies a create batch and returns the server copy', async () => {
    const installation = await registerInstallation()
    const change = sampleRecord()

    const response = await sync(installation, { changes: [change] })

    expect(response.body.replayed).toBe(false)
    expect(response.body.acknowledgements[0]).toMatchObject({
      recordId: change.recordId,
      status: 'applied',
    })
    expect(response.body.records).toHaveLength(1)
    expect(response.body.records[0]).toMatchObject({
      recordId: change.recordId,
      title: 'Field note',
      isSample: false,
    })
  })

  it('replays the same batch without duplicating changes', async () => {
    const installation = await registerInstallation()
    const batchId = randomUUID()
    const change = sampleRecord()

    const first = await sync(installation, { batchId, changes: [change] })
    const second = await sync(installation, { batchId, changes: [change] })

    expect(second.body.replayed).toBe(true)
    expect(second.body.records).toEqual(first.body.records)

    const records = await request(app)
      .get('/api/v1/sync/records')
      .set(authHeader(installation.token))
      .expect(200)
    expect(records.body.records).toHaveLength(1)
  })

  it('rejects batch id reuse with a different payload', async () => {
    const installation = await registerInstallation()
    const batchId = randomUUID()
    const change = sampleRecord()

    await sync(installation, { batchId, changes: [change] })
    const response = await sync(
      installation,
      { batchId, changes: [sampleRecord()] },
      409,
    )

    expect(response.body.error.code).toBe('CONFLICT')
  })

  it('updates a record and returns the latest version', async () => {
    const installation = await registerInstallation()
    const change = sampleRecord()
    await sync(installation, { changes: [change] })

    const changedAt = isoNow(5_000)
    const update = {
      recordId: change.recordId,
      action: 'update',
      changedAt,
      record: {
        ...(change.record as Record<string, unknown>),
        title: 'Updated field note',
        updatedAt: changedAt,
      },
    }

    const response = await sync(installation, { changes: [update] })
    expect(response.body.acknowledgements[0].status).toBe('applied')
    expect(response.body.records[0].title).toBe('Updated field note')
    expect(response.body.records[0].updatedAt).toBe(changedAt)
  })

  it('keeps the server version when a stale offline edit arrives', async () => {
    const installation = await registerInstallation()
    const created = sampleRecord()
    const changedAt = isoNow(10_000)
    const serverVersion = {
      recordId: created.recordId,
      action: 'update',
      changedAt,
      record: {
        ...(created.record as Record<string, unknown>),
        title: 'Newer server title',
        updatedAt: changedAt,
      },
    }
    await sync(installation, { changes: [serverVersion] })

    const staleAt = isoNow(-60_000)
    const stale = {
      recordId: created.recordId,
      action: 'update',
      changedAt: staleAt,
      record: {
        ...(created.record as Record<string, unknown>),
        title: 'Stale offline title',
        updatedAt: staleAt,
      },
    }

    const response = await sync(installation, { changes: [stale] })
    expect(response.body.acknowledgements[0].status).toBe('conflict')
    expect(response.body.records[0].title).toBe('Newer server title')
  })

  it('creates a tombstone for deletes and is idempotent', async () => {
    const installation = await registerInstallation()
    const change = sampleRecord()
    await sync(installation, { changes: [change] })

    const changedAt = isoNow(5_000)
    const deletion = { recordId: change.recordId, action: 'delete', changedAt }

    const first = await sync(installation, { changes: [deletion] })
    const second = await sync(installation, { changes: [deletion] })

    expect(first.body.records).toHaveLength(0)
    expect(first.body.tombstones).toEqual([
      { recordId: change.recordId, deletedAt: changedAt },
    ])
    expect(second.body.tombstones).toEqual(first.body.tombstones)
  })

  it('supports pull-only sync and incremental record fetches', async () => {
    const installation = await registerInstallation()
    const first = sampleRecord()
    await sync(installation, { changes: [first] })

    const pulled = await sync(installation, { changes: [] })
    expect(pulled.body.records).toHaveLength(1)

    const since = isoNow()
    await new Promise((resolve) => setTimeout(resolve, 5))

    const second = sampleRecord()
    await sync(installation, { changes: [second] })

    const incremental = await request(app)
      .get(`/api/v1/sync/records?since=${encodeURIComponent(since)}`)
      .set(authHeader(installation.token))
      .expect(200)
    expect(incremental.body.records.map((record: { recordId: string }) => record.recordId)).toEqual([
      second.recordId,
    ])
  })

  it('isolates workspace data between installations', async () => {
    const first = await registerInstallation()
    const second = await registerInstallation()

    await sync(first, { changes: [sampleRecord()] })
    const other = await sync(second, { changes: [] })

    expect(other.body.records).toHaveLength(0)
  })

  it('validates batch shape, record content and batch size', async () => {
    const installation = await registerInstallation()

    const missingRecord = await sync(
      installation,
      { changes: [{ recordId: randomUUID(), action: 'create', changedAt: isoNow() }] },
      400,
    )
    expect(missingRecord.body.error.code).toBe('VALIDATION_ERROR')

    const unknownField = await sync(
      installation,
      { changes: [{ ...sampleRecord(), isDemo: true }] },
      400,
    )
    expect(unknownField.body.error.code).toBe('VALIDATION_ERROR')

    const tooMany = await sync(
      installation,
      { changes: Array.from({ length: 201 }, () => sampleRecord()) },
      400,
    )
    expect(tooMany.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('requires authentication', async () => {
    await request(app)
      .post('/api/v1/sync')
      .send({ batchId: randomUUID(), changes: [] })
      .expect(401)
  })
})

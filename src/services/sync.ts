import type { PoolClient, QueryResultRow } from 'pg'
import { withTransaction } from '../db/pool.js'
import { conflict, notFound } from '../lib/errors.js'
import type { SyncChangeInput, SyncRequestInput } from '../schemas/sync.js'
import { hashRequest } from './installations.js'

interface WorkspaceRecordRow extends QueryResultRow {
  record_id: string
  title: string
  body: string
  category: string
  pinned: boolean
  is_sample: boolean
  client_created_at: Date
  client_updated_at: Date
  deleted_at: Date | null
}

export interface SyncedRecord {
  recordId: string
  title: string
  body: string
  category: string
  pinned: boolean
  isSample: boolean
  createdAt: string
  updatedAt: string
}

export interface Tombstone {
  recordId: string
  deletedAt: string
}

interface Acknowledgement {
  recordId: string
  action: SyncChangeInput['action']
  status: 'applied' | 'conflict'
  changedAt: string
  serverUpdatedAt?: string
}

export interface SyncResponse {
  batchId: string
  replayed: boolean
  acknowledgements: Acknowledgement[]
  records: SyncedRecord[]
  tombstones: Tombstone[]
  serverTime: string
}

const WORKSPACE_COLUMNS = `
  record_id, title, body, category, pinned, is_sample,
  client_created_at, client_updated_at, deleted_at
`

function toRecord(row: WorkspaceRecordRow): SyncedRecord {
  return {
    recordId: row.record_id,
    title: row.title,
    body: row.body,
    category: row.category,
    pinned: row.pinned,
    isSample: row.is_sample,
    createdAt: row.client_created_at.toISOString(),
    updatedAt: row.client_updated_at.toISOString(),
  }
}

function toTombstone(row: WorkspaceRecordRow): Tombstone {
  return {
    recordId: row.record_id,
    deletedAt: (row.deleted_at ?? row.client_updated_at).toISOString(),
  }
}

async function fetchWorkspace(
  client: PoolClient,
  installationId: string,
  since?: string,
): Promise<{ records: SyncedRecord[]; tombstones: Tombstone[] }> {
  const values: unknown[] = [installationId]
  let where = 'installation_id = $1'
  if (since) {
    values.push(since)
    where += ` AND client_updated_at > $${values.length}`
  }

  const result = await client.query<WorkspaceRecordRow>(
    `SELECT ${WORKSPACE_COLUMNS} FROM workspace_records WHERE ${where}
     ORDER BY client_updated_at ASC, record_id ASC`,
    values,
  )

  return {
    records: result.rows.filter((row) => row.deleted_at === null).map(toRecord),
    tombstones: result.rows.filter((row) => row.deleted_at !== null).map(toTombstone),
  }
}

async function applyChange(
  client: PoolClient,
  installationId: string,
  change: SyncChangeInput,
): Promise<Acknowledgement> {
  const existingResult = await client.query<WorkspaceRecordRow>(
    `SELECT ${WORKSPACE_COLUMNS}
     FROM workspace_records
     WHERE installation_id = $1 AND record_id = $2
     FOR UPDATE`,
    [installationId, change.recordId],
  )
  const existing = existingResult.rows[0]
  const changedAt = new Date(change.changedAt)

  if (change.action === 'delete') {
    if (!existing) {
      await client.query(
        `INSERT INTO workspace_records (
           installation_id, record_id, title, body, category, pinned, is_sample,
           client_created_at, client_updated_at, deleted_at
         ) VALUES ($1, $2, '', '', 'note', false, false, $3, $3, $3)`,
        [installationId, change.recordId, changedAt],
      )
      return {
        recordId: change.recordId,
        action: change.action,
        status: 'applied',
        changedAt: change.changedAt,
      }
    }

    if (changedAt.getTime() < existing.client_updated_at.getTime()) {
      return {
        recordId: change.recordId,
        action: change.action,
        status: 'conflict',
        changedAt: change.changedAt,
        serverUpdatedAt: existing.client_updated_at.toISOString(),
      }
    }

    await client.query(
      `UPDATE workspace_records
       SET deleted_at = $3, client_updated_at = $3, server_updated_at = now()
       WHERE installation_id = $1 AND record_id = $2`,
      [installationId, change.recordId, changedAt],
    )
    return {
      recordId: change.recordId,
      action: change.action,
      status: 'applied',
      changedAt: change.changedAt,
    }
  }

  const record = change.record
  if (!record) {
    throw conflict('Create and update changes must include a record.')
  }

  if (existing && changedAt.getTime() < existing.client_updated_at.getTime()) {
    return {
      recordId: change.recordId,
      action: change.action,
      status: 'conflict',
      changedAt: change.changedAt,
      serverUpdatedAt: existing.client_updated_at.toISOString(),
    }
  }

  await client.query(
    `INSERT INTO workspace_records (
       installation_id, record_id, title, body, category, pinned, is_sample,
       client_created_at, client_updated_at, deleted_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
     ON CONFLICT (installation_id, record_id) DO UPDATE
     SET title = EXCLUDED.title,
         body = EXCLUDED.body,
         category = EXCLUDED.category,
         pinned = EXCLUDED.pinned,
         is_sample = EXCLUDED.is_sample,
         client_created_at = EXCLUDED.client_created_at,
         client_updated_at = EXCLUDED.client_updated_at,
         deleted_at = NULL,
         server_updated_at = now()`,
    [
      installationId,
      change.recordId,
      record.title,
      record.body,
      record.category,
      record.pinned,
      record.isSample,
      new Date(record.createdAt),
      changedAt,
    ],
  )

  return {
    recordId: change.recordId,
    action: change.action,
    status: 'applied',
    changedAt: change.changedAt,
  }
}

export async function syncWorkspace(
  installationId: string,
  input: SyncRequestInput,
): Promise<SyncResponse> {
  const requestHash = hashRequest(input)

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      installationId,
    ])

    const batch = await client.query<{ request_hash: string; response: SyncResponse }>(
      'SELECT request_hash, response FROM sync_batches WHERE installation_id = $1 AND batch_id = $2',
      [installationId, input.batchId],
    )
    const storedBatch = batch.rows[0]

    if (storedBatch) {
      if (storedBatch.request_hash !== requestHash) {
        throw conflict(
          'This batchId was already used with a different payload. Use a new batchId for new changes.',
        )
      }
      return { ...storedBatch.response, replayed: true }
    }

    const acknowledgements: Acknowledgement[] = []
    for (const change of input.changes) {
      acknowledgements.push(await applyChange(client, installationId, change))
    }

    const workspace = await fetchWorkspace(client, installationId)
    const serverTime = new Date().toISOString()
    const response: SyncResponse = {
      batchId: input.batchId,
      replayed: false,
      acknowledgements,
      records: workspace.records,
      tombstones: workspace.tombstones,
      serverTime,
    }

    await client.query(
      `INSERT INTO sync_batches (installation_id, batch_id, request_hash, response)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [installationId, input.batchId, requestHash, JSON.stringify(response)],
    )

    return response
  })
}

export async function getWorkspaceRecords(
  installationId: string,
  since?: string,
): Promise<{ records: SyncedRecord[]; tombstones: Tombstone[]; serverTime: string }> {
  return withTransaction(async (client) => {
    const exists = await client.query('SELECT 1 FROM installations WHERE id = $1', [
      installationId,
    ])
    if (!exists.rows[0]) throw notFound('Installation not found.')

    const workspace = await fetchWorkspace(client, installationId, since)
    return {
      ...workspace,
      serverTime: new Date().toISOString(),
    }
  })
}

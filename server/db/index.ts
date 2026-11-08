import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

// The office database: a pg pool plus a small forward-only migration runner. Migrations are the
// numbered .sql files next to this module; each runs once, inside a transaction.

export type Db = pg.Pool
export type Queryable = pg.Pool | pg.PoolClient

// Migrations live in server/db/migrations; the build copies nothing, so a built server reads them
// from the source tree that ships with it.
const MIGRATION_DIRS = [new URL('./migrations', import.meta.url), new URL('../../../server/db/migrations', import.meta.url)]
  .map((url) => fileURLToPath(url))

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 })
}

export async function migrate(db: Db): Promise<string[]> {
  const dir = MIGRATION_DIRS.find((candidate) => existsSync(candidate))
  if (!dir) throw new Error('Folder migrasi server/db/migrations tidak ditemukan.')
  const client = await db.connect()
  try {
    // One migrator at a time, even if two servers start together.
    await client.query('SELECT pg_advisory_lock(7234001)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name))
    const applied: string[] = []
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
      if (done.has(name)) continue
      await client.query('BEGIN')
      try {
        await client.query(readFileSync(`${dir}/${name}`, 'utf8'))
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
        applied.push(name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migrasi ${name} gagal: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return applied
  } finally {
    await client.query('SELECT pg_advisory_unlock(7234001)').catch(() => undefined)
    client.release()
  }
}

/** Runs work in one transaction; it rolls back if the work throws. */
export async function transaction<T>(db: Db, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

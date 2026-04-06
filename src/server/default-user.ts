import { eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { users } from '../db/schema'

export const DEFAULT_USER = {
  id: 'local-user',
  email: 'local@pending.app',
  displayName: 'Local User',
  timezone: 'UTC',
} as const

export async function ensureDefaultUser(database: Database) {
  const existing = await database.query.users.findFirst({
    where: eq(users.id, DEFAULT_USER.id),
  })

  if (existing) {
    return existing
  }

  await database.insert(users).values(DEFAULT_USER).onConflictDoNothing()

  const created = await database.query.users.findFirst({
    where: eq(users.id, DEFAULT_USER.id),
  })

  if (!created) {
    throw new Error('Failed to initialize the local user')
  }

  return created
}

import { describe, expect, it, vi } from 'vitest'

describe('env defaults', () => {
  it('provides a default app name', async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:local.db'
    vi.resetModules()

    const { env } = await import('./env')

    expect(env.VITE_APP_NAME).toBeTruthy()
  })
})

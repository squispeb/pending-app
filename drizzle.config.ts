import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ quiet: true })

const databaseUrl = process.env.DATABASE_URL ?? 'file:local.db'
const isRemoteTurso =
  databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('https://')

export default defineConfig({
  schema: './src/db/schema/**/*.ts',
  out: './drizzle',
  dialect: isRemoteTurso ? 'turso' : 'sqlite',
  dbCredentials: {
    url: databaseUrl,
    ...(isRemoteTurso && process.env.DATABASE_AUTH_TOKEN
      ? { authToken: process.env.DATABASE_AUTH_TOKEN }
      : {}),
  },
})

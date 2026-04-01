import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1).default('file:local.db'),
    DATABASE_AUTH_TOKEN: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().optional(),
    SESSION_SECRET: z.string().optional(),
  },
  clientPrefix: 'VITE_',
  client: {
    VITE_APP_NAME: z.string().min(1).default('Pending App'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    SESSION_SECRET: process.env.SESSION_SECRET,
    VITE_APP_NAME: import.meta.env.VITE_APP_NAME,
  },
  emptyStringAsUndefined: true,
})

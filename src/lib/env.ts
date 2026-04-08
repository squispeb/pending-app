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
    CAPTURE_INTERPRETATION_API_URL: z.string().url().optional(),
    CAPTURE_INTERPRETATION_API_KEY: z.string().optional(),
    CAPTURE_INTERPRETATION_MODEL: z.string().optional(),
    CAPTURE_INTERPRETATION_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(10000),
    TRANSCRIPTION_SERVICE_URL: z.string().url().optional(),
    TRANSCRIPTION_SERVICE_TOKEN: z.string().optional(),
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
    CAPTURE_INTERPRETATION_API_URL: process.env.CAPTURE_INTERPRETATION_API_URL,
    CAPTURE_INTERPRETATION_API_KEY: process.env.CAPTURE_INTERPRETATION_API_KEY,
    CAPTURE_INTERPRETATION_MODEL: process.env.CAPTURE_INTERPRETATION_MODEL,
    CAPTURE_INTERPRETATION_TIMEOUT_MS: process.env.CAPTURE_INTERPRETATION_TIMEOUT_MS,
    TRANSCRIPTION_SERVICE_URL: process.env.TRANSCRIPTION_SERVICE_URL,
    TRANSCRIPTION_SERVICE_TOKEN: process.env.TRANSCRIPTION_SERVICE_TOKEN,
    VITE_APP_NAME: import.meta.env.VITE_APP_NAME,
  },
  emptyStringAsUndefined: true,
})

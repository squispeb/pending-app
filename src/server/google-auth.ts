import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { env } from '../lib/env'

const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000

type GoogleStatePayload = {
  userId: string
  nonce: string
  exp: number
}

export function getGoogleConfigStatus() {
  const missing = [
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET],
    ['GOOGLE_REDIRECT_URI', env.GOOGLE_REDIRECT_URI],
    ['SESSION_SECRET', env.SESSION_SECRET],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  return {
    ready: missing.length === 0,
    missing,
  }
}

export function createGoogleState(userId: string) {
  const status = getGoogleConfigStatus()
  if (!status.ready || !env.SESSION_SECRET) {
    throw new Error(`Google Calendar is not configured. Missing: ${status.missing.join(', ')}`)
  }

  const payload: GoogleStatePayload = {
    userId,
    nonce: randomUUID(),
    exp: Date.now() + GOOGLE_STATE_TTL_MS,
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', env.SESSION_SECRET).update(encodedPayload).digest('base64url')

  return `${encodedPayload}.${signature}`
}

export function verifyGoogleState(state: string) {
  const status = getGoogleConfigStatus()
  if (!status.ready || !env.SESSION_SECRET) {
    throw new Error(`Google Calendar is not configured. Missing: ${status.missing.join(', ')}`)
  }

  const [encodedPayload, signature] = state.split('.')
  if (!encodedPayload || !signature) {
    throw new Error('Invalid Google OAuth state')
  }

  const expected = createHmac('sha256', env.SESSION_SECRET).update(encodedPayload).digest('base64url')
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid Google OAuth state signature')
  }

  let payload: GoogleStatePayload

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid Google OAuth state payload')
  }

  if (!payload.userId || !payload.exp) {
    throw new Error('Invalid Google OAuth state payload')
  }

  if (payload.exp <= Date.now()) {
    throw new Error('Google OAuth state has expired. Try connecting again.')
  }

  return payload
}

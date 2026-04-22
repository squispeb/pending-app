import { useEffect, useState } from 'react'

const DEFAULT_TIME_ZONE = 'UTC'

function toDate(value: Date | string | number) {
  return typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
}

function getDisplayDateTimeFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  })
}

export function getClientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
}

export function useClientTimeZone() {
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE)

  useEffect(() => {
    setTimeZone(getClientTimeZone())
  }, [])

  return timeZone
}

export function formatDisplayDateTime(value: Date | string | number, timeZone = DEFAULT_TIME_ZONE) {
  return getDisplayDateTimeFormatter(timeZone).format(toDate(value))
}

export function formatDisplayDate(value: Date | string | number, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(toDate(value))
}

export function formatDisplayTime(value: Date | string | number, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(toDate(value))
}

export { DEFAULT_TIME_ZONE }

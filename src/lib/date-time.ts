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
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone,
    }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)))
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(toDate(value))
}

export function formatDisplayTime(value: Date | string | number, timeZone = DEFAULT_TIME_ZONE) {
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
    const [hours, minutes] = value.split(':').map(Number)
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes, 0, 0)))
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(toDate(value))
}

export { DEFAULT_TIME_ZONE }

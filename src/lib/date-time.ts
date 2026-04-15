const displayDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export function formatDisplayDateTime(value: Date | string | number) {
  return displayDateTimeFormatter.format(typeof value === 'string' || typeof value === 'number' ? new Date(value) : value)
}

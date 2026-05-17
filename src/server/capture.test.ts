import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCaptureCalendarActions } from './capture-calendar-actions'

const db = {
  query: {
    calendarEvents: {
      findFirst: vi.fn(),
    },
  },
}

const createGoogleCalendarEvent = vi.fn()
const deleteCalendarEvent = vi.fn()
const resolveUser = vi.fn()
const updateCalendarEvent = vi.fn()

const captureCalendarActions = createCaptureCalendarActions({
  database: db as never,
  calendarService: {
    deleteCalendarEvent,
    updateCalendarEvent,
  },
  resolveUser,
  createGoogleCalendarEvent,
})

beforeEach(() => {
  createGoogleCalendarEvent.mockReset()
  createGoogleCalendarEvent.mockResolvedValue({ ok: true })
  deleteCalendarEvent.mockReset()
  updateCalendarEvent.mockReset()
  resolveUser.mockReset()
  resolveUser.mockResolvedValue({ user: { id: 'user-1' } })
  db.query.calendarEvents.findFirst.mockReset()
})

describe('capture server confirm handlers', () => {
  it('confirms a voice calendar event create request', async () => {
    const result = await captureCalendarActions.confirmVoiceCalendarEventCreate({
      timezone: 'America/Lima',
      draft: {
        title: 'Team sync',
        description: 'Weekly planning',
        location: 'Room 1',
        startDate: '2026-04-08',
        allDay: true,
      },
    })

    expect(resolveUser).toHaveBeenCalledOnce()
    expect(createGoogleCalendarEvent).toHaveBeenCalledWith({
      data: {
        calendarId: 'primary',
        event: {
          summary: 'Team sync',
          description: 'Weekly planning',
          location: 'Room 1',
          start: { date: '2026-04-08' },
          end: { date: '2026-04-09' },
        },
      },
    })
    expect(result).toEqual({ ok: true })
  })

  it('confirms an edit voice calendar event action', async () => {
    db.query.calendarEvents.findFirst.mockResolvedValue({
      calendarId: 'calendar-1',
      startsAt: new Date('2026-04-08T19:00:00.000Z'),
      endsAt: new Date('2026-04-08T20:00:00.000Z'),
      allDay: false,
      summary: 'Old title',
      description: 'Old description',
      location: 'Old location',
      eventTimezone: 'America/Lima',
      googleEventId: 'google-event-1',
    })

    const result = await captureCalendarActions.confirmVoiceCalendarEventAction({
      calendarEvent: {
        operation: 'edit_calendar_event',
        target: {
          calendarEventId: 'event-1',
          summary: 'Old title',
        },
        title: 'Updated title',
        description: 'Updated description',
        location: 'Office',
        startDate: '2026-04-08',
        startTime: '14:00',
        endDate: '2026-04-08',
        endTime: '15:00',
        allDay: false,
      },
    })

    expect(resolveUser).toHaveBeenCalledOnce()
    expect(db.query.calendarEvents.findFirst).toHaveBeenCalledTimes(1)
    expect(updateCalendarEvent).toHaveBeenCalledWith('user-1', 'calendar-1', 'google-event-1', {
      summary: 'Updated title',
      description: 'Updated description',
      location: 'Office',
      start: {
        dateTime: '2026-04-08T14:00:00',
        timeZone: 'America/Lima',
      },
      end: {
        dateTime: '2026-04-08T15:00:00',
        timeZone: 'America/Lima',
      },
    })
    expect(result).toBeUndefined()
  })

  it('uses an exclusive next-day end for all-day edit confirmations', async () => {
    db.query.calendarEvents.findFirst.mockResolvedValue({
      calendarId: 'calendar-1',
      startsAt: new Date('2026-04-08T00:00:00.000Z'),
      endsAt: new Date('2026-04-09T00:00:00.000Z'),
      allDay: true,
      summary: 'All-day event',
      description: null,
      location: null,
      eventTimezone: 'America/Lima',
      googleEventId: 'google-event-1',
    })

    await captureCalendarActions.confirmVoiceCalendarEventAction({
      calendarEvent: {
        operation: 'edit_calendar_event',
        target: {
          calendarEventId: 'event-1',
          summary: 'All-day event',
        },
        title: 'All-day event',
        startDate: '2026-04-08',
        endDate: '2026-04-08',
        allDay: true,
      },
    })

    expect(updateCalendarEvent).toHaveBeenCalledWith('user-1', 'calendar-1', 'google-event-1', {
      summary: 'All-day event',
      description: null,
      location: null,
      start: { date: '2026-04-08' },
      end: { date: '2026-04-09' },
    })
  })

  it('preserves existing event fields for an end-time-only edit', async () => {
    db.query.calendarEvents.findFirst.mockResolvedValue({
      calendarId: 'calendar-1',
      startsAt: new Date('2026-05-18T17:00:00.000Z'),
      endsAt: new Date('2026-05-18T18:00:00.000Z'),
      allDay: false,
      summary: 'Lunch',
      description: 'Team lunch',
      location: 'Cafe',
      eventTimezone: 'America/Lima',
      googleEventId: 'google-event-1',
    })

    await captureCalendarActions.confirmVoiceCalendarEventAction({
      calendarEvent: {
        operation: 'edit_calendar_event',
        target: {
          calendarEventId: 'event-1',
          summary: 'Lunch',
        },
        endTime: '13:30',
      },
    })

    expect(updateCalendarEvent).toHaveBeenCalledWith('user-1', 'calendar-1', 'google-event-1', {
      summary: 'Lunch',
      description: 'Team lunch',
      location: 'Cafe',
      start: {
        dateTime: '2026-05-18T12:00:00',
        timeZone: 'America/Lima',
      },
      end: {
        dateTime: '2026-05-18T13:30:00',
        timeZone: 'America/Lima',
      },
    })
  })

  it('confirms a cancel voice calendar event action', async () => {
    db.query.calendarEvents.findFirst.mockResolvedValue({
      calendarId: 'calendar-1',
      startsAt: new Date('2026-04-08T19:00:00.000Z'),
      endsAt: new Date('2026-04-08T20:00:00.000Z'),
      allDay: false,
      summary: 'Old title',
      description: null,
      location: null,
      eventTimezone: 'America/Lima',
      googleEventId: 'google-event-1',
    })

    const result = await captureCalendarActions.confirmVoiceCalendarEventAction({
      calendarEvent: {
        operation: 'cancel_calendar_event',
        target: {
          calendarEventId: 'event-1',
          summary: 'Old title',
        },
      },
    })

    expect(resolveUser).toHaveBeenCalledOnce()
    expect(db.query.calendarEvents.findFirst).toHaveBeenCalledTimes(1)
    expect(deleteCalendarEvent).toHaveBeenCalledWith('user-1', 'calendar-1', 'google-event-1')
    expect(result).toBeUndefined()
  })
})

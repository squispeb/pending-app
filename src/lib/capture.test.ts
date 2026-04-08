import { describe, expect, it } from 'vitest'
import {
  buildHeuristicTaskDraft,
  inferCadenceFromInput,
  inferDueDateFromInput,
  inferPriorityFromInput,
  mergeTypedTaskDrafts,
  normalizeCaptureInput,
  typedTaskDraftSchema,
} from './capture'

describe('capture helpers', () => {
  it('normalizes whitespace before interpretation', () => {
    expect(normalizeCaptureInput('  Tengo   que   entregar  algo  ')).toBe('Tengo que entregar algo')
  })

  it('maps urgency phrases to high priority', () => {
    expect(inferPriorityFromInput('Tengo que resolverlo lo antes posible')).toBe('high')
    expect(inferPriorityFromInput('Please do this ASAP')).toBe('high')
  })

  it('infers tomorrow and next sunday due dates', () => {
    expect(inferDueDateFromInput('Comprar focos mañana', '2026-04-08', 'America/Lima')).toBe('2026-04-09')
    expect(
      inferDueDateFromInput('Entregarlo el domingo que viene', '2026-04-08', 'America/Lima'),
    ).toBe('2026-04-12')
  })

  it('uses the provided timezone contract and rejects invalid timezones', () => {
    expect(() => inferDueDateFromInput('Comprar focos mañana', '2026-04-08', 'Invalid/Zone')).toThrow(
      'Invalid timezone: Invalid/Zone',
    )
  })

  it('builds a heuristic draft with notes and title fallback', () => {
    const draft = buildHeuristicTaskDraft({
      rawInput:
        'Tengo que entregar para el domingo que viene la primera tarea del curso Cloud Computing, en este tengo que resolverlo lo antes posible.',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    expect(draft.title).toBe('entregar para el domingo que viene la primera tarea del curso Cloud Computing')
    expect(draft.dueDate).toBe('2026-04-12')
    expect(draft.priority).toBe('high')
    expect(draft.candidateType).toBe('task')
    expect(draft.interpretationNotes).toContain(
      "Interpreted 'domingo que viene' as the next upcoming Sunday.",
    )
  })

  it('detects recurring intent and extracts cadence for habit candidates', () => {
    expect(inferCadenceFromInput('Meditar cada día antes de dormir')).toEqual({
      candidateType: 'habit',
      cadenceType: 'daily',
      cadenceDays: [],
      targetCount: 1,
    })

    expect(inferCadenceFromInput('Hacer ejercicio cada lunes y jueves')).toEqual({
      candidateType: 'habit',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'thu'],
      targetCount: 1,
    })
  })

  it('merges provider values over heuristics while keeping notes', () => {
    const heuristicDraft = buildHeuristicTaskDraft({
      rawInput: 'Need to deal with taxes tomorrow',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    const merged = mergeTypedTaskDrafts(heuristicDraft, {
      title: 'Deal with taxes',
      notes: 'Prepare and submit tax paperwork.',
      dueDate: '2026-04-09',
      candidateType: 'task',
      matchedCalendarContext: {
        calendarEventId: 'evt-1',
        summary: 'Cloud Computing',
        reason: 'Matched recurring event: Cloud Computing',
      },
      interpretationNotes: ['Provider inferred a cleaner task title.'],
    })

    expect(merged.title).toBe('Deal with taxes')
    expect(merged.notes).toBe('Prepare and submit tax paperwork.')
    expect(merged.matchedCalendarContext).toEqual({
      calendarEventId: 'evt-1',
      summary: 'Cloud Computing',
      reason: 'Matched recurring event: Cloud Computing',
    })
    expect(merged.interpretationNotes).toContain('Provider inferred a cleaner task title.')
    expect(() => typedTaskDraftSchema.parse(merged)).not.toThrow()
  })

  it('allows provider habit output with cadence extraction', () => {
    const heuristicDraft = buildHeuristicTaskDraft({
      rawInput: 'Meditar cada lunes y jueves',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    const merged = mergeTypedTaskDrafts(heuristicDraft, {
      candidateType: 'habit',
      title: 'Meditar',
      cadenceType: 'selected_days',
      cadenceDays: ['mon', 'thu'],
      targetCount: 1,
      interpretationNotes: ['Detected recurring cadence from weekdays.'],
    })

    expect(merged.candidateType).toBe('habit')
    expect(merged.cadenceType).toBe('selected_days')
    expect(merged.cadenceDays).toEqual(['mon', 'thu'])
    expect(merged.targetCount).toBe(1)
  })
})

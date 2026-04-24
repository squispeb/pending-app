import { describe, expect, it } from 'vitest'
import {
  buildVoiceClarificationMessage,
  buildVoiceClarificationQuestions,
  buildHeuristicTaskDraft,
  evaluateVoiceCaptureConfidence,
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

  it('infers this friday, next week, and explicit numeric dates', () => {
    expect(inferDueDateFromInput('Terminar informe este viernes', '2026-04-08', 'America/Lima')).toBe(
      '2026-04-10',
    )
    expect(inferDueDateFromInput('Planificarlo next week', '2026-04-08', 'America/Lima')).toBe(
      '2026-04-13',
    )
    expect(inferDueDateFromInput('Agendarlo para 2026-05-15', '2026-04-08', 'America/Lima')).toBe(
      '2026-05-15',
    )
    expect(inferDueDateFromInput('Agendarlo para 5/15/2026', '2026-04-08', 'America/Lima')).toBe(
      '2026-05-15',
    )
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

    expect(draft.title).toBe('entregar la primera tarea del curso Cloud Computing')
    expect(draft.dueDate).toBe('2026-04-12')
    expect(draft.priority).toBe('high')
    expect(draft.candidateType).toBe('task')
    expect(draft.notes).toBe(
      'Tengo que entregar para el domingo que viene la primera tarea del curso Cloud Computing, en este tengo que resolverlo lo antes posible.',
    )
    expect(draft.interpretationNotes).toContain(
      "Interpreted 'domingo que viene' as the next upcoming Sunday.",
    )
  })

  it('preserves multiline checklist structure in heuristic notes', () => {
    const draft = buildHeuristicTaskDraft({
      rawInput: 'Preparar entrega de Cloud Computing\n1. Revisar rúbrica\n2. Terminar informe\n3. Subir PDF el jueves',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    expect(draft.title).toBe('Preparar entrega de Cloud Computing')
    expect(draft.notes).toBe(
      'Preparar entrega de Cloud Computing\n1. Revisar rúbrica\n2. Terminar informe\n3. Subir PDF el jueves',
    )
  })

  it('strips more leading intent language and date phrasing from heuristic titles', () => {
    const draft = buildHeuristicTaskDraft({
      rawInput: 'Voy a planificar presupuesto para next week',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    expect(draft.title).toBe('planificar presupuesto')
    expect(draft.notes).toBe('Voy a planificar presupuesto para next week')
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

  it('keeps fuller heuristic notes when provider notes are shorter', () => {
    const heuristicDraft = buildHeuristicTaskDraft({
      rawInput: 'Preparar entrega de Cloud Computing\n1. Revisar rúbrica\n2. Terminar informe\n3. Subir PDF el jueves',
      currentDate: '2026-04-08',
      timezone: 'America/Lima',
    })

    const merged = mergeTypedTaskDrafts(heuristicDraft, {
      title: 'Preparar entrega de Cloud Computing',
      notes: 'Terminar entrega del curso.',
      candidateType: 'task',
      interpretationNotes: ['Provider rewrote the task more concisely.'],
    })

    expect(merged.notes).toBe(
      'Preparar entrega de Cloud Computing\n1. Revisar rúbrica\n2. Terminar informe\n3. Subir PDF el jueves',
    )
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

  it('evaluates high and review confidence for voice capture', () => {
    const highConfidenceDraft = typedTaskDraftSchema.parse({
      rawInput: 'Comprar focos para la sala mañana.',
      normalizedInput: 'Comprar focos para la sala mañana.',
      candidateType: 'task',
      title: 'Comprar focos para la sala',
      notes: null,
      dueDate: '2026-04-09',
      dueTime: null,
      priority: null,
      estimatedMinutes: null,
      cadenceType: null,
      cadenceDays: [],
      targetCount: null,
      matchedCalendarContext: null,
      preferredStartTime: null,
      preferredEndTime: null,
      interpretationNotes: [],
    })

    const reviewDraft = typedTaskDraftSchema.parse({
      ...highConfidenceDraft,
      title: null,
      interpretationNotes: ['Could not infer a short task title.'],
    })

    expect(evaluateVoiceCaptureConfidence(highConfidenceDraft, highConfidenceDraft.rawInput)).toBe('high')
    expect(evaluateVoiceCaptureConfidence(reviewDraft, reviewDraft.rawInput)).toBe('review')
  })

  it('requires clarification for task candidates without a due date', () => {
    const taskWithoutDueDate = typedTaskDraftSchema.parse({
      rawInput: 'Comprar focos para la sala.',
      normalizedInput: 'Comprar focos para la sala.',
      candidateType: 'task',
      title: 'Comprar focos para la sala',
      notes: null,
      dueDate: null,
      dueTime: null,
      priority: null,
      estimatedMinutes: null,
      cadenceType: null,
      cadenceDays: [],
      targetCount: null,
      matchedCalendarContext: null,
      preferredStartTime: null,
      preferredEndTime: null,
      interpretationNotes: [],
    })

    expect(evaluateVoiceCaptureConfidence(taskWithoutDueDate, taskWithoutDueDate.rawInput)).toBe('clarify')
    expect(buildVoiceClarificationQuestions(taskWithoutDueDate, taskWithoutDueDate.rawInput)).toContain(
      'When do you want to do it?',
    )
  })

  it('builds a clarification message for very weak voice captures', () => {
    const weakDraft = typedTaskDraftSchema.parse({
      rawInput: 'ehh',
      normalizedInput: 'ehh',
      candidateType: 'task',
      title: null,
      notes: null,
      dueDate: null,
      dueTime: null,
      priority: null,
      estimatedMinutes: null,
      cadenceType: null,
      cadenceDays: [],
      targetCount: null,
      matchedCalendarContext: null,
      preferredStartTime: null,
      preferredEndTime: null,
      interpretationNotes: ['Could not infer a short task title.'],
    })

    expect(evaluateVoiceCaptureConfidence(weakDraft, weakDraft.rawInput)).toBe('clarify')
    expect(buildVoiceClarificationMessage(weakDraft, weakDraft.rawInput)).toBe(
      'I need you to restate that before I can save it.',
    )
    expect(buildVoiceClarificationQuestions(weakDraft, weakDraft.rawInput)).toEqual([
      'What do you want to add?',
    ])
  })

  it('asks task-vs-habit clarification questions when the intent is ambiguous', () => {
    const ambiguousDraft = typedTaskDraftSchema.parse({
      rawInput: 'Leer mas',
      normalizedInput: 'Leer mas',
      candidateType: 'task',
      title: 'Leer mas',
      notes: null,
      dueDate: null,
      dueTime: null,
      priority: null,
      estimatedMinutes: null,
      cadenceType: null,
      cadenceDays: [],
      targetCount: null,
      matchedCalendarContext: null,
      preferredStartTime: null,
      preferredEndTime: null,
      interpretationNotes: ['Task-vs-habit intent is unclear from the transcript.'],
    })

    expect(evaluateVoiceCaptureConfidence(ambiguousDraft, ambiguousDraft.rawInput)).toBe('clarify')
    expect(buildVoiceClarificationMessage(ambiguousDraft, ambiguousDraft.rawInput)).toBe(
      'I need to confirm whether this belongs in tasks or habits.',
    )
    expect(buildVoiceClarificationQuestions(ambiguousDraft, ambiguousDraft.rawInput)).toEqual([
      'Is this a one-time task or a habit you want to repeat?',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildHeuristicTaskDraft,
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
    expect(inferDueDateFromInput('Comprar focos mañana', '2026-04-08')).toBe('2026-04-09')
    expect(
      inferDueDateFromInput('Entregarlo el domingo que viene', '2026-04-08'),
    ).toBe('2026-04-12')
  })

  it('builds a heuristic draft with notes and title fallback', () => {
    const draft = buildHeuristicTaskDraft({
      rawInput:
        'Tengo que entregar para el domingo que viene la primera tarea del curso Cloud Computing, en este tengo que resolverlo lo antes posible.',
      currentDate: '2026-04-08',
    })

    expect(draft.title).toBe('entregar para el domingo que viene la primera tarea del curso Cloud Computing')
    expect(draft.dueDate).toBe('2026-04-12')
    expect(draft.priority).toBe('high')
    expect(draft.interpretationNotes).toContain(
      "Interpreted 'domingo que viene' as the next upcoming Sunday.",
    )
  })

  it('merges provider values over heuristics while keeping notes', () => {
    const heuristicDraft = buildHeuristicTaskDraft({
      rawInput: 'Need to deal with taxes tomorrow',
      currentDate: '2026-04-08',
    })

    const merged = mergeTypedTaskDrafts(heuristicDraft, {
      title: 'Deal with taxes',
      notes: 'Prepare and submit tax paperwork.',
      dueDate: '2026-04-09',
      interpretationNotes: ['Provider inferred a cleaner task title.'],
    })

    expect(merged.title).toBe('Deal with taxes')
    expect(merged.notes).toBe('Prepare and submit tax paperwork.')
    expect(merged.interpretationNotes).toContain('Provider inferred a cleaner task title.')
    expect(() => typedTaskDraftSchema.parse(merged)).not.toThrow()
  })
})

import type { Database } from '../db/client'
import {
  buildHeuristicTaskDraft,
  confirmCapturedTaskInputSchema,
  interpretCaptureInputSchema,
  mergeTypedTaskDrafts,
  type ConfirmCapturedTaskInput,
  type InterpretCaptureFailure,
  type InterpretCaptureInput,
  type InterpretCaptureSuccess,
} from '../lib/capture'
import type { CaptureInterpreter } from './capture-interpreter'
import { CaptureInterpreterError, createRemoteCaptureInterpreter } from './capture-interpreter'
import { createTasksService } from './tasks-service'

export function createCaptureService(
  database: Database,
  interpreter: CaptureInterpreter | null = createRemoteCaptureInterpreter(),
) {
  const tasksService = createTasksService(database)

  return {
    async interpretTypedTaskInput(
      input: InterpretCaptureInput,
    ): Promise<InterpretCaptureSuccess | InterpretCaptureFailure> {
      const parsed = interpretCaptureInputSchema.parse(input)
      const heuristicDraft = buildHeuristicTaskDraft(parsed)

      if (!heuristicDraft.normalizedInput) {
        return {
          ok: false,
          code: 'EMPTY_INPUT',
          message: 'Enter some text before interpreting a task.',
          rawInput: parsed.rawInput,
        }
      }

      if (!interpreter) {
        return {
          ok: true,
          draft: heuristicDraft,
        }
      }

      try {
        const providerDraft = await interpreter.interpretTypedTask({
          normalizedInput: heuristicDraft.normalizedInput,
          currentDate: parsed.currentDate,
          timezone: parsed.timezone,
          languageHint: parsed.languageHint,
        })

        return {
          ok: true,
          draft: mergeTypedTaskDrafts(heuristicDraft, providerDraft),
        }
      } catch (error) {
        const fallbackNotes = [...heuristicDraft.interpretationNotes]

        if (error instanceof CaptureInterpreterError) {
          fallbackNotes.push('Hosted interpretation was unavailable; review inferred fields carefully.')
        } else {
          fallbackNotes.push('Task interpretation failed; review inferred fields carefully.')
        }

        return {
          ok: true,
          draft: {
            ...heuristicDraft,
            interpretationNotes: fallbackNotes,
          },
        }
      }
    },
    async confirmCapturedTask(input: ConfirmCapturedTaskInput) {
      const parsed = confirmCapturedTaskInputSchema.parse(input)

      return tasksService.createTask(parsed.task)
    },
  }
}

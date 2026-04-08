import type { Database } from '../db/client'
import {
  buildHeuristicTaskDraft,
  confirmCapturedHabitInputSchema,
  confirmCapturedTaskInputSchema,
  interpretCaptureInputSchema,
  mergeTypedTaskDrafts,
  type ConfirmCapturedHabitInput,
  type ConfirmCapturedTaskInput,
  type InterpretCaptureFailure,
  type InterpretCaptureInput,
  type InterpretCaptureSuccess,
} from '../lib/capture'
import type { CaptureInterpreter } from './capture-interpreter'
import { CaptureInterpreterError, createRemoteCaptureInterpreter } from './capture-interpreter'
import { createHabitsService } from './habits-service'
import { createTasksService } from './tasks-service'

export function createCaptureService(
  database: Database,
  interpreter: CaptureInterpreter | null = createRemoteCaptureInterpreter(),
) {
  const tasksService = createTasksService(database)
  const habitsService = createHabitsService(database)

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
        if (error instanceof CaptureInterpreterError) {
          return {
            ok: false,
            code:
              error.code === 'INVALID_RESPONSE'
                ? 'INVALID_PROVIDER_OUTPUT'
                : 'INTERPRETATION_FAILED',
            message: error.message,
            rawInput: parsed.rawInput,
          }
        } else {
          return {
            ok: false,
            code: 'INTERPRETATION_FAILED',
            message: 'Task interpretation failed unexpectedly.',
            rawInput: parsed.rawInput,
          }
        }
      }
    },
    async confirmCapturedTask(input: ConfirmCapturedTaskInput) {
      const parsed = confirmCapturedTaskInputSchema.parse(input)
      return tasksService.createTask(parsed.task)
    },
    async confirmCapturedHabit(input: ConfirmCapturedHabitInput) {
      const parsed = confirmCapturedHabitInputSchema.parse(input)
      return habitsService.createHabit(parsed.habit)
    },
  }
}

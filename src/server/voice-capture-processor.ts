import { db } from '../db/client'
import {
  buildVoiceClarificationMessage,
  buildVoiceClarificationQuestions,
  draftToHabitCreateInput,
  draftToTaskCreateInput,
  evaluateVoiceCaptureConfidence,
  type ProcessVoiceCaptureInput,
  type ProcessVoiceCaptureResponse,
} from '../lib/capture'
import { createCaptureService } from './capture-service'
import { createTranscriptionBroker } from './transcription'

const captureService = createCaptureService(db)
const transcriptionBroker = createTranscriptionBroker()

export function createVoiceCaptureProcessor(
  dependencies: {
    transcriptionBroker: Pick<ReturnType<typeof createTranscriptionBroker>, 'transcribeAudioUpload'>
    captureService: Pick<
      ReturnType<typeof createCaptureService>,
      'interpretTypedTaskInput' | 'confirmCapturedTask' | 'confirmCapturedHabit'
    >
  } = {
    transcriptionBroker,
    captureService,
  },
) {
  return {
    async processVoiceCapture(data: ProcessVoiceCaptureInput): Promise<ProcessVoiceCaptureResponse> {
      const transcription = await dependencies.transcriptionBroker.transcribeAudioUpload({
        audio: data.audio,
        languageHint: data.languageHint,
        source: data.source,
      })

      if (!transcription.ok) {
        return transcription
      }

      const languageHint = transcription.language === 'unknown' ? undefined : transcription.language
      const interpretation = await dependencies.captureService.interpretTypedTaskInput({
        rawInput: transcription.transcript,
        currentDate: data.currentDate,
        timezone: data.timezone,
        languageHint,
      })

      if (!interpretation.ok) {
        return interpretation
      }

      const confidence = evaluateVoiceCaptureConfidence(
        interpretation.draft,
        transcription.transcript,
      )

      if (confidence === 'high') {
        if (interpretation.draft.candidateType === 'habit') {
          const created = await dependencies.captureService.confirmCapturedHabit({
            rawInput: transcription.transcript,
            matchedCalendarContext: interpretation.draft.matchedCalendarContext,
            habit: draftToHabitCreateInput(interpretation.draft),
          })

          return {
            ok: true,
            outcome: 'auto_saved',
            candidateType: 'habit',
            createdId: created.id,
            transcript: transcription.transcript,
            language: transcription.language,
            matchedCalendarContext: interpretation.draft.matchedCalendarContext,
          }
        }

        const created = await dependencies.captureService.confirmCapturedTask({
          rawInput: transcription.transcript,
          matchedCalendarContext: interpretation.draft.matchedCalendarContext,
          task: draftToTaskCreateInput(interpretation.draft),
        })

        return {
          ok: true,
          outcome: 'auto_saved',
          candidateType: 'task',
          createdId: created.id,
          transcript: transcription.transcript,
          language: transcription.language,
          matchedCalendarContext: interpretation.draft.matchedCalendarContext,
        }
      }

      if (confidence === 'clarify') {
        return {
          ok: true,
          outcome: 'clarify',
          transcript: transcription.transcript,
          language: transcription.language,
          message: buildVoiceClarificationMessage(
            interpretation.draft,
            transcription.transcript,
          ),
          questions: buildVoiceClarificationQuestions(
            interpretation.draft,
            transcription.transcript,
          ),
          draft: interpretation.draft,
        }
      }

      return {
        ok: true,
        outcome: 'review',
        transcript: transcription.transcript,
        language: transcription.language,
        draft: interpretation.draft,
      }
    },
  }
}

import {
  normalizeCaptureInput,
  voiceIntentClassificationSchema,
  type VoiceIntentClassification,
} from '../lib/capture'

const TASK_REFERENCE_PATTERN = /\b(task|todo|tarea)\b/i

const TASK_STATUS_PATTERNS = [
  /\b(status|show|check)\b.*\b(task|todo|tarea)\b/i,
  /\bwhat(?:'s| is)\b.*\b(task|todo|tarea)\b/i,
  /\bhow(?:'s| is)\b.*\b(task|todo|tarea)\b/i,
  /\b(estado|muestrame|muéstrame|revisa)\b.*\b(tarea)\b/i,
  /\b(como va|cómo va)\b.*\b(tarea)\b/i,
] as const

const TASK_COMPLETE_PATTERNS = [
  /\b(mark|set)\b.*\b(task|todo|tarea)\b.*\b(done|complete(?:d)?|finish(?:ed)?)\b/i,
  /\b(done|complete(?:d)?|finish(?:ed)?)\b.*\b(task|todo|tarea)\b/i,
  /\b(marca|marcar|completa|completar|termina|terminar)\b.*\b(tarea)\b/i,
] as const

const TASK_REOPEN_PATTERNS = [
  /\b(reopen|re-open|undo)\b.*\b(task|todo|tarea)\b/i,
  /\b(reabre|reabrir|deshacer)\b.*\b(tarea)\b/i,
] as const

const TASK_EDIT_PATTERNS = [
  /\b(rename|edit|update|change)\b.*\b(task|todo|tarea)\b/i,
  /\b(renombra|renombrar|edita|editar|actualiza|actualizar|cambia|cambiar)\b.*\b(tarea)\b/i,
] as const

const TASK_UNSUPPORTED_ACTION_PATTERNS = [
  /\b(archive|delete|remove|cancel|snooze|defer)\b.*\b(task|todo|tarea)\b/i,
  /\b(archiva|archivar|elimina|eliminar|borra|borrar|cancela|cancelar|pospone|posponer|difiere|diferir)\b.*\b(tarea)\b/i,
] as const

const CALENDAR_CREATE_PATTERNS = [
  /\b(create|add|schedule|book|put)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(crea|crear|agrega|agregar|programa|programar|pon)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const CALENDAR_EDIT_PATTERNS = [
  /\b(edit|update|change|move|reschedule|rename)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(edita|editar|actualiza|actualizar|cambia|cambiar|mueve|mover|reprograma|reprogramar|renombra|renombrar)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const CALENDAR_CANCEL_PATTERNS = [
  /\b(cancel|delete|remove)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(cancela|cancelar|elimina|eliminar|borra|borrar|quita|quitar)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const CALENDAR_UNSUPPORTED_ACTION_PATTERNS = [
  /\b(status|show|check|list)\b.*\b(calendar|event|meeting|appointment)\b/i,
  /\b(estado|muestrame|muéstrame|revisa|lista)\b.*\b(calendario|evento|reunion|reunión|cita)\b/i,
] as const

const UNSUPPORTED_PLANNER_ACTION_PATTERNS = [
  /\b(edit|update|change|complete|reopen|archive|delete|remove|cancel)\b.*\b(habit|idea)\b/i,
  /\b(edita|editar|actualiza|actualizar|cambia|cambiar|completa|completar|reabre|reabrir|archiva|archivar|elimina|eliminar|borra|borrar|cancela|cancelar)\b.*\b(habito|hábito|idea)\b/i,
] as const

function matchesAnyPattern(value: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function mentionsTask(value: string) {
  return TASK_REFERENCE_PATTERN.test(value)
}

export function classifyVoiceIntent(transcript: string): VoiceIntentClassification {
  const normalizedTranscript = normalizeCaptureInput(transcript)

  if (!normalizedTranscript) {
    return {
      family: 'creation',
      kind: 'creation',
    }
  }

  if (!mentionsTask(normalizedTranscript)) {
    if (matchesAnyPattern(normalizedTranscript, CALENDAR_UNSUPPORTED_ACTION_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'unsupported_calendar_action',
      })
    }

    if (matchesAnyPattern(normalizedTranscript, CALENDAR_CANCEL_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'cancel_calendar_event',
      })
    }

    if (matchesAnyPattern(normalizedTranscript, CALENDAR_EDIT_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'edit_calendar_event',
      })
    }

    if (matchesAnyPattern(normalizedTranscript, CALENDAR_CREATE_PATTERNS)) {
      return voiceIntentClassificationSchema.parse({
        family: 'calendar_action',
        kind: 'create_calendar_event',
      })
    }
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_STATUS_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'task_status',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_REOPEN_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'reopen_task',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_COMPLETE_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'complete_task',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_EDIT_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'edit_task',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, TASK_UNSUPPORTED_ACTION_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'task_action',
      kind: 'unsupported_task_action',
    })
  }

  if (matchesAnyPattern(normalizedTranscript, UNSUPPORTED_PLANNER_ACTION_PATTERNS)) {
    return voiceIntentClassificationSchema.parse({
      family: 'unsupported_action',
      kind: 'unsupported_action',
    })
  }

  return voiceIntentClassificationSchema.parse({
    family: 'creation',
    kind: 'creation',
  })
}

export function buildVoiceActionClarification(intent: VoiceIntentClassification) {
  if (intent.family === 'task_action') {
    return {
      message:
        intent.kind === 'task_status'
          ? 'I understood that as a task status request, but voice task actions are not available yet.'
          : intent.kind === 'unsupported_task_action'
            ? 'I understood that as a task action, but that task command is not supported yet.'
          : 'I understood that as a task action, but voice task actions are not available yet.',
      questions: ['Do you want to create a new task instead?'],
    }
  }

  if (intent.family === 'calendar_action') {
    return {
      message:
        intent.kind === 'unsupported_calendar_action'
          ? 'I understood that as a calendar action, but that calendar command is not supported yet.'
          :
        'I understood that as a calendar action, but voice calendar actions are not available yet.',
      questions: ['Do you want to capture this as a new task instead?'],
    }
  }

  if (intent.family === 'unsupported_action') {
    return {
      message: 'I understood that as a planner command, but that voice action is not supported yet.',
      questions: ['Do you want to capture this as a new task instead?'],
    }
  }

  return {
    message: 'I need a little more detail before I can save this.',
    questions: ['What detail should I use before I save this?'],
  }
}

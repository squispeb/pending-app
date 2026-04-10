import { z } from 'zod'
import type { Idea } from '../db/schema'

export const ideaSourceTypeSchema = z.enum([
  'manual',
  'typed_capture',
  'voice_capture',
  'task_promoted',
  'habit_promoted',
])

export const ideaStatusSchema = z.enum(['active', 'archived'])

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .transform((value) => value || undefined)

export const ideaFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160),
  body: z.string().trim().max(10000).optional().or(z.literal('')).transform((value) => value || undefined),
  sourceType: ideaSourceTypeSchema.default('manual'),
  sourceInput: optionalTrimmedString,
})

export const ideaCreateSchema = ideaFormSchema

export const ideaToggleStarSchema = z.object({
  id: z.string().min(1),
})

export type IdeaFormValues = z.infer<typeof ideaFormSchema>
export type CreateIdeaInput = z.infer<typeof ideaCreateSchema>

export function toIdeaFormValues(idea: Idea | null): IdeaFormValues {
  if (!idea) {
    return {
      title: '',
      body: '',
      sourceType: 'manual',
      sourceInput: '',
    }
  }

  return {
    title: idea.title,
    body: idea.body,
    sourceType: idea.sourceType as IdeaFormValues['sourceType'],
    sourceInput: idea.sourceInput ?? '',
  }
}

export function normalizeIdeaValuesForStorage(values: Pick<IdeaFormValues, 'title' | 'body' | 'sourceType' | 'sourceInput'>) {
  return {
    title: values.title,
    body: values.body ?? '',
    sourceType: values.sourceType,
    sourceInput: values.sourceInput,
  }
}

export function isIdeaArchived(idea: Idea) {
  return idea.status === 'archived' || idea.archivedAt !== null
}

export function isIdeaStarred(idea: Idea) {
  return idea.starredAt !== null
}

export function sortIdeas(ideas: Array<Idea>) {
  return [...ideas].sort((left, right) => {
    const leftStarred = left.starredAt?.getTime() ?? 0
    const rightStarred = right.starredAt?.getTime() ?? 0

    if (leftStarred !== rightStarred) {
      return rightStarred - leftStarred
    }

    return right.updatedAt.getTime() - left.updatedAt.getTime()
  })
}

export function getIdeaExcerpt(idea: Pick<Idea, 'body' | 'sourceInput'>, maxLength = 180) {
  const source = idea.body || idea.sourceInput || ''
  if (source.length <= maxLength) {
    return source
  }

  return `${source.slice(0, maxLength - 1)}...`
}

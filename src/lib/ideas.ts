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

export const ideaStageSchema = z.enum(['discovery', 'framing', 'developed'])

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

export const ideaVaultSearchSchema = z.object({
  query: z.string().trim().max(160).optional().catch(undefined),
  stage: ideaStageSchema.optional().catch(undefined),
  view: z.enum(['recent', 'starred']).default('recent').catch('recent'),
})

export type IdeaFormValues = z.infer<typeof ideaFormSchema>
export type CreateIdeaInput = z.infer<typeof ideaCreateSchema>
export type IdeaVaultSearch = z.infer<typeof ideaVaultSearchSchema>

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

export function getIdeaStageLabel(stage: z.infer<typeof ideaStageSchema>) {
  switch (stage) {
    case 'discovery':
      return 'Discovery'
    case 'framing':
      return 'Framing'
    case 'developed':
      return 'Developed'
  }
}

export function getIdeaStageBadgeClassName(stage: z.infer<typeof ideaStageSchema>) {
  switch (stage) {
    case 'discovery':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
    case 'framing':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
    case 'developed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
  }
}

export function getIdeaExcerpt(idea: Pick<Idea, 'body' | 'sourceInput'>, maxLength = 180) {
  const source = idea.body || idea.sourceInput || ''
  if (source.length <= maxLength) {
    return source
  }

  return `${source.slice(0, maxLength - 1)}...`
}

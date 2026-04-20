import { describe, expect, it, vi } from 'vitest'
import { completeTaskWithArtifacts } from './tasks'

describe('tasks server orchestration', () => {
  it('stores completion artifacts and writes back step-linked completion progress', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const createTaskExecutionArtifact = vi.fn().mockResolvedValue({ ok: true as const, id: 'artifact-1' })
    const completeTask = vi.fn().mockResolvedValue({ ok: true as const })
    const listIdeas = vi.fn().mockResolvedValue([{ id: 'idea-123' }])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([
      {
        ideaId: 'idea-123',
        targetId: 'task-123',
        targetType: 'task' as const,
        linkReason: 'Accepted breakdown step #2 from idea.',
      },
    ])
    const recordProgressUpdateForIdeaThread = vi.fn().mockResolvedValue({ ok: true as const })

    const result = await completeTaskWithArtifacts(
      {
        id: 'task-123',
        resultArtifactContent: 'Interviewed 10 nutritionists and confirmed pricing trust is the main blocker.',
        evidenceArtifactContent: '7 of 10 asked for stronger social proof before paying.',
      },
      {
        resolveUser,
        createTaskExecutionArtifact,
        completeTask,
        listIdeas,
        listIdeaExecutionLinks,
        recordProgressUpdateForIdeaThread,
      },
    )

    expect(createTaskExecutionArtifact).toHaveBeenNthCalledWith(1, {
      taskId: 'task-123',
      artifactType: 'result',
      content: 'Interviewed 10 nutritionists and confirmed pricing trust is the main blocker.',
    }, 'user-1')
    expect(createTaskExecutionArtifact).toHaveBeenNthCalledWith(2, {
      taskId: 'task-123',
      artifactType: 'evidence',
      content: '7 of 10 asked for stronger social proof before paying.',
    }, 'user-1')
    expect(completeTask).toHaveBeenCalledWith('task-123', 'user-1')
    expect(recordProgressUpdateForIdeaThread).toHaveBeenCalledWith('idea-123', {
      summary: 'Completed task for step 2 with recorded output.',
      stepOrder: 2,
      status: 'completed',
    })
    expect(result).toEqual({ ok: true })
  })

  it('does not write thread progress when completion has no recorded result', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const createTaskExecutionArtifact = vi.fn().mockResolvedValue({ ok: true as const, id: 'artifact-1' })
    const completeTask = vi.fn().mockResolvedValue({ ok: true as const })
    const listIdeas = vi.fn().mockResolvedValue([{ id: 'idea-123' }])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([
      {
        ideaId: 'idea-123',
        targetId: 'task-123',
        targetType: 'task' as const,
        linkReason: 'Accepted breakdown step #2 from idea.',
      },
    ])
    const recordProgressUpdateForIdeaThread = vi.fn().mockResolvedValue({ ok: true as const })

    await completeTaskWithArtifacts(
      {
        id: 'task-123',
        evidenceArtifactContent: 'Supporting note only.',
      },
      {
        resolveUser,
        createTaskExecutionArtifact,
        completeTask,
        listIdeas,
        listIdeaExecutionLinks,
        recordProgressUpdateForIdeaThread,
      },
    )

    expect(createTaskExecutionArtifact).toHaveBeenCalledTimes(1)
    expect(recordProgressUpdateForIdeaThread).not.toHaveBeenCalled()
  })

  it('treats whitespace-only result content as missing output', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const createTaskExecutionArtifact = vi.fn().mockResolvedValue({ ok: true as const, id: 'artifact-1' })
    const completeTask = vi.fn().mockResolvedValue({ ok: true as const })
    const listIdeas = vi.fn().mockResolvedValue([{ id: 'idea-123' }])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([
      {
        ideaId: 'idea-123',
        targetId: 'task-123',
        targetType: 'task' as const,
        linkReason: 'Accepted breakdown step #2 from idea.',
      },
    ])
    const recordProgressUpdateForIdeaThread = vi.fn().mockResolvedValue({ ok: true as const })

    await completeTaskWithArtifacts(
      {
        id: 'task-123',
        resultArtifactContent: '   ',
        evidenceArtifactContent: '  Observed stronger trust response after adding testimonials.  ',
      },
      {
        resolveUser,
        createTaskExecutionArtifact,
        completeTask,
        listIdeas,
        listIdeaExecutionLinks,
        recordProgressUpdateForIdeaThread,
      },
    )

    expect(createTaskExecutionArtifact).toHaveBeenCalledTimes(1)
    expect(createTaskExecutionArtifact).toHaveBeenCalledWith({
      taskId: 'task-123',
      artifactType: 'evidence',
      content: 'Observed stronger trust response after adding testimonials.',
    }, 'user-1')
    expect(recordProgressUpdateForIdeaThread).not.toHaveBeenCalled()
  })

  it('does not write thread progress for non-step-linked tasks', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const createTaskExecutionArtifact = vi.fn().mockResolvedValue({ ok: true as const, id: 'artifact-1' })
    const completeTask = vi.fn().mockResolvedValue({ ok: true as const })
    const listIdeas = vi.fn().mockResolvedValue([{ id: 'idea-123' }])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([
      {
        ideaId: 'idea-123',
        targetId: 'task-123',
        targetType: 'task' as const,
        linkReason: 'Accepted task conversion from developed idea.',
      },
    ])
    const recordProgressUpdateForIdeaThread = vi.fn().mockResolvedValue({ ok: true as const })

    await completeTaskWithArtifacts(
      {
        id: 'task-123',
        resultArtifactContent: 'Completed the generic task.',
      },
      {
        resolveUser,
        createTaskExecutionArtifact,
        completeTask,
        listIdeas,
        listIdeaExecutionLinks,
        recordProgressUpdateForIdeaThread,
      },
    )

    expect(recordProgressUpdateForIdeaThread).not.toHaveBeenCalled()
  })
})

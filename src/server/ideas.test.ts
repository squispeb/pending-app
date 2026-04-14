import { describe, expect, it, vi } from 'vitest'
import { approveIdeaProposalAndPersist, createIdeaAndBootstrapThread, persistIdeaRefinementAndSync } from './ideas'

describe('ideas server flow', () => {
  it('creates the canonical idea and bootstraps the assistant thread in one app-side path', async () => {
    const resolveUser = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      authHeaders: { cookie: 'better-auth.session_token=session-1' },
    })
    const createIdea = vi.fn().mockResolvedValue({
      ok: true as const,
      id: 'idea-123',
    })
    const bootstrapIdeaThread = vi.fn().mockResolvedValue({
      threadId: 'thread-user-1:idea-123',
      initialSnapshotId: 'snapshot-1',
    })

    const result = await createIdeaAndBootstrapThread(
      {
        title: 'Bootstrap flow',
        body: 'This should save the idea and create the assistant thread.',
        sourceType: 'typed_capture',
        sourceInput: 'Turn this into a tracked idea.',
      },
      {
        resolveUser,
        createIdea,
        bootstrapIdeaThread,
      },
    )

    expect(resolveUser).toHaveBeenCalledTimes(1)
    expect(createIdea).toHaveBeenCalledWith('user-1', {
      title: 'Bootstrap flow',
      body: 'This should save the idea and create the assistant thread.',
      sourceType: 'typed_capture',
      sourceInput: 'Turn this into a tracked idea.',
    })
    expect(bootstrapIdeaThread).toHaveBeenCalledWith('idea-123', {
      requestHeaders: { cookie: 'better-auth.session_token=session-1' },
    })
    expect(result).toEqual({
      ok: true,
      id: 'idea-123',
      threadId: 'thread-user-1:idea-123',
      initialSnapshotId: 'snapshot-1',
    })
  })

  it('supports voice-capture metadata when bootstrapping an idea from the capture flow', async () => {
    const resolveUser = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      authHeaders: { cookie: 'better-auth.session_token=session-1' },
    })
    const createIdea = vi.fn().mockResolvedValue({
      ok: true as const,
      id: 'idea-voice-1',
    })
    const bootstrapIdeaThread = vi.fn().mockResolvedValue({
      threadId: 'thread-user-1:idea-voice-1',
      initialSnapshotId: 'snapshot-voice-1',
    })

    const result = await createIdeaAndBootstrapThread(
      {
        title: 'Voice idea',
        body: 'Preserve the transcript and continue refining in the thread.',
        sourceType: 'voice_capture',
        sourceInput: 'I have an idea for a better capture flow.',
      },
      {
        resolveUser,
        createIdea,
        bootstrapIdeaThread,
      },
    )

    expect(createIdea).toHaveBeenCalledWith('user-1', {
      title: 'Voice idea',
      body: 'Preserve the transcript and continue refining in the thread.',
      sourceType: 'voice_capture',
      sourceInput: 'I have an idea for a better capture flow.',
    })
    expect(result).toEqual({
      ok: true,
      id: 'idea-voice-1',
      threadId: 'thread-user-1:idea-voice-1',
      initialSnapshotId: 'snapshot-voice-1',
    })
  })

  it('approves a proposal and persists the canonical write payload through the app boundary', async () => {
    const resolveUser = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
    })
    const approveIdeaThreadProposal = vi.fn().mockResolvedValue({
      thread: {
        threadId: 'thread-user-1:idea-123',
        ideaId: 'idea-123',
        userId: 'user-1',
        status: 'ready',
        visibleEvents: [],
        pendingProposal: null,
      },
      canonicalWritePayload: {
        ideaId: 'idea-123',
        expectedSnapshotVersion: 1,
        title: 'Expanded idea',
        body: 'Expanded body',
        threadSummary: 'Expanded summary',
      },
    })
    const applyApprovedProposal = vi.fn().mockResolvedValue({ snapshotId: 'snapshot-2', version: 2 })

    const result = await approveIdeaProposalAndPersist(
      {
        ideaId: 'idea-123',
        proposalId: 'proposal-1',
        expectedSnapshotVersion: 1,
      },
      {
        resolveUser,
        approveIdeaThreadProposal,
        applyApprovedProposal,
      },
    )

    expect(resolveUser).toHaveBeenCalledTimes(1)
    expect(approveIdeaThreadProposal).toHaveBeenCalledWith('idea-123', {
      proposalId: 'proposal-1',
      expectedSnapshotVersion: 1,
    })
    expect(applyApprovedProposal).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        expectedSnapshotVersion: 1,
        title: 'Expanded idea',
        body: 'Expanded body',
        threadSummary: 'Expanded summary',
      },
      'user-1',
    )
    expect(result).toEqual({
      threadId: 'thread-user-1:idea-123',
      ideaId: 'idea-123',
      userId: 'user-1',
      status: 'ready',
      visibleEvents: [],
      pendingProposal: null,
    })
  })

  it('persists a title refinement from the current developed thread state', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const getIdea = vi.fn().mockResolvedValue({ id: 'idea-123', title: 'Original title' })
    const getLatestIdeaSnapshot = vi.fn().mockResolvedValue({
      version: 2,
      title: 'Original title',
      body: 'Canonical body',
      threadSummary: 'Current summary',
    })
    const getIdeaThread = vi.fn().mockResolvedValue({
      stage: 'developed',
      workingIdea: {
        provisionalTitle: 'Improved title',
        currentSummary: 'Current summary',
      },
    })
    const syncIdeaThreadCheckpoint = vi.fn().mockResolvedValue({ changed: true, version: 3 })

    const result = await persistIdeaRefinementAndSync(
      {
        ideaId: 'idea-123',
        kind: 'title',
      },
      {
        resolveUser,
        getIdea,
        getLatestIdeaSnapshot,
        getIdeaThread,
        syncIdeaThreadCheckpoint,
      },
    )

    expect(syncIdeaThreadCheckpoint).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        expectedSnapshotVersion: 2,
        title: 'Improved title',
        body: 'Canonical body',
        threadSummary: 'Current summary',
        stage: 'developed',
      },
      'user-1',
    )
    expect(result).toEqual({
      ok: true,
      kind: 'title',
      title: 'Improved title',
      threadSummary: 'Current summary',
      stage: 'developed',
    })
  })

  it('persists a summary refinement from the current developed thread state', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const getIdea = vi.fn().mockResolvedValue({ id: 'idea-123', title: 'Original title' })
    const getLatestIdeaSnapshot = vi.fn().mockResolvedValue({
      version: 4,
      title: 'Original title',
      body: 'Canonical body',
      threadSummary: 'Current summary',
    })
    const getIdeaThread = vi.fn().mockResolvedValue({
      stage: 'developed',
      workingIdea: {
        provisionalTitle: 'Original title',
        currentSummary: 'Sharper summary grounded in the thread.',
      },
    })
    const syncIdeaThreadCheckpoint = vi.fn().mockResolvedValue({ changed: true, version: 5 })

    const result = await persistIdeaRefinementAndSync(
      {
        ideaId: 'idea-123',
        kind: 'summary',
      },
      {
        resolveUser,
        getIdea,
        getLatestIdeaSnapshot,
        getIdeaThread,
        syncIdeaThreadCheckpoint,
      },
    )

    expect(syncIdeaThreadCheckpoint).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        expectedSnapshotVersion: 4,
        title: 'Original title',
        body: 'Canonical body',
        threadSummary: 'Sharper summary grounded in the thread.',
        stage: 'developed',
      },
      'user-1',
    )
    expect(result).toEqual({
      ok: true,
      kind: 'summary',
      title: 'Original title',
      threadSummary: 'Sharper summary grounded in the thread.',
      stage: 'developed',
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { approveIdeaProposalAndPersist, createIdeaAndBootstrapThread } from './ideas'

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
})

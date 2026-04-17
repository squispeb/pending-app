import { describe, expect, it, vi } from 'vitest'
import { acceptIdeaBreakdownAndPersistSteps, approveIdeaProposalAndPersist, completeAcceptedBreakdownStepForIdea, convertAcceptedBreakdownStepToTaskAndLink, convertIdeaToTaskAndLink, createIdeaAndBootstrapThread, listAcceptedBreakdownStepsForIdea, markServerFnRawResponse, parseBreakdownSummaryToSteps, persistIdeaRefinementAndSync, uncompleteAcceptedBreakdownStepForIdea } from './ideas'

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

  it('accepts a task conversion, creates the canonical task, and links it back to the idea', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const acceptIdeaThreadStructuredAction = vi.fn().mockResolvedValue({
      thread: {
        threadId: 'thread-user-1:idea-123',
        ideaId: 'idea-123',
        userId: 'user-1',
        stage: 'developed',
      },
      taskCreationPayload: {
        taskTitle: 'Reduce onboarding drop-off',
        taskDescription: 'Validate the riskiest assumption and run the first experiment.',
        suggestedSteps: ['Validate the riskiest assumption', 'Run the first experiment'],
      },
    })
    const createTask = vi.fn().mockResolvedValue({ ok: true as const, id: 'task-123' })
    const createIdeaExecutionLink = vi.fn().mockResolvedValue({ ok: true })
    const recordTaskCreatedForIdeaThread = vi.fn().mockResolvedValue({
      ok: true as const,
      outcome: 'recorded',
      thread: {
        threadId: 'thread-user-1:idea-123',
      },
      threadEventId: 'event-task-1',
    })

    const result = await convertIdeaToTaskAndLink(
      {
        ideaId: 'idea-123',
        proposalId: 'proposal-1',
      },
      {
        resolveUser,
        acceptIdeaThreadStructuredAction,
        createTask,
        createIdeaExecutionLink,
        recordTaskCreatedForIdeaThread,
      },
    )

    expect(acceptIdeaThreadStructuredAction).toHaveBeenCalledWith('idea-123', {
      proposalId: 'proposal-1',
    })
    expect(createTask).toHaveBeenCalledWith('user-1', {
      title: 'Reduce onboarding drop-off',
      notes: 'Validate the riskiest assumption and run the first experiment.',
      priority: 'medium',
      dueDate: undefined,
      dueTime: undefined,
      reminderAt: undefined,
      estimatedMinutes: undefined,
      preferredStartTime: undefined,
      preferredEndTime: undefined,
    })
    expect(createIdeaExecutionLink).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        targetType: 'task',
        targetId: 'task-123',
        linkReason: 'Accepted task conversion from developed idea.',
      },
      'user-1',
    )
    expect(recordTaskCreatedForIdeaThread).toHaveBeenCalledWith('idea-123', {
      taskId: 'task-123',
      summary: 'Created task Reduce onboarding drop-off from the accepted idea conversion.',
    })
    expect(result).toEqual({
      ok: true,
      taskId: 'task-123',
      thread: {
        threadId: 'thread-user-1:idea-123',
        ideaId: 'idea-123',
        userId: 'user-1',
        stage: 'developed',
      },
    })
  })

  it('accepts a breakdown proposal and persists ordered accepted steps from the pending summary', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const getIdeaThread = vi.fn().mockResolvedValue({
      pendingStructuredAction: {
        action: 'breakdown',
        proposedSummary: '1. Validate the riskiest assumption\n- Draft the first experiment\n* Review the results',
      },
    })
    const acceptIdeaThreadStructuredAction = vi.fn().mockResolvedValue({
      thread: {
        threadId: 'thread-user-1:idea-123',
        ideaId: 'idea-123',
        userId: 'user-1',
        stage: 'developed',
      },
    })
    const createAcceptedBreakdownSteps = vi.fn().mockResolvedValue({ ok: true as const })
    const recordBreakdownPlanForIdeaThread = vi.fn().mockResolvedValue({ ok: true as const })

    const result = await acceptIdeaBreakdownAndPersistSteps(
      {
        ideaId: 'idea-123',
        proposalId: 'proposal-1',
      },
      {
        resolveUser,
        getIdeaThread,
        acceptIdeaThreadStructuredAction,
        createAcceptedBreakdownSteps,
        recordBreakdownPlanForIdeaThread,
      },
    )

    expect(getIdeaThread).toHaveBeenCalledWith('idea-123')
    expect(acceptIdeaThreadStructuredAction).toHaveBeenCalledWith('idea-123', {
      proposalId: 'proposal-1',
    })
    expect(createAcceptedBreakdownSteps).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        steps: [
          { stepOrder: 1, stepText: 'Validate the riskiest assumption' },
          { stepOrder: 2, stepText: 'Draft the first experiment' },
          { stepOrder: 3, stepText: 'Review the results' },
        ],
      },
      'user-1',
    )
    expect(recordBreakdownPlanForIdeaThread).toHaveBeenCalledWith('idea-123', {
      summary: 'Stored accepted breakdown plan with 3 steps.',
      stepCount: 3,
    })
    expect(result).toEqual({
      ok: true,
      steps: [
        { stepOrder: 1, stepText: 'Validate the riskiest assumption' },
        { stepOrder: 2, stepText: 'Draft the first experiment' },
        { stepOrder: 3, stepText: 'Review the results' },
      ],
      thread: {
        threadId: 'thread-user-1:idea-123',
        ideaId: 'idea-123',
        userId: 'user-1',
        stage: 'developed',
      },
    })
  })

  it('creates a canonical task from one accepted breakdown step and links it to the idea', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', ideaId: 'idea-123', stepOrder: 1, stepText: 'Validate the riskiest assumption', createdAt: new Date(), updatedAt: new Date() },
      { id: 'step-2', ideaId: 'idea-123', stepOrder: 2, stepText: 'Draft the first experiment', createdAt: new Date(), updatedAt: new Date() },
    ])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([])
    const createTask = vi.fn().mockResolvedValue({ ok: true as const, id: 'task-123' })
    const createIdeaExecutionLink = vi.fn().mockResolvedValue({ ok: true })
    const recordTaskCreatedForIdeaThread = vi.fn().mockResolvedValue({ ok: true })

    const result = await convertAcceptedBreakdownStepToTaskAndLink(
      {
        ideaId: 'idea-123',
        stepId: 'step-2',
      },
      {
        resolveUser,
        listAcceptedBreakdownSteps,
        listIdeaExecutionLinks,
        createTask,
        createIdeaExecutionLink,
        recordTaskCreatedForIdeaThread,
      },
    )

    expect(resolveUser).toHaveBeenCalledTimes(1)
    expect(listAcceptedBreakdownSteps).toHaveBeenCalledWith('idea-123', 'user-1')
    expect(listIdeaExecutionLinks).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        targetType: 'task',
      },
      'user-1',
    )
    expect(createTask).toHaveBeenCalledWith('user-1', {
      title: 'Draft the first experiment',
      notes: 'Draft the first experiment',
      priority: 'medium',
      dueDate: undefined,
      dueTime: undefined,
      reminderAt: undefined,
      estimatedMinutes: undefined,
      preferredStartTime: undefined,
      preferredEndTime: undefined,
    })
    expect(createIdeaExecutionLink).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        targetType: 'task',
        targetId: 'task-123',
        linkReason: 'Accepted breakdown step #2 from idea.',
      },
      'user-1',
    )
    expect(recordTaskCreatedForIdeaThread).toHaveBeenCalledWith('idea-123', {
      taskId: 'task-123',
      summary: 'Created task Draft the first experiment from accepted breakdown step #2.',
      stepOrder: 2,
    })
    expect(result).toEqual({
      ok: true,
      taskId: 'task-123',
      step: {
        id: 'step-2',
        ideaId: 'idea-123',
        stepOrder: 2,
        stepText: 'Draft the first experiment',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    })
  })

  it('parses numbered breakdown summaries into ordered steps', () => {
    expect(parseBreakdownSummaryToSteps('1. Validate the riskiest assumption\n2. Draft the first experiment\n3. Review the results')).toEqual([
      { stepOrder: 1, stepText: 'Validate the riskiest assumption' },
      { stepOrder: 2, stepText: 'Draft the first experiment' },
      { stepOrder: 3, stepText: 'Review the results' },
    ])
  })

  it('parses bullet breakdown summaries into ordered steps', () => {
    expect(parseBreakdownSummaryToSteps('- Validate the riskiest assumption\n* Draft the first experiment\n• Review the results')).toEqual([
      { stepOrder: 1, stepText: 'Validate the riskiest assumption' },
      { stepOrder: 2, stepText: 'Draft the first experiment' },
      { stepOrder: 3, stepText: 'Review the results' },
    ])
  })

  it('treats single-paragraph breakdown summaries as a single step', () => {
    expect(parseBreakdownSummaryToSteps('Validate the riskiest assumption. Draft the first experiment. Review the results.')).toEqual([
      {
        stepOrder: 1,
        stepText: 'Validate the riskiest assumption. Draft the first experiment. Review the results.',
      },
    ])
  })

  it('returns an existing linked task when the accepted breakdown step was already converted', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-2', ideaId: 'idea-123', stepOrder: 2, stepText: 'Draft the first experiment', createdAt: new Date(), updatedAt: new Date() },
    ])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([
      {
        id: 'link-1',
        ideaId: 'idea-123',
        targetType: 'task' as const,
        targetId: 'task-123',
        linkReason: 'Accepted breakdown step #2 from idea.',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    const createTask = vi.fn()
    const createIdeaExecutionLink = vi.fn()
    const recordTaskCreatedForIdeaThread = vi.fn()

    const result = await convertAcceptedBreakdownStepToTaskAndLink(
      {
        ideaId: 'idea-123',
        stepId: 'step-2',
      },
      {
        resolveUser,
        listAcceptedBreakdownSteps,
        listIdeaExecutionLinks,
        createTask,
        createIdeaExecutionLink,
        recordTaskCreatedForIdeaThread,
      },
    )

    expect(listIdeaExecutionLinks).toHaveBeenCalledWith(
      {
        ideaId: 'idea-123',
        targetType: 'task',
      },
      'user-1',
    )
    expect(createTask).not.toHaveBeenCalled()
    expect(createIdeaExecutionLink).not.toHaveBeenCalled()
    expect(recordTaskCreatedForIdeaThread).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      taskId: 'task-123',
      step: {
        id: 'step-2',
        ideaId: 'idea-123',
        stepOrder: 2,
        stepText: 'Draft the first experiment',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    })
  })

  it('truncates long accepted breakdown steps for task titles and keeps the full step in notes', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const longStepText = 'Focus onboarding improvements on customer flows for independent nutritionists in Peru (age ~20–35). Measure activation, time-to-first-value and retention; validate current pain points via short interviews.'
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', ideaId: 'idea-123', stepOrder: 1, stepText: longStepText, createdAt: new Date(), updatedAt: new Date() },
    ])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([])
    const createTask = vi.fn().mockResolvedValue({ ok: true as const, id: 'task-999' })
    const createIdeaExecutionLink = vi.fn().mockResolvedValue({ ok: true })
    const recordTaskCreatedForIdeaThread = vi.fn().mockResolvedValue({ ok: true })

    await convertAcceptedBreakdownStepToTaskAndLink(
      {
        ideaId: 'idea-123',
        stepId: 'step-1',
      },
      {
        resolveUser,
        listAcceptedBreakdownSteps,
        listIdeaExecutionLinks,
        createTask,
        createIdeaExecutionLink,
        recordTaskCreatedForIdeaThread,
      },
    )

    expect(createTask).toHaveBeenCalledWith('user-1', {
      title: `${longStepText.slice(0, 117).trimEnd()}...`,
      notes: longStepText,
      priority: 'medium',
      dueDate: undefined,
      dueTime: undefined,
      reminderAt: undefined,
      estimatedMinutes: undefined,
      preferredStartTime: undefined,
      preferredEndTime: undefined,
    })
  })

  it('fails when the requested accepted breakdown step does not exist', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', ideaId: 'idea-123', stepOrder: 1, stepText: 'Validate the riskiest assumption', createdAt: new Date(), updatedAt: new Date() },
    ])
    const createTask = vi.fn()
    const createIdeaExecutionLink = vi.fn()

    await expect(
      convertAcceptedBreakdownStepToTaskAndLink(
        {
          ideaId: 'idea-123',
          stepId: 'missing-step',
        },
        {
          resolveUser,
          listAcceptedBreakdownSteps,
          createTask,
          createIdeaExecutionLink,
        },
      ),
    ).rejects.toThrow('Accepted breakdown step not found')

    expect(createTask).not.toHaveBeenCalled()
    expect(createIdeaExecutionLink).not.toHaveBeenCalled()
  })

  it('fails breakdown acceptance when the pending thread has no breakdown summary', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const getIdeaThread = vi.fn().mockResolvedValue({ pendingStructuredAction: null })
    const acceptIdeaThreadStructuredAction = vi.fn()
    const createAcceptedBreakdownSteps = vi.fn()

    await expect(
      acceptIdeaBreakdownAndPersistSteps(
        {
          ideaId: 'idea-123',
          proposalId: 'proposal-1',
        },
        {
          resolveUser,
          getIdeaThread,
          acceptIdeaThreadStructuredAction,
          createAcceptedBreakdownSteps,
        },
      ),
    ).rejects.toThrow('No breakdown proposal summary available')

    expect(acceptIdeaThreadStructuredAction).not.toHaveBeenCalled()
    expect(createAcceptedBreakdownSteps).not.toHaveBeenCalled()
  })

  it('fails task conversion when the accepted structured action has no task payload', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const acceptIdeaThreadStructuredAction = vi.fn().mockResolvedValue({
      thread: {
        threadId: 'thread-user-1:idea-123',
      },
    })
    const createTask = vi.fn()
    const createIdeaExecutionLink = vi.fn()

    await expect(
      convertIdeaToTaskAndLink(
        {
          ideaId: 'idea-123',
          proposalId: 'proposal-1',
        },
        {
          resolveUser,
          acceptIdeaThreadStructuredAction,
          createTask,
          createIdeaExecutionLink,
        },
      ),
    ).rejects.toThrow('Accepted structured action did not return a task payload')

    expect(createTask).not.toHaveBeenCalled()
    expect(createIdeaExecutionLink).not.toHaveBeenCalled()
  })

  it('rejects refinement persistence when the thread is not developed yet', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const getIdea = vi.fn().mockResolvedValue({ id: 'idea-123', title: 'Original title' })
    const getLatestIdeaSnapshot = vi.fn().mockResolvedValue({
      version: 2,
      title: 'Original title',
      body: 'Canonical body',
      threadSummary: 'Current summary',
    })
    const getIdeaThread = vi.fn().mockResolvedValue({
      stage: 'framing',
      workingIdea: {
        provisionalTitle: 'Improved title',
        currentSummary: 'Current summary',
      },
    })
    const syncIdeaThreadCheckpoint = vi.fn()

    await expect(
      persistIdeaRefinementAndSync(
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
      ),
    ).rejects.toThrow('Title and summary improvements are only available for developed ideas.')
    expect(syncIdeaThreadCheckpoint).not.toHaveBeenCalled()
  })

  it('clones thread stream responses before marking them as raw', async () => {
    const original = new Response('data: {"type":"assistant_chunk","textDelta":"Hello"}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })

    const wrapped = markServerFnRawResponse(original)

    expect(wrapped).not.toBe(original)
    expect(wrapped.headers.get('content-type')).toBe('text/event-stream')
    expect(wrapped.headers.get('x-tss-raw')).toBe('true')
    expect(original.headers.get('x-tss-raw')).toBeNull()
    await expect(wrapped.text()).resolves.toContain('assistant_chunk')
  })

  it('lists accepted breakdown steps for the authenticated idea owner', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', ideaId: 'idea-123', stepOrder: 1, stepText: 'Validate the riskiest assumption', completedAt: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'step-2', ideaId: 'idea-123', stepOrder: 2, stepText: 'Draft the first experiment', completedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
      { id: 'step-3', ideaId: 'idea-123', stepOrder: 3, stepText: 'Review the results', completedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ])

    const result = await listAcceptedBreakdownStepsForIdea('idea-123', {
      resolveUser,
      listAcceptedBreakdownSteps,
    })

    expect(resolveUser).toHaveBeenCalledTimes(1)
    expect(listAcceptedBreakdownSteps).toHaveBeenCalledWith('idea-123', 'user-1')
    expect(result.map((step) => step.stepOrder)).toEqual([1, 2, 3])
    expect(result.map((step) => step.stepText)).toEqual([
      'Validate the riskiest assumption',
      'Draft the first experiment',
      'Review the results',
    ])
    expect(result.map((step) => step.completedAt)).toEqual([null, expect.any(Date), null])
    expect(result.map((step) => step.completedSource)).toEqual([null, 'manual', null])
  })

  it('derives accepted breakdown step completion from a linked completed task', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const updatedAt = new Date('2026-04-16T10:00:00.000Z')
    const linkedCompletedAt = new Date('2026-04-16T12:00:00.000Z')
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', ideaId: 'idea-123', stepOrder: 1, stepText: 'Validate the riskiest assumption', completedAt: null, createdAt: new Date(), updatedAt },
      { id: 'step-2', ideaId: 'idea-123', stepOrder: 2, stepText: 'Draft the first experiment', completedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([
      { targetType: 'task' as const, targetId: 'task-123', linkReason: 'Accepted breakdown step #1 from idea.' },
    ])
    const listTasks = vi.fn().mockResolvedValue([
      { id: 'task-123', status: 'completed', completedAt: linkedCompletedAt, archivedAt: null },
      { id: 'task-999', status: 'active', completedAt: null, archivedAt: null },
    ])

    const result = await listAcceptedBreakdownStepsForIdea('idea-123', {
      resolveUser,
      listAcceptedBreakdownSteps,
      listIdeaExecutionLinks,
      listTasks,
    })

    expect(listIdeaExecutionLinks).toHaveBeenCalledWith({ ideaId: 'idea-123', targetType: 'task' }, 'user-1')
    expect(listTasks).toHaveBeenCalledWith('user-1')
    expect(result[0]).toMatchObject({
      id: 'step-1',
      completedAt: linkedCompletedAt,
      completedSource: 'linked-task',
    })
    expect(result[1]).toMatchObject({
      id: 'step-2',
      completedAt: null,
      completedSource: null,
    })
  })

  it('falls back to the step updatedAt when a linked completed task has no completedAt timestamp', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const updatedAt = new Date('2026-04-16T10:00:00.000Z')
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', ideaId: 'idea-123', stepOrder: 1, stepText: 'Validate the riskiest assumption', completedAt: null, createdAt: new Date(), updatedAt },
    ])
    const listIdeaExecutionLinks = vi.fn().mockResolvedValue([
      { targetType: 'task' as const, targetId: 'task-123', linkReason: 'Accepted breakdown step #1 from idea.' },
    ])
    const listTasks = vi.fn().mockResolvedValue([
      { id: 'task-123', status: 'completed', completedAt: null, archivedAt: null },
    ])

    const [step] = await listAcceptedBreakdownStepsForIdea('idea-123', {
      resolveUser,
      listAcceptedBreakdownSteps,
      listIdeaExecutionLinks,
      listTasks,
    })

    expect(step?.completedAt).toEqual(updatedAt)
    expect(step?.completedSource).toBe('linked-task')
  })

  it('completes an accepted breakdown step for the authenticated idea owner', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const completeAcceptedBreakdownStep = vi.fn().mockResolvedValue({ ok: true as const })
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', stepOrder: 1, stepText: 'Validate the riskiest assumption', completedAt: null },
    ])
    const recordProgressUpdateForIdeaThread = vi.fn().mockResolvedValue({ ok: true as const })

    const result = await completeAcceptedBreakdownStepForIdea(
      { ideaId: 'idea-123', stepId: 'step-1' },
      { resolveUser, completeAcceptedBreakdownStep, listAcceptedBreakdownSteps, recordProgressUpdateForIdeaThread },
    )

    expect(resolveUser).toHaveBeenCalledTimes(1)
    expect(listAcceptedBreakdownSteps).toHaveBeenCalledWith('idea-123', 'user-1')
    expect(completeAcceptedBreakdownStep).toHaveBeenCalledWith({ ideaId: 'idea-123', stepId: 'step-1' }, 'user-1')
    expect(recordProgressUpdateForIdeaThread).toHaveBeenCalledWith('idea-123', {
      summary: 'Marked accepted breakdown step #1 done: Validate the riskiest assumption',
      stepOrder: 1,
      status: 'completed',
    })
    expect(result).toEqual({ ok: true })
  })

  it('uncompletes an accepted breakdown step for the authenticated idea owner', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const uncompleteAcceptedBreakdownStep = vi.fn().mockResolvedValue({ ok: true as const })
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([
      { id: 'step-1', stepOrder: 1, stepText: 'Validate the riskiest assumption', completedAt: new Date() },
    ])
    const recordProgressUpdateForIdeaThread = vi.fn().mockResolvedValue({ ok: true as const })

    const result = await uncompleteAcceptedBreakdownStepForIdea(
      { ideaId: 'idea-123', stepId: 'step-1' },
      { resolveUser, uncompleteAcceptedBreakdownStep, listAcceptedBreakdownSteps, recordProgressUpdateForIdeaThread },
    )

    expect(resolveUser).toHaveBeenCalledTimes(1)
    expect(listAcceptedBreakdownSteps).toHaveBeenCalledWith('idea-123', 'user-1')
    expect(uncompleteAcceptedBreakdownStep).toHaveBeenCalledWith({ ideaId: 'idea-123', stepId: 'step-1' }, 'user-1')
    expect(recordProgressUpdateForIdeaThread).toHaveBeenCalledWith('idea-123', {
      summary: 'Reopened accepted breakdown step #1: Validate the riskiest assumption',
      stepOrder: 1,
      status: 'reopened',
    })
    expect(result).toEqual({ ok: true })
  })

  it('fails completion when the accepted breakdown step cannot be found', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
    const completeAcceptedBreakdownStep = vi.fn().mockResolvedValue({ ok: true as const })
    const listAcceptedBreakdownSteps = vi.fn().mockResolvedValue([])

    await expect(
      completeAcceptedBreakdownStepForIdea(
        { ideaId: 'idea-123', stepId: 'missing-step' },
        { resolveUser, completeAcceptedBreakdownStep, listAcceptedBreakdownSteps },
      ),
    ).rejects.toThrow('Accepted breakdown step not found')

    expect(completeAcceptedBreakdownStep).not.toHaveBeenCalled()
  })
})

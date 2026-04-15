import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createIdeasService } from './ideas-service'

function makeDatabase() {
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })

  return { client, db }
}

async function createSchema(db: ReturnType<typeof drizzle<typeof schema>>) {
  await db.run(sql`
    CREATE TABLE users (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL UNIQUE,
      display_name text,
      timezone text DEFAULT 'UTC' NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
    );
  `)

  await db.run(sql`
    CREATE TABLE ideas (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      title text NOT NULL,
      body text DEFAULT '' NOT NULL,
      source_type text DEFAULT 'manual' NOT NULL,
      source_input text,
      thread_summary text,
      stage text DEFAULT 'discovery' NOT NULL,
      classification_confidence text,
      capture_language text,
      status text DEFAULT 'active' NOT NULL,
      starred_at integer,
      archived_at integer,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE TABLE idea_snapshots (
      id text PRIMARY KEY NOT NULL,
      idea_id text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      body text DEFAULT '' NOT NULL,
      source_type text DEFAULT 'manual' NOT NULL,
      source_input text,
      thread_summary text,
      stage text DEFAULT 'discovery' NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX idea_snapshot_version_unique
      ON idea_snapshots (idea_id, version);
  `)

  await db.run(sql`
    CREATE TABLE idea_thread_refs (
      id text PRIMARY KEY NOT NULL,
      idea_id text NOT NULL,
      thread_id text NOT NULL,
      initial_snapshot_id text NOT NULL,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE cascade,
      FOREIGN KEY (initial_snapshot_id) REFERENCES idea_snapshots(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX idea_thread_ref_idea_unique
      ON idea_thread_refs (idea_id);
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX idea_thread_ref_thread_unique
      ON idea_thread_refs (thread_id);
  `)

  await db.run(sql`
    CREATE TABLE idea_execution_links (
      id text PRIMARY KEY NOT NULL,
      idea_id text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      link_reason text,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE cascade
    );
  `)

  await db.run(sql`
    CREATE UNIQUE INDEX idea_execution_link_unique
      ON idea_execution_links (idea_id, target_type, target_id);
  `)
}

describe('ideas service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  let service: ReturnType<typeof createIdeasService>
  const primaryUserId = 'user-1'
  const secondaryUserId = 'user-2'

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
    await db.insert(schema.users).values([
      {
        id: primaryUserId,
        email: 'user-1@example.com',
        displayName: 'User One',
        timezone: 'UTC',
      },
      {
        id: secondaryUserId,
        email: 'user-2@example.com',
        displayName: 'User Two',
        timezone: 'UTC',
      },
    ])
    service = createIdeasService(db)
  })

  it('creates and retrieves a canonical idea with source input', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Personal knowledge garden',
      body: 'Turn captured ideas into reusable notes with visible refinement history.',
      sourceType: 'typed_capture',
      sourceInput: 'I want this app to become a place for my best ideas.',
    })

    const ideas = await service.listIdeas(primaryUserId)
    const detail = await service.getIdea(created.id, primaryUserId)

    expect(ideas).toHaveLength(1)
    expect(ideas[0]?.id).toBe(created.id)
    expect(ideas[0]?.sourceType).toBe('typed_capture')
    expect(ideas[0]?.stage).toBe('discovery')
    expect(detail?.sourceInput).toBe('I want this app to become a place for my best ideas.')
  })

  it('orders starred ideas first and then by recency', async () => {
    const first = await service.createIdea(primaryUserId, {
      title: 'Older idea',
      body: 'This should be pushed down by more recent work.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await new Promise((resolve) => setTimeout(resolve, 5))

    const second = await service.createIdea(primaryUserId, {
      title: 'Newer idea',
      body: 'This should appear first until starring changes the order.',
      sourceType: 'manual',
      sourceInput: '',
    })

    let ideas = await service.listIdeas(primaryUserId)
    expect(ideas.map((idea) => idea.id)).toEqual([second.id, first.id])

    await service.toggleIdeaStar(first.id, primaryUserId)

    ideas = await service.listIdeas(primaryUserId)
    expect(ideas.map((idea) => idea.id)).toEqual([first.id, second.id])
    expect(ideas[0]?.starredAt).toBeInstanceOf(Date)
  })

  it('filters ideas by search query across title, body, and source input', async () => {
    const titleMatch = await service.createIdea(primaryUserId, {
      title: 'Onboarding research vault',
      body: 'A place to collect findings.',
      sourceType: 'manual',
      sourceInput: '',
    })
    const bodyMatch = await service.createIdea(primaryUserId, {
      title: 'Activation experiments',
      body: 'Research how trial teams experience onboarding drop-off.',
      sourceType: 'manual',
      sourceInput: '',
    })
    const sourceMatch = await service.createIdea(primaryUserId, {
      title: 'Interview workflow',
      body: 'Follow-up notes.',
      sourceType: 'voice_capture',
      sourceInput: 'Research plan for onboarding interviews.',
    })
    await service.createIdea(primaryUserId, {
      title: 'Weekly planning',
      body: 'Nothing to do with this query.',
      sourceType: 'manual',
      sourceInput: '',
    })

    const results = await service.listIdeas(primaryUserId, { query: 'research' })

    expect(results.map((idea) => idea.id).sort()).toEqual([
      bodyMatch.id,
      sourceMatch.id,
      titleMatch.id,
    ].sort())
  })

  it('filters ideas by stage without exposing archived records', async () => {
    const discoveryIdea = await service.createIdea(primaryUserId, {
      title: 'Discovery idea',
      body: 'Still rough.',
      sourceType: 'manual',
      sourceInput: '',
    })
    const framingIdea = await service.createIdea(primaryUserId, {
      title: 'Framing idea',
      body: 'Narrowing the scope.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: discoveryIdea.id,
        threadId: 'thread-user-1:idea-discovery',
      },
      primaryUserId,
    )

    await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: framingIdea.id,
        threadId: 'thread-user-1:idea-framing',
      },
      primaryUserId,
    )

    await service.syncIdeaThreadCheckpoint(
      {
        ideaId: framingIdea.id,
        expectedSnapshotVersion: 1,
        title: 'Framing idea',
        body: 'Narrowing the scope.',
        threadSummary: 'A clearer framing summary.',
        stage: 'framing',
      },
      primaryUserId,
    )

    const results = await service.listIdeas(primaryUserId, { stage: 'framing' })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: framingIdea.id,
      stage: 'framing',
    })
  })

  it('returns only starred ideas in the starred view and keeps recency ordering within that view', async () => {
    const first = await service.createIdea(primaryUserId, {
      title: 'First starred idea',
      body: 'Earlier starred record.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await new Promise((resolve) => setTimeout(resolve, 5))

    const second = await service.createIdea(primaryUserId, {
      title: 'Second starred idea',
      body: 'Later starred record.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await new Promise((resolve) => setTimeout(resolve, 5))

    await service.createIdea(primaryUserId, {
      title: 'Unstarred idea',
      body: 'Should not appear in the starred view.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.toggleIdeaStar(first.id, primaryUserId)

    await new Promise((resolve) => setTimeout(resolve, 5))

    await service.toggleIdeaStar(second.id, primaryUserId)

    const results = await service.listIdeas(primaryUserId, { view: 'starred' })

    expect(results.map((idea) => idea.id)).toEqual([second.id, first.id])
    expect(results.every((idea) => idea.starredAt instanceof Date)).toBe(true)
  })

  it('toggles star state off when an already starred idea is toggled again', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Star toggling',
      body: 'Make sure starring is reversible.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.toggleIdeaStar(created.id, primaryUserId)
    let detail = await service.getIdea(created.id, primaryUserId)
    expect(detail?.starredAt).toBeInstanceOf(Date)

    await service.toggleIdeaStar(created.id, primaryUserId)
    detail = await service.getIdea(created.id, primaryUserId)
    expect(detail?.starredAt).toBeNull()
  })

  it('scopes reads and mutations to the authenticated user id', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Private idea',
      body: 'Only the owning user should be able to see this.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await expect(service.getIdea(created.id, secondaryUserId)).resolves.toBeUndefined()
    await expect(service.listIdeas(secondaryUserId)).resolves.toEqual([])
    await expect(service.toggleIdeaStar(created.id, secondaryUserId)).rejects.toThrow('Idea not found')
  })

  it('stores an initial snapshot and thread reference for a created idea', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Thread bootstrap idea',
      body: 'Create the canonical record before bootstrapping the thread.',
      sourceType: 'typed_capture',
      sourceInput: 'This should become a real idea thread.',
    })

    const linkage = await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: created.id,
        threadId: 'thread-user-1:idea-123',
      },
      primaryUserId,
    )

    const threadRef = await service.getIdeaThreadRef(created.id, primaryUserId)
    const snapshots = await db.query.ideaSnapshots.findMany({
      where: eq(schema.ideaSnapshots.ideaId, created.id),
    })

    expect(linkage.threadId).toBe('thread-user-1:idea-123')
    expect(linkage.snapshotId).toBeTruthy()
    expect(threadRef).toMatchObject({
      ideaId: created.id,
      threadId: 'thread-user-1:idea-123',
      initialSnapshotId: linkage.snapshotId,
    })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      ideaId: created.id,
      version: 1,
      title: 'Thread bootstrap idea',
      sourceType: 'typed_capture',
      sourceInput: 'This should become a real idea thread.',
      stage: 'discovery',
    })
  })

  it('does not expose a thread reference to a different user', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Owner-only thread ref',
      body: 'Thread refs must remain tied to the canonical idea owner.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: created.id,
        threadId: 'thread-user-1:idea-456',
      },
      primaryUserId,
    )

    await expect(service.getIdeaThreadRef(created.id, secondaryUserId)).resolves.toBeUndefined()
  })

  it('creates and lists idea execution links for the owning user', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Execution bridge idea',
      body: 'Turn this into planner work.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.createIdeaExecutionLink(
      {
        ideaId: created.id,
        targetType: 'task',
        targetId: 'task-123',
        linkReason: 'Accepted task conversion from developed idea.',
      },
      primaryUserId,
    )

    const links = await service.listIdeaExecutionLinks({ ideaId: created.id }, primaryUserId)

    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      ideaId: created.id,
      targetType: 'task',
      targetId: 'task-123',
      linkReason: 'Accepted task conversion from developed idea.',
    })
  })

  it('filters execution links by target type', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Multi-target idea',
      body: 'Could turn into different execution items.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.createIdeaExecutionLink(
      {
        ideaId: created.id,
        targetType: 'task',
        targetId: 'task-123',
      },
      primaryUserId,
    )

    await service.createIdeaExecutionLink(
      {
        ideaId: created.id,
        targetType: 'habit',
        targetId: 'habit-456',
      },
      primaryUserId,
    )

    const taskLinks = await service.listIdeaExecutionLinks({ ideaId: created.id, targetType: 'task' }, primaryUserId)

    expect(taskLinks).toHaveLength(1)
    expect(taskLinks[0]).toMatchObject({
      targetType: 'task',
      targetId: 'task-123',
    })
  })

  it('scopes execution links to the owning user', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Private execution bridge',
      body: 'Only the owner should link this.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await expect(
      service.createIdeaExecutionLink(
        {
          ideaId: created.id,
          targetType: 'task',
          targetId: 'task-123',
        },
        secondaryUserId,
      ),
    ).rejects.toThrow('Idea not found')

    await expect(service.listIdeaExecutionLinks({ ideaId: created.id }, secondaryUserId)).resolves.toEqual([])
  })

  it('rejects duplicate execution links for the same idea target', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Duplicate guard idea',
      body: 'Should not create the same link twice.',
      sourceType: 'manual',
      sourceInput: '',
    })

    await service.createIdeaExecutionLink(
      {
        ideaId: created.id,
        targetType: 'task',
        targetId: 'task-123',
      },
      primaryUserId,
    )

    await expect(
      service.createIdeaExecutionLink(
        {
          ideaId: created.id,
          targetType: 'task',
          targetId: 'task-123',
        },
        primaryUserId,
      ),
    ).rejects.toThrow()
  })

  it('applies an approved proposal as the next accepted canonical snapshot', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Original idea',
      body: 'Original body',
      sourceType: 'typed_capture',
      sourceInput: 'Original source input',
    })

    await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: created.id,
        threadId: 'thread-user-1:idea-123',
      },
      primaryUserId,
    )

    const result = await service.applyApprovedProposal(
      {
        ideaId: created.id,
        expectedSnapshotVersion: 1,
        title: 'Expanded idea',
        body: 'Expanded body',
        threadSummary: 'Expanded summary',
      },
      primaryUserId,
    )

    const detail = await service.getIdea(created.id, primaryUserId)
    const snapshots = await db.query.ideaSnapshots.findMany({
      where: eq(schema.ideaSnapshots.ideaId, created.id),
      orderBy: [schema.ideaSnapshots.version],
    })

    expect(result.version).toBe(2)
    expect(detail).toMatchObject({
      title: 'Expanded idea',
      body: 'Expanded body',
      threadSummary: 'Expanded summary',
      stage: 'discovery',
    })
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1]).toMatchObject({
      ideaId: created.id,
      version: 2,
      title: 'Expanded idea',
      body: 'Expanded body',
      threadSummary: 'Expanded summary',
      sourceInput: 'Original source input',
      stage: 'discovery',
    })
  })

  it('persists a new canonical checkpoint when the working idea meaningfully advances', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Original idea',
      body: 'Original body',
      sourceType: 'typed_capture',
      sourceInput: 'Original source input',
    })

    await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: created.id,
        threadId: 'thread-user-1:idea-123',
      },
      primaryUserId,
    )

    const result = await service.syncIdeaThreadCheckpoint(
      {
        ideaId: created.id,
        expectedSnapshotVersion: 1,
        title: 'Original idea',
        body: 'Original body',
        threadSummary: 'Purpose: Reduce onboarding drop-off. Users: First-time users, trial teams.',
        stage: 'framing',
      },
      primaryUserId,
    )

    const detail = await service.getIdea(created.id, primaryUserId)
    const snapshots = await db.query.ideaSnapshots.findMany({
      where: eq(schema.ideaSnapshots.ideaId, created.id),
      orderBy: [schema.ideaSnapshots.version],
    })

    expect(result).toMatchObject({
      version: 2,
      changed: true,
    })
    expect(detail).toMatchObject({
      threadSummary: 'Purpose: Reduce onboarding drop-off. Users: First-time users, trial teams.',
      stage: 'framing',
    })
    expect(snapshots[1]).toMatchObject({
      version: 2,
      threadSummary: 'Purpose: Reduce onboarding drop-off. Users: First-time users, trial teams.',
      stage: 'framing',
    })
  })

  it('skips checkpoint writes when the canonical idea state is unchanged', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Original idea',
      body: 'Original body',
      sourceType: 'typed_capture',
      sourceInput: 'Original source input',
    })

    await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: created.id,
        threadId: 'thread-user-1:idea-123',
      },
      primaryUserId,
    )

    const result = await service.syncIdeaThreadCheckpoint(
      {
        ideaId: created.id,
        expectedSnapshotVersion: 1,
        title: 'Original idea',
        body: 'Original body',
        threadSummary: null,
        stage: 'discovery',
      },
      primaryUserId,
    )

    const snapshots = await db.query.ideaSnapshots.findMany({
      where: eq(schema.ideaSnapshots.ideaId, created.id),
      orderBy: [schema.ideaSnapshots.version],
    })

    expect(result).toMatchObject({
      version: 1,
      changed: false,
    })
    expect(snapshots).toHaveLength(1)
  })

  it('rejects approved proposal writes when the snapshot version is stale', async () => {
    const created = await service.createIdea(primaryUserId, {
      title: 'Original idea',
      body: 'Original body',
      sourceType: 'typed_capture',
      sourceInput: 'Original source input',
    })

    await service.createInitialSnapshotAndThreadRef(
      {
        ideaId: created.id,
        threadId: 'thread-user-1:idea-123',
      },
      primaryUserId,
    )

    await service.applyApprovedProposal(
      {
        ideaId: created.id,
        expectedSnapshotVersion: 1,
        title: 'Expanded idea',
        body: 'Expanded body',
        threadSummary: 'Expanded summary',
      },
      primaryUserId,
    )

    await expect(
      service.applyApprovedProposal(
        {
          ideaId: created.id,
          expectedSnapshotVersion: 1,
          title: 'Stale idea',
          body: 'Stale body',
          threadSummary: 'Stale summary',
        },
        primaryUserId,
      ),
    ).rejects.toThrow('Idea snapshot conflict')
  })
})

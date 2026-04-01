import { createClient } from '@libsql/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { createTasksService, DEFAULT_USER } from './tasks-service'

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
    CREATE TABLE tasks (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      title text NOT NULL,
      notes text,
      status text DEFAULT 'active' NOT NULL,
      priority text DEFAULT 'medium' NOT NULL,
      due_date text,
      due_time text,
      reminder_at integer,
      estimated_minutes integer,
      preferred_start_time text,
      preferred_end_time text,
      completed_at integer,
      archived_at integer,
      created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
    );
  `)
}

describe('tasks service', () => {
  let client: ReturnType<typeof createClient>
  let db: ReturnType<typeof drizzle<typeof schema>>
  let service: ReturnType<typeof createTasksService>

  beforeEach(async () => {
    const database = makeDatabase()
    client = database.client
    db = database.db
    await createSchema(db)
    service = createTasksService(db)
  })

  it('creates the default user lazily', async () => {
    const user = await service.ensureDefaultUser()

    expect(user.id).toBe(DEFAULT_USER.id)
    expect(user.email).toBe(DEFAULT_USER.email)
  })

  it('creates and lists a task with reminder support', async () => {
    await service.createTask({
      title: 'Plan sprint',
      notes: 'Bring roadmap draft',
      priority: 'high',
      dueDate: '2026-04-03',
      dueTime: '09:30',
      reminderAt: '2026-04-03T08:45',
      estimatedMinutes: 30,
      preferredStartTime: '08:30',
      preferredEndTime: '09:30',
    })

    const tasks = await service.listTasks()

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('Plan sprint')
    expect(tasks[0]?.priority).toBe('high')
    expect(tasks[0]?.reminderAt).toBeInstanceOf(Date)
  })

  it('updates a task and keeps it active', async () => {
    await service.createTask({
      title: 'Draft agenda',
      notes: '',
      priority: 'medium',
      dueDate: '2026-04-05',
      dueTime: '',
      reminderAt: '',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    })

    const [task] = await service.listTasks()

    await service.updateTask({
      id: task!.id,
      title: 'Draft team agenda',
      notes: 'Include roadmap review',
      priority: 'low',
      dueDate: '2026-04-06',
      dueTime: '13:00',
      reminderAt: '2026-04-06T12:30',
      estimatedMinutes: 20,
      preferredStartTime: '12:00',
      preferredEndTime: '13:30',
    })

    const [updated] = await service.listTasks()

    expect(updated?.title).toBe('Draft team agenda')
    expect(updated?.notes).toBe('Include roadmap review')
    expect(updated?.priority).toBe('low')
    expect(updated?.dueTime).toBe('13:00')
  })

  it('completes, reopens, and archives a task', async () => {
    await service.createTask({
      title: 'Review invoices',
      notes: '',
      priority: 'medium',
      dueDate: '2026-04-04',
      dueTime: '',
      reminderAt: '',
      estimatedMinutes: undefined,
      preferredStartTime: '',
      preferredEndTime: '',
    })

    const [task] = await service.listTasks()

    await service.completeTask(task!.id)

    let [updated] = await service.listTasks()
    expect(updated?.status).toBe('completed')
    expect(updated?.completedAt).toBeInstanceOf(Date)

    await service.reopenTask(task!.id)

    ;[updated] = await service.listTasks()
    expect(updated?.status).toBe('active')
    expect(updated?.completedAt).toBeNull()

    await service.archiveTask(task!.id)

    const remaining = await service.listTasks()
    expect(remaining).toHaveLength(0)
  })
})

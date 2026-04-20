import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  notes: text('notes'),
  status: text('status').notNull().default('active'),
  priority: text('priority').notNull().default('medium'),
  dueDate: text('due_date'),
  dueTime: text('due_time'),
  reminderAt: integer('reminder_at', { mode: 'timestamp_ms' }),
  estimatedMinutes: integer('estimated_minutes'),
  preferredStartTime: text('preferred_start_time'),
  preferredEndTime: text('preferred_end_time'),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const taskExecutionArtifacts = sqliteTable('task_execution_artifacts', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  artifactType: text('artifact_type').notNull(),
  source: text('source').notNull().default('user'),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const habits = sqliteTable('habits', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  cadenceType: text('cadence_type').notNull().default('daily'),
  cadenceDays: text('cadence_days'),
  targetCount: integer('target_count').notNull().default(1),
  preferredStartTime: text('preferred_start_time'),
  preferredEndTime: text('preferred_end_time'),
  reminderAt: integer('reminder_at', { mode: 'timestamp_ms' }),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  sourceType: text('source_type').notNull().default('manual'),
  sourceInput: text('source_input'),
  threadSummary: text('thread_summary'),
  stage: text('stage').notNull().default('discovery'),
  classificationConfidence: text('classification_confidence'),
  captureLanguage: text('capture_language'),
  status: text('status').notNull().default('active'),
  starredAt: integer('starred_at', { mode: 'timestamp_ms' }),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const ideaSnapshots = sqliteTable(
  'idea_snapshots',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    sourceType: text('source_type').notNull().default('manual'),
    sourceInput: text('source_input'),
    threadSummary: text('thread_summary'),
    stage: text('stage').notNull().default('discovery'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    ideaVersionIdx: uniqueIndex('idea_snapshot_version_unique').on(table.ideaId, table.version),
  }),
)

export const ideaThreadRefs = sqliteTable(
  'idea_thread_refs',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
    initialSnapshotId: text('initial_snapshot_id')
      .notNull()
      .references(() => ideaSnapshots.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    ideaIdIdx: uniqueIndex('idea_thread_ref_idea_unique').on(table.ideaId),
    threadIdIdx: uniqueIndex('idea_thread_ref_thread_unique').on(table.threadId),
  }),
)

export const ideaExecutionLinks = sqliteTable(
  'idea_execution_links',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    linkReason: text('link_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    ideaTargetUniqueIdx: uniqueIndex('idea_execution_link_unique').on(
      table.ideaId,
      table.targetType,
      table.targetId,
    ),
  }),
)

export const acceptedBreakdownSteps = sqliteTable(
  'accepted_breakdown_steps',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    stepText: text('step_text').notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    ideaStepOrderUniqueIdx: uniqueIndex('accepted_breakdown_step_idea_step_unique').on(
      table.ideaId,
      table.stepOrder,
    ),
  }),
)

export const habitCompletions = sqliteTable(
  'habit_completions',
  {
    id: text('id').primaryKey(),
    habitId: text('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    completionDate: text('completion_date').notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    habitDateIdx: uniqueIndex('habit_completion_unique').on(
      table.habitId,
      table.completionDate,
    ),
  }),
)

export const googleAccounts = sqliteTable('google_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  googleSubject: text('google_subject').notNull(),
  email: text('email').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiryAt: integer('token_expiry_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  connectedAt: integer('connected_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  disconnectedAt: integer('disconnected_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const calendarConnections = sqliteTable('calendar_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  googleAccountId: text('google_account_id')
    .notNull()
    .references(() => googleAccounts.id, { onDelete: 'cascade' }),
  calendarId: text('calendar_id').notNull(),
  calendarName: text('calendar_name').notNull(),
  isSelected: integer('is_selected', { mode: 'boolean' }).notNull().default(false),
  primaryFlag: integer('primary_flag', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const calendarEvents = sqliteTable('calendar_events', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  calendarId: text('calendar_id').notNull(),
  googleEventId: text('google_event_id').notNull(),
  googleRecurringEventId: text('google_recurring_event_id'),
  status: text('status').notNull().default('confirmed'),
  summary: text('summary'),
  description: text('description'),
  location: text('location'),
  startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
  endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
  allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
  eventTimezone: text('event_timezone'),
  htmlLink: text('html_link'),
  organizerEmail: text('organizer_email'),
  attendeeCount: integer('attendee_count'),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAtRemote: integer('updated_at_remote', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const planningItemCalendarLinks = sqliteTable(
  'planning_item_calendar_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    calendarId: text('calendar_id').notNull(),
    googleEventId: text('google_event_id').notNull(),
    googleRecurringEventId: text('google_recurring_event_id'),
    matchedSummary: text('matched_summary').notNull(),
    matchReason: text('match_reason').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    sourceUniqueIdx: uniqueIndex('planning_item_calendar_link_source_unique').on(
      table.sourceType,
      table.sourceId,
    ),
  }),
)

export const syncStates = sqliteTable('sync_states', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  scopeKey: text('scope_key').notNull(),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  nextSyncToken: text('next_sync_token'),
  syncWindowStart: integer('sync_window_start', { mode: 'timestamp_ms' }),
  syncWindowEnd: integer('sync_window_end', { mode: 'timestamp_ms' }),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export const reminderEvents = sqliteTable('reminder_events', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),
  snoozedUntil: integer('snoozed_until', { mode: 'timestamp_ms' }),
  deliveredInAppAt: integer('delivered_in_app_at', { mode: 'timestamp_ms' }),
  deliveredBrowserAt: integer('delivered_browser_at', { mode: 'timestamp_ms' }),
  completedViaReminderAt: integer('completed_via_reminder_at', {
    mode: 'timestamp_ms',
  }),
  dismissedAt: integer('dismissed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export type User = typeof users.$inferSelect
export type Task = typeof tasks.$inferSelect
export type TaskExecutionArtifact = typeof taskExecutionArtifacts.$inferSelect
export type Habit = typeof habits.$inferSelect
export type Idea = typeof ideas.$inferSelect
export type IdeaSnapshot = typeof ideaSnapshots.$inferSelect
export type IdeaThreadRef = typeof ideaThreadRefs.$inferSelect
export type IdeaExecutionLink = typeof ideaExecutionLinks.$inferSelect
export type HabitCompletion = typeof habitCompletions.$inferSelect
export type GoogleAccount = typeof googleAccounts.$inferSelect
export type CalendarConnection = typeof calendarConnections.$inferSelect
export type CalendarEvent = typeof calendarEvents.$inferSelect
export type PlanningItemCalendarLink = typeof planningItemCalendarLinks.$inferSelect
export type SyncState = typeof syncStates.$inferSelect
export type ReminderEvent = typeof reminderEvents.$inferSelect

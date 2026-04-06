# M2 Habits UI Delegation Brief

Target model: `github-copilot/claude-sonnet-4.6`

## Goal

Implement the `/habits` route UI for Milestone 2 using the existing backend contracts only. Do not change database schema or server business logic unless a clear integration bug is found.

## Existing Backend Contracts

### Shared habit helpers

- `src/lib/habits.ts`

Available concepts:

- `habitFormSchema`
- `toHabitFormValues`
- `applyHabitFilter`
- `getHabitSummary`
- `getHabitCadenceLabel`
- `isHabitDueOnDate`
- `isHabitCompletedOnDate`

### Server functions

- `src/server/habits.ts`

Available operations:

- `listHabits()`
- `listHabitCompletions({ startDate?, endDate? })`
- `createHabit(data)`
- `updateHabit(data)`
- `archiveHabit({ id })`
- `completeHabitForDate({ habitId, date? })`
- `uncompleteHabitForDate({ habitId, date? })`

## Milestone 2 Product Scope

Implement only:

- habit create
- habit edit
- habit archive
- daily and selected-day cadence UI
- mark complete for today
- unmark complete for today
- recent completion history display

Do not implement:

- streak analytics
- browser reminders
- dashboard aggregation
- Google Calendar integration
- multi-completion per day

## Important Product Rule

`targetCount` is stored for future use, but Milestone 2 still uses **one completion per habit per day**.

## Required UI Behavior

Update `src/routes/habits.tsx` to provide:

1. Summary cards
   - active
   - due today
   - completed today
   - archived

2. Habit editor form
   - title
   - cadence type: `daily` or `selected_days`
   - weekday picker for selected-days mode
   - target count field
   - preferred start/end time
   - reminder datetime
   - create/edit mode
   - inline validation errors

3. Habit list area
   - filters: `active`, `due-today`, `completed-today`, `archived`, `all`
   - habit cards
   - edit action
   - archive action
   - complete/uncomplete for today action

4. History surface
   - show recent completion history for each habit or in a secondary section
   - recent window can be pragmatic, such as last 14 or 30 days

5. Feedback behavior
   - success and error banners consistent with `/tasks`
   - row-level pending states for mutate actions

## Styling / UX Constraints

- Match the existing `/tasks` page structure and visual language
- Reuse the same summary-card, editor-panel, and list-panel interaction style
- Keep the layout responsive
- Avoid introducing a separate visual system just for habits

## Suggested Query Shape

In the route loader or query layer:

1. load habits
2. load recent completions for a useful range
3. compute due-today/completed-today client-side with shared helpers

## Acceptance Targets

The route should satisfy:

- user can create a daily habit
- user can create a selected-days habit
- user can edit and archive habits
- user can mark a habit complete for today
- user can unmark it for today
- recent completion history is visible and consistent with stored records

## Files Expected To Change

- `src/routes/habits.tsx`
- optionally new UI components under `src/components/habits/`

## Files That Should Not Be Changed Without Good Reason

- `src/db/schema/index.ts`
- `src/server/habits-service.ts`
- `src/server/habits.ts`
- `src/lib/habits.ts`

CREATE TABLE `idea_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_input` text,
	`thread_summary` text,
	`stage` text DEFAULT 'discovery' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idea_snapshot_version_unique` ON `idea_snapshots` (`idea_id`,`version`);--> statement-breakpoint
CREATE TABLE `idea_thread_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`initial_snapshot_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initial_snapshot_id`) REFERENCES `idea_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idea_thread_ref_idea_unique` ON `idea_thread_refs` (`idea_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_thread_ref_thread_unique` ON `idea_thread_refs` (`thread_id`);--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_input` text,
	`thread_summary` text,
	`stage` text DEFAULT 'discovery' NOT NULL,
	`classification_confidence` text,
	`capture_language` text,
	`status` text DEFAULT 'active' NOT NULL,
	`starred_at` integer,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `planning_item_calendar_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`google_event_id` text NOT NULL,
	`google_recurring_event_id` text,
	`matched_summary` text NOT NULL,
	`match_reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_item_calendar_link_source_unique` ON `planning_item_calendar_links` (`source_type`,`source_id`);
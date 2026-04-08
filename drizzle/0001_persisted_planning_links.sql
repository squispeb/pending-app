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

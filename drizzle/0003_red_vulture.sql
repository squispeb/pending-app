CREATE TABLE `idea_execution_links` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`link_reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idea_execution_link_unique` ON `idea_execution_links` (`idea_id`,`target_type`,`target_id`);
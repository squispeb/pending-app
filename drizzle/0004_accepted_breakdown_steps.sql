CREATE TABLE `accepted_breakdown_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`step_order` integer NOT NULL,
	`step_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accepted_breakdown_step_idea_step_unique` ON `accepted_breakdown_steps` (`idea_id`,`step_order`);

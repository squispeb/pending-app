PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `calendar_events_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`google_account_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`google_event_id` text NOT NULL,
	`google_recurring_event_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`summary` text,
	`description` text,
	`location` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`event_timezone` text,
	`html_link` text,
	`organizer_email` text,
	`attendee_count` integer,
	`synced_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at_remote` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`google_account_id`) REFERENCES `google_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `calendar_events_new` (
	`id`,
	`user_id`,
	`google_account_id`,
	`calendar_id`,
	`google_event_id`,
	`google_recurring_event_id`,
	`status`,
	`summary`,
	`description`,
	`location`,
	`starts_at`,
	`ends_at`,
	`all_day`,
	`event_timezone`,
	`html_link`,
	`organizer_email`,
	`attendee_count`,
	`synced_at`,
	`updated_at_remote`,
	`created_at`,
	`updated_at`
) SELECT
	`id`,
	`user_id`,
	COALESCE(
		(
			SELECT `google_account_id`
			FROM `calendar_connections` AS `cc`
			WHERE `cc`.`user_id` = `calendar_events`.`user_id`
				AND `cc`.`calendar_id` = `calendar_events`.`calendar_id`
			ORDER BY `cc`.`primary_flag` DESC, `cc`.`is_selected` DESC, `cc`.`updated_at` DESC
			LIMIT 1
		),
		(
			SELECT `id`
			FROM `google_accounts` AS `ga`
			WHERE `ga`.`user_id` = `calendar_events`.`user_id`
			ORDER BY `ga`.`updated_at` DESC
			LIMIT 1
		)
	) AS `google_account_id`,
	`calendar_id`,
	`google_event_id`,
	`google_recurring_event_id`,
	`status`,
	`summary`,
	`description`,
	`location`,
	`starts_at`,
	`ends_at`,
	`all_day`,
	`event_timezone`,
	`html_link`,
	`organizer_email`,
	`attendee_count`,
	`synced_at`,
	`updated_at_remote`,
	`created_at`,
	`updated_at`
FROM `calendar_events`;
--> statement-breakpoint
DROP TABLE `calendar_events`;
--> statement-breakpoint
ALTER TABLE `calendar_events_new` RENAME TO `calendar_events`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;

CREATE TABLE `connections` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`status` text NOT NULL,
	`channel_id` text,
	`channels_json` text DEFAULT '[]' NOT NULL,
	`grant_cipher` text,
	`version` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `connections_expires_at_idx` ON `connections` (`expires_at`);--> statement-breakpoint
CREATE TABLE `layouts` (
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`user_id`, `connection_id`),
	FOREIGN KEY (`user_id`,`connection_id`) REFERENCES `connections`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `leases` (
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`purpose` text NOT NULL,
	`id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `connection_id`, `purpose`),
	FOREIGN KEY (`user_id`,`connection_id`) REFERENCES `connections`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`browser_hash` text NOT NULL,
	`payload_cipher` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`,`connection_id`) REFERENCES `connections`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_states_connection_idx` ON `oauth_states` (`user_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `oauth_states_expires_at_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`payload` text NOT NULL,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `connection_id`),
	FOREIGN KEY (`user_id`,`connection_id`) REFERENCES `connections`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);

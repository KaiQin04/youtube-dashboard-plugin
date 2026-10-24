CREATE TABLE `provider_usage` (
  `scope` text PRIMARY KEY NOT NULL,
  `used` integer NOT NULL,
  `reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_permits` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `active` integer NOT NULL
);

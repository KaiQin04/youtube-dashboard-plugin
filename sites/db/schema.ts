import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const connections = sqliteTable("connections", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  status: text("status").notNull(),
  channelId: text("channel_id"),
  channelsJson: text("channels_json").notNull().default("[]"),
  grantCipher: text("grant_cipher"),
  version: integer("version").notNull().default(0),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("connections_expires_at_idx").on(table.expiresAt),
]);

export const oauthStates = sqliteTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id").notNull(),
  connectionId: text("connection_id").notNull(),
  browserHash: text("browser_hash").notNull(),
  payloadCipher: text("payload_cipher").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [
  foreignKey({ columns: [table.userId, table.connectionId], foreignColumns: [connections.userId, connections.id] }).onDelete("cascade"),
  index("oauth_states_connection_idx").on(table.userId, table.connectionId),
  index("oauth_states_expires_at_idx").on(table.expiresAt),
]);

export const snapshots = sqliteTable("snapshots", {
  userId: text("user_id").notNull(),
  connectionId: text("connection_id").notNull(),
  channelId: text("channel_id").notNull(),
  payload: text("payload").notNull(),
  observedAt: integer("observed_at").notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.connectionId] }),
  foreignKey({ columns: [table.userId, table.connectionId], foreignColumns: [connections.userId, connections.id] }).onDelete("cascade"),
]);

export const leases = sqliteTable("leases", {
  userId: text("user_id").notNull(),
  connectionId: text("connection_id").notNull(),
  purpose: text("purpose").notNull(),
  id: text("id").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.connectionId, table.purpose] }),
  foreignKey({ columns: [table.userId, table.connectionId], foreignColumns: [connections.userId, connections.id] }).onDelete("cascade"),
]);

export const layouts = sqliteTable("layouts", {
  userId: text("user_id").notNull(),
  connectionId: text("connection_id").notNull(),
  payload: text("payload").notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.connectionId] }),
  foreignKey({ columns: [table.userId, table.connectionId], foreignColumns: [connections.userId, connections.id] }).onDelete("cascade"),
]);

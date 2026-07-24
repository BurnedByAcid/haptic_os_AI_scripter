import { pgTable, text, boolean, timestamp, integer, bigint, serial, date, unique, primaryKey, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  clerkId:                 text("clerk_id").primaryKey(),
  username:                text("username").notNull().unique(),
  ageVerified:             boolean("age_verified").notNull(),
  plan:                    text("plan").notNull().default("free"),
  stripeCustomerId:        text("stripe_customer_id"),
  stripeSubscriptionId:    text("stripe_subscription_id"),
  hapticAiWarnDismissed:   boolean("haptic_ai_warn_dismissed").notNull().default(false),
  lastGenerationAt:        timestamp("last_generation_at", { withTimezone: true }),
  createdAt:               timestamp("created_at").notNull().defaultNow(),
});

export const scripterUsageTable = pgTable("scripter_usage", {
  id:        integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:    text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  usageDate: date("usage_date").notNull(),
  count:     integer("count").notNull().default(1),
}, (t) => [
  unique().on(t.userId, t.usageDate),
]);

export const scripterDraftsTable = pgTable("scripter_drafts", {
  id:            integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:        text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  slot:          integer("slot").notNull(),
  name:          text("name").notNull(),
  funscriptJson: text("funscript_json").notNull(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
  expiresAt:     timestamp("expires_at").notNull(),
}, (t) => [
  unique().on(t.userId, t.slot),
  check("scripter_draft_slot_range", sql`${t.slot} BETWEEN 1 AND 3`),
]);

export const scripterSessionsTable = pgTable("scripter_sessions", {
  id:            integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:        text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  name:          text("name").notNull(),
  funscriptJson: text("funscript_json").notNull(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique().on(t.userId, t.name),
]);


export const communityScriptsTable = pgTable("community_scripts", {
  id:              integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:          text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  username:        text("username").notNull(),
  title:           text("title").notNull(),
  description:     text("description").notNull().default(""),
  videoUrl:        text("video_url").notNull(),
  funscript:       text("funscript").notNull(),
  viewCount:       integer("view_count").notNull().default(0),
  tags:            text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  cachedVideoUrl:  text("cached_video_url"),
  cacheStatus:     text("cache_status").notNull().default("pending"),
}, (t) => [
  index("community_scripts_tags_gin_idx").using("gin", t.tags),
  unique("community_scripts_user_video_unique").on(t.userId, t.videoUrl),
]);

export const communityFavoritesTable = pgTable("community_favorites", {
  userId:   text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  scriptId: integer("script_id").notNull().references(() => communityScriptsTable.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.scriptId] }),
]);

export const communityRatingsTable = pgTable("community_ratings", {
  userId:   text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  scriptId: integer("script_id").notNull().references(() => communityScriptsTable.id, { onDelete: "cascade" }),
  rating:   integer("rating").notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.scriptId] }),
  check("rating_range", sql`${t.rating} BETWEEN 1 AND 5`),
]);

export const chatPersonasTable = pgTable("chat_personas", {
  id:              integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:          text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  name:            text("name").notNull(),
  avatarUrl:       text("avatar_url"),
  description:     text("description").notNull().default(""),
  personality:     text("personality").notNull().default(""),
  scenario:        text("scenario").notNull().default(""),
  greeting:        text("greeting").notNull().default(""),
  exampleDialogue: text("example_dialogue").notNull().default(""),
  source:          text("source").notNull().default("manual"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export const chatConversationsTable = pgTable("chat_conversations", {
  id:        integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:    text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  title:     text("title").notNull().default("New Chat"),
  mode:      text("mode").notNull().default("general"),
  personaId: integer("persona_id").references(() => chatPersonasTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id:             integer("id").generatedAlwaysAsIdentity().primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => chatConversationsTable.id, { onDelete: "cascade" }),
  role:           text("role").notNull(),
  content:        text("content").notNull(),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export const feedbackTable = pgTable("feedback", {
  id:        integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:    text("user_id"),
  userEmail: text("user_email"),
  category:  text("category").notNull().default("other"),
  message:   text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const analyticsEventsTable = pgTable("analytics_events", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull(),
  feature:   text("feature").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("analytics_events_user_idx").on(t.userId, t.createdAt),
  index("analytics_events_feature_idx").on(t.feature, t.createdAt),
]);

export const hapticaiReleasesTable = pgTable("hapticai_releases", {
  id:         serial("id").primaryKey(),
  platform:   text("platform").notNull(),
  version:    text("version").notNull(),
  sizeBytes:  bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("hapticai_releases_platform_idx").on(t.platform, t.uploadedAt),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export type ChatPersona = typeof chatPersonasTable.$inferSelect;
export type ChatConversation = typeof chatConversationsTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;

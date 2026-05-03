import { pgTable, text, boolean, timestamp, integer, date, unique, primaryKey, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  clerkId:            text("clerk_id").primaryKey(),
  username:           text("username").notNull().unique(),
  ageVerified:        boolean("age_verified").notNull(),
  plan:               text("plan").notNull().default("free"),
  stripeCustomerId:   text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
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

export const privateLibraryTable = pgTable("private_library", {
  id:            integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:        text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  title:         text("title").notNull(),
  videoUrl:      text("video_url"),
  localFilePath: text("local_file_path"),
  funscript:     text("funscript").notNull(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

export const privateLibraryFunscriptsTable = pgTable("private_library_funscripts", {
  id:            integer("id").generatedAlwaysAsIdentity().primaryKey(),
  libraryId:     integer("library_id").notNull().references(() => privateLibraryTable.id, { onDelete: "cascade" }),
  userId:        text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  name:          text("name").notNull(),
  funscriptJson: text("funscript_json").notNull(),
  isActive:      boolean("is_active").notNull().default(false),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique().on(t.libraryId, t.name),
]);

export const communityScriptsTable = pgTable("community_scripts", {
  id:          integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:      text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  username:    text("username").notNull(),
  title:       text("title").notNull(),
  description: text("description").notNull().default(""),
  videoUrl:    text("video_url").notNull(),
  funscript:   text("funscript").notNull(),
  viewCount:   integer("view_count").notNull().default(0),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

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

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export type ChatPersona = typeof chatPersonasTable.$inferSelect;
export type ChatConversation = typeof chatConversationsTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;

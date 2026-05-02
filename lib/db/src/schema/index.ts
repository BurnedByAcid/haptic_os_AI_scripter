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

export const privateLibraryTable = pgTable("private_library", {
  id:            integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId:        text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  title:         text("title").notNull(),
  videoUrl:      text("video_url"),
  localFilePath: text("local_file_path"),
  funscript:     text("funscript").notNull(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

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

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

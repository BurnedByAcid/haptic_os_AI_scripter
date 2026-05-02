import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  clerkId:     text("clerk_id").primaryKey(),
  username:    text("username").notNull().unique(),
  ageVerified: boolean("age_verified").notNull(),
  plan:        text("plan").notNull().default("free"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

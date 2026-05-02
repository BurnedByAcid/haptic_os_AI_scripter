import { pgTable, text, boolean, timestamp, integer, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const estimates = sqliteTable("estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerName: text("customer_name").notNull(),
  moveType: text("move_type").notNull(), // "local" or "long_distance"
  weightLbs: integer("weight_lbs").notNull(),
  hourlyRate: real("hourly_rate").notNull(),
  trucks26ft: integer("trucks_26ft").notNull(),
  trucks17ft: integer("trucks_17ft").notNull(),
  numMovers: integer("num_movers").notNull(),
  numHours: real("num_hours").notNull(),
  totalLaborHours: real("total_labor_hours").notNull(),
  laborCost: real("labor_cost").notNull(),
  uhaulCost: real("uhaul_cost"),
  totalEstimate: real("total_estimate").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
});

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// Load time reference data from the spreadsheet
export const loadTimeData = [
  { weightLbs: 2000, trucks26ft: 0, trucks17ft: 1, numMovers: 2, numHours: 3, totalLaborHours: 6 },
  { weightLbs: 4000, trucks26ft: 0, trucks17ft: 1, numMovers: 2, numHours: 6, totalLaborHours: 12 },
  { weightLbs: 6000, trucks26ft: 1, trucks17ft: 0, numMovers: 3, numHours: 6, totalLaborHours: 18 },
  { weightLbs: 8000, trucks26ft: 1, trucks17ft: 1, numMovers: 3, numHours: 8, totalLaborHours: 24 },
  { weightLbs: 10000, trucks26ft: 1, trucks17ft: 1, numMovers: 4, numHours: 7.5, totalLaborHours: 30 },
  { weightLbs: 12000, trucks26ft: 2, trucks17ft: 0, numMovers: 4, numHours: 9, totalLaborHours: 36 },
  { weightLbs: 14000, trucks26ft: 2, trucks17ft: 1, numMovers: 6, numHours: 7, totalLaborHours: 42 },
  { weightLbs: 16000, trucks26ft: 2, trucks17ft: 1, numMovers: 6, numHours: 8, totalLaborHours: 48 },
  { weightLbs: 18000, trucks26ft: 3, trucks17ft: 0, numMovers: 6, numHours: 9, totalLaborHours: 54 },
  { weightLbs: 20000, trucks26ft: 3, trucks17ft: 1, numMovers: 6, numHours: 10, totalLaborHours: 60 },
  { weightLbs: 22000, trucks26ft: 3, trucks17ft: 1, numMovers: 6, numHours: 11, totalLaborHours: 66 },
  { weightLbs: 24000, trucks26ft: 4, trucks17ft: 0, numMovers: 6, numHours: 12, totalLaborHours: 72 },
  { weightLbs: 26000, trucks26ft: 4, trucks17ft: 1, numMovers: 6, numHours: 13, totalLaborHours: 78 },
  { weightLbs: 28000, trucks26ft: 4, trucks17ft: 1, numMovers: 6, numHours: 14, totalLaborHours: 84 },
  { weightLbs: 30000, trucks26ft: 5, trucks17ft: 0, numMovers: 6, numHours: 15, totalLaborHours: 90 },
];

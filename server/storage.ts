import { estimates, type Estimate, type InsertEstimate } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const dbPath = process.env.DATABASE_PATH || "sqlite.db";
const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

export interface IStorage {
  createEstimate(data: InsertEstimate): Estimate;
  getEstimates(): Estimate[];
  getEstimate(id: number): Estimate | undefined;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS estimates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        move_type TEXT NOT NULL,
        weight_lbs INTEGER NOT NULL,
        hourly_rate REAL NOT NULL,
        trucks_26ft INTEGER NOT NULL,
        trucks_17ft INTEGER NOT NULL,
        num_movers INTEGER NOT NULL,
        num_hours REAL NOT NULL,
        total_labor_hours REAL NOT NULL,
        labor_cost REAL NOT NULL,
        packing_hours REAL,
        packing_cost REAL,
        uhaul_cost REAL,
        total_estimate REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      )
    `);

    // Migrate existing databases — add packing columns if they don't exist yet
    const cols = sqlite.prepare("PRAGMA table_info(estimates)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    if (!colNames.includes("packing_hours")) {
      sqlite.exec("ALTER TABLE estimates ADD COLUMN packing_hours REAL");
    }
    if (!colNames.includes("packing_cost")) {
      sqlite.exec("ALTER TABLE estimates ADD COLUMN packing_cost REAL");
    }
  }

  createEstimate(data: InsertEstimate): Estimate {
    return db.insert(estimates).values(data).returning().get();
  }

  getEstimates(): Estimate[] {
    return db.select().from(estimates).orderBy(desc(estimates.id)).all();
  }

  getEstimate(id: number): Estimate | undefined {
    return db.select().from(estimates).where(eq(estimates.id, id)).get();
  }
}

export const storage = new DatabaseStorage();

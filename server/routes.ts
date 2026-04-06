import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEstimateSchema } from "@shared/schema";
import { generateQuotePDF } from "./pdf";
import { lookupUhaulPricing, suggestLocations } from "./uhaul";

export async function registerRoutes(httpServer: Server, app: Express) {
  app.post("/api/estimates", (req, res) => {
    try {
      const parsed = insertEstimateSchema.parse(req.body);
      const estimate = storage.createEstimate(parsed);
      res.json(estimate);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/estimates", (_req, res) => {
    const estimates = storage.getEstimates();
    res.json(estimates);
  });

  app.get("/api/estimates/:id", (req, res) => {
    const estimate = storage.getEstimate(Number(req.params.id));
    if (!estimate) return res.status(404).json({ error: "Not found" });
    res.json(estimate);
  });

  // Generate PDF quote
  app.post("/api/generate-quote", (req, res) => {
    try {
      generateQuotePDF(res, req.body);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // U-Haul location autocomplete
  app.get("/api/uhaul-suggest", async (req, res) => {
    try {
      const term = String(req.query.term || "");
      if (term.length < 2) return res.json([]);
      const results = await suggestLocations(term);
      res.json(results);
    } catch (e: any) {
      res.json([]);
    }
  });

  // U-Haul pricing lookup
  app.post("/api/uhaul-pricing", async (req, res) => {
    try {
      const { pickup, dropoff, date, tripType } = req.body;
      if (!pickup || !date) {
        return res.status(400).json({ error: "Pickup location and date are required" });
      }
      if (tripType === "one_way" && !dropoff) {
        return res.status(400).json({ error: "Drop-off location is required for one-way trips" });
      }
      // Use HTTP scraper for all trips (falls back to ScrapFly if bot-blocked)
      const resolvedTripType = (tripType === "one_way" || !tripType) ? "one_way" : tripType;
      console.log(`[uhaul] Looking up pricing (${resolvedTripType}):`, pickup, "->", dropoff || "local");
      const result = await lookupUhaulPricing(pickup, dropoff || "", date, resolvedTripType);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

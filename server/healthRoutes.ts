import { Router } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { getLocalDb } from "./dbLocal";
import {
  healthLabReports,
  healthConditions,
  healthMedications,
  healthDietEntries,
  healthRecommendations,
} from "@shared/schema";
import {
  createConditionSchema,
  updateConditionSchema,
  createMedicationSchema,
  updateMedicationSchema,
  createDietEntrySchema,
  updateDietEntrySchema,
} from "@shared/healthSchema";
import type { ParsedLabResult } from "@shared/healthSchema";
import { parseLabReport } from "./services/labReportParser";
import { generateHealthPlan } from "./services/healthAnalysis";
import { isAuthenticated } from "./replitAuth";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

function getUserId(req: any): string | null {
  return req.user?.claims?.sub || req.user?.id || null;
}

// ==================== Lab Reports ====================

router.post("/lab-reports", isAuthenticated, upload.single("file"), async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!req.file) return res.status(400).json({ error: "No PDF file provided" });
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY or GOOGLE_API_KEY not configured. Add it to your .env file for PDF lab report parsing." });
    }

    const db = getLocalDb();
    const parsed = await parseLabReport(req.file.buffer);

    const [report] = await db.insert(healthLabReports).values({
      userId,
      fileName: req.file.originalname,
      reportDate: parsed.reportDate,
      labName: parsed.labName,
      parsedResults: parsed.results,
      rawText: parsed.rawText,
    }).returning();

    res.json(report);
  } catch (error: any) {
    console.error("Lab report upload error:", error);
    res.status(500).json({ error: error.message || "Failed to process lab report" });
  }
});

router.get("/lab-reports", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    const reports = await db.select().from(healthLabReports)
      .where(eq(healthLabReports.userId, userId))
      .orderBy(healthLabReports.createdAt);

    res.json(reports);
  } catch (error: any) {
    console.error("Get lab reports error:", error);
    res.status(500).json({ error: "Failed to fetch lab reports" });
  }
});

router.get("/lab-reports/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    const [report] = await db.select().from(healthLabReports)
      .where(and(eq(healthLabReports.id, req.params.id), eq(healthLabReports.userId, userId)));

    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  } catch (error: any) {
    console.error("Get lab report error:", error);
    res.status(500).json({ error: "Failed to fetch lab report" });
  }
});

router.delete("/lab-reports/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    await db.delete(healthLabReports)
      .where(and(eq(healthLabReports.id, req.params.id), eq(healthLabReports.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete lab report error:", error);
    res.status(500).json({ error: "Failed to delete lab report" });
  }
});

// ==================== Conditions ====================

router.get("/conditions", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    const conditions = await db.select().from(healthConditions)
      .where(eq(healthConditions.userId, userId))
      .orderBy(healthConditions.createdAt);

    res.json(conditions);
  } catch (error: any) {
    console.error("Get conditions error:", error);
    res.status(500).json({ error: "Failed to fetch conditions" });
  }
});

router.post("/conditions", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = createConditionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const db = getLocalDb();
    const [condition] = await db.insert(healthConditions).values({
      userId,
      name: parsed.data.name,
      severity: parsed.data.severity,
      diagnosedDate: parsed.data.diagnosedDate || null,
      notes: parsed.data.notes || null,
    }).returning();

    res.json(condition);
  } catch (error: any) {
    console.error("Create condition error:", error);
    res.status(500).json({ error: "Failed to create condition" });
  }
});

router.put("/conditions/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = updateConditionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const db = getLocalDb();
    const [updated] = await db.update(healthConditions)
      .set(parsed.data)
      .where(and(eq(healthConditions.id, req.params.id), eq(healthConditions.userId, userId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Condition not found" });
    res.json(updated);
  } catch (error: any) {
    console.error("Update condition error:", error);
    res.status(500).json({ error: "Failed to update condition" });
  }
});

router.delete("/conditions/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    await db.delete(healthConditions)
      .where(and(eq(healthConditions.id, req.params.id), eq(healthConditions.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete condition error:", error);
    res.status(500).json({ error: "Failed to delete condition" });
  }
});

// ==================== Medications ====================

router.get("/medications", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    const medications = await db.select().from(healthMedications)
      .where(eq(healthMedications.userId, userId))
      .orderBy(healthMedications.createdAt);

    res.json(medications);
  } catch (error: any) {
    console.error("Get medications error:", error);
    res.status(500).json({ error: "Failed to fetch medications" });
  }
});

router.post("/medications", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = createMedicationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const db = getLocalDb();
    const [medication] = await db.insert(healthMedications).values({
      userId,
      name: parsed.data.name,
      dosage: parsed.data.dosage,
      frequency: parsed.data.frequency,
      timesOfDay: parsed.data.timesOfDay,
      purpose: parsed.data.purpose || null,
      notes: parsed.data.notes || null,
    }).returning();

    res.json(medication);
  } catch (error: any) {
    console.error("Create medication error:", error);
    res.status(500).json({ error: "Failed to create medication" });
  }
});

router.put("/medications/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = updateMedicationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const db = getLocalDb();
    const [updated] = await db.update(healthMedications)
      .set(parsed.data)
      .where(and(eq(healthMedications.id, req.params.id), eq(healthMedications.userId, userId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Medication not found" });
    res.json(updated);
  } catch (error: any) {
    console.error("Update medication error:", error);
    res.status(500).json({ error: "Failed to update medication" });
  }
});

router.delete("/medications/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    await db.delete(healthMedications)
      .where(and(eq(healthMedications.id, req.params.id), eq(healthMedications.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete medication error:", error);
    res.status(500).json({ error: "Failed to delete medication" });
  }
});

// ==================== Diet Entries ====================

router.get("/diet", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    const entries = await db.select().from(healthDietEntries)
      .where(eq(healthDietEntries.userId, userId))
      .orderBy(healthDietEntries.createdAt);

    res.json(entries);
  } catch (error: any) {
    console.error("Get diet entries error:", error);
    res.status(500).json({ error: "Failed to fetch diet entries" });
  }
});

router.post("/diet", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = createDietEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const db = getLocalDb();
    const [entry] = await db.insert(healthDietEntries).values({
      userId,
      mealType: parsed.data.mealType,
      foods: parsed.data.foods,
      typicalTime: parsed.data.typicalTime || null,
      notes: parsed.data.notes || null,
    }).returning();

    res.json(entry);
  } catch (error: any) {
    console.error("Create diet entry error:", error);
    res.status(500).json({ error: "Failed to create diet entry" });
  }
});

router.put("/diet/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = updateDietEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const db = getLocalDb();
    const [updated] = await db.update(healthDietEntries)
      .set(parsed.data)
      .where(and(eq(healthDietEntries.id, req.params.id), eq(healthDietEntries.userId, userId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Diet entry not found" });
    res.json(updated);
  } catch (error: any) {
    console.error("Update diet entry error:", error);
    res.status(500).json({ error: "Failed to update diet entry" });
  }
});

router.delete("/diet/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    await db.delete(healthDietEntries)
      .where(and(eq(healthDietEntries.id, req.params.id), eq(healthDietEntries.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete diet entry error:", error);
    res.status(500).json({ error: "Failed to delete diet entry" });
  }
});

// ==================== Recommendations ====================

router.post("/recommendations/generate", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured. Add it to your .env file." });
    }

    const db = getLocalDb();

    const [reports, conditions, medications, dietEntries] = await Promise.all([
      db.select().from(healthLabReports).where(eq(healthLabReports.userId, userId)),
      db.select().from(healthConditions).where(eq(healthConditions.userId, userId)),
      db.select().from(healthMedications).where(eq(healthMedications.userId, userId)),
      db.select().from(healthDietEntries).where(eq(healthDietEntries.userId, userId)),
    ]);

    const allLabResults: ParsedLabResult[] = reports.flatMap(
      r => (r.parsedResults as ParsedLabResult[]) || []
    );

    const plan = await generateHealthPlan({
      labResults: allLabResults,
      conditions: conditions.map(c => ({
        id: c.id,
        userId: c.userId,
        name: c.name,
        severity: c.severity as any,
        diagnosedDate: c.diagnosedDate,
        notes: c.notes,
        createdAt: c.createdAt?.toISOString() || new Date().toISOString(),
      })),
      medications: medications.map(m => ({
        id: m.id,
        userId: m.userId,
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        timesOfDay: (m.timesOfDay as any[]) || [],
        purpose: m.purpose,
        notes: m.notes,
        createdAt: m.createdAt?.toISOString() || new Date().toISOString(),
      })),
      dietEntries: dietEntries.map(d => ({
        id: d.id,
        userId: d.userId,
        mealType: d.mealType as any,
        foods: (d.foods as string[]) || [],
        typicalTime: d.typicalTime,
        notes: d.notes,
        createdAt: d.createdAt?.toISOString() || new Date().toISOString(),
      })),
    });

    const [recommendation] = await db.insert(healthRecommendations).values({
      userId,
      medicationSchedule: plan.medicationSchedule,
      mealPlan: plan.mealPlan,
      foodAdjustments: plan.foodAdjustments,
      exerciseRoutine: plan.exerciseRoutine,
      insights: plan.insights,
      summary: plan.summary,
    }).returning();

    res.json(recommendation);
  } catch (error: any) {
    console.error("Generate recommendations error:", error);
    res.status(500).json({ error: error.message || "Failed to generate health plan" });
  }
});

router.get("/recommendations", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = getLocalDb();
    const recommendations = await db.select().from(healthRecommendations)
      .where(eq(healthRecommendations.userId, userId))
      .orderBy(healthRecommendations.generatedAt);

    const latest = recommendations.at(-1) || null;
    res.json(latest);
  } catch (error: any) {
    console.error("Get recommendations error:", error);
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
});

export default router;

import { GoogleGenAI } from "@google/genai";
import type { ParsedLabResult } from "@shared/healthSchema";

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

let _ai: GoogleGenAI | null | undefined = undefined;

function getAi(): GoogleGenAI | null {
  if (_ai === undefined) _ai = getGeminiClient();
  return _ai;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // Used for rawText storage when Gemini is used with native PDF input
  const { PDFParse } = await import("pdf-parse");
  // @ts-ignore - pdf-parse v2 uses PDFParse class
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text || "";
}

const LAB_REPORT_JSON_PROMPT = `You are a medical lab report parser. Analyze the attached lab report PDF and return structured JSON.

For each test result found, extract:
- testName: The name of the test (e.g., "Hemoglobin", "Fasting Glucose", "TSH")
- value: The numeric value or string if non-numeric (e.g., 13.5 or "Reactive")
- unit: The unit of measurement (e.g., "g/dL", "mg/dL", "mIU/L")
- referenceRange: The normal reference range as a string (e.g., "12.0-16.0", "70-100")
- flag: One of "normal", "high", "low", "critical_high", "critical_low" based on whether the value is within, above, or far above/below the reference range
- category: Group the test into a category (e.g., "Complete Blood Count", "Lipid Panel", "Thyroid", "Liver Function", "Kidney Function", "Metabolic Panel", "Vitamins", "Hormones", "Diabetes", "Iron Studies")

Also extract:
- reportDate: The date of the report if found (ISO format YYYY-MM-DD), or null
- labName: The name of the laboratory if found, or null

Return ONLY valid JSON in this exact format, no markdown or explanation:
{
  "results": [
    {
      "testName": "...",
      "value": ...,
      "unit": "...",
      "referenceRange": "...",
      "flag": "normal|high|low|critical_high|critical_low",
      "category": "..."
    }
  ],
  "reportDate": "YYYY-MM-DD" or null,
  "labName": "..." or null
}`;

export async function analyzeLabReportWithPdf(buffer: Buffer): Promise<{
  results: ParsedLabResult[];
  reportDate: string | null;
  labName: string | null;
}> {
  const ai = getAi();
  if (!ai) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not configured. Add it to your .env file.");
  }

  const base64Pdf = buffer.toString("base64");

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: LAB_REPORT_JSON_PROMPT },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Pdf,
            },
          },
        ],
      },
    ],
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response from Gemini");
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) {
    throw new Error("Failed to parse structured data from Gemini response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    results: (parsed.results || []) as ParsedLabResult[],
    reportDate: parsed.reportDate ?? null,
    labName: parsed.labName ?? null,
  };
}

export async function analyzeLabReport(rawText: string): Promise<{
  results: ParsedLabResult[];
  reportDate: string | null;
  labName: string | null;
}> {
  const ai = getAi();
  if (!ai) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not configured. Add it to your .env file.");
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: `${LAB_REPORT_JSON_PROMPT}

Lab report text:
${rawText}`,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response from Gemini");
  }

  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) {
    throw new Error("Failed to parse structured data from Gemini response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    results: (parsed.results || []) as ParsedLabResult[],
    reportDate: parsed.reportDate ?? null,
    labName: parsed.labName ?? null,
  };
}

export async function parseLabReport(buffer: Buffer): Promise<{
  results: ParsedLabResult[];
  reportDate: string | null;
  labName: string | null;
  rawText: string;
}> {
  if (!getAi()) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not configured. Add it to your .env file.");
  }

  // Use Gemini with native PDF input (handles image-based and complex layouts)
  const analysis = await analyzeLabReportWithPdf(buffer);

  // Get raw text for storage (fallback extraction; may be empty for image-only PDFs)
  let rawText: string;
  try {
    rawText = await extractTextFromPdf(buffer);
  } catch {
    rawText = "";
  }
  if (!rawText.trim()) {
    rawText = "(PDF content extracted via Gemini; no text layer in file)";
  }

  return {
    ...analysis,
    rawText,
  };
}

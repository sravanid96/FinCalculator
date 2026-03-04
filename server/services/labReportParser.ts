/**
 * Lab report PDF parser.
 *
 * PRIVACY: By default, parsing is LOCAL-ONLY (no data is sent to any external API).
 * - Set LAB_REPORT_USE_AI=true and GEMINI_API_KEY to use Google Gemini for parsing.
 * - When AI is used: data is sent to Google's API. Google's policy states API data
 *   is not used to train models; see https://ai.google.dev/gemini-api/docs/usage-policies
 * - For maximum privacy: leave LAB_REPORT_USE_AI unset or false — only local parsing runs.
 */

import { GoogleGenAI } from "@google/genai";
import type { ParsedLabResult } from "@shared/healthSchema";

// --- Privacy: AI is opt-in. Data is never sent to external services unless explicitly enabled. ---
function isAiAllowed(): boolean {
  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!key) return false;
  const useAi = (process.env.LAB_REPORT_USE_AI || "").toLowerCase();
  return useAi === "true" || useAi === "1" || useAi === "yes";
}

function getGeminiClient(): GoogleGenAI | null {
  if (!isAiAllowed()) return null;
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
  const { PDFParse } = await import("pdf-parse");
  // @ts-ignore - pdf-parse v2 uses PDFParse class
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text || "";
}

// --- Local-only parser: no data leaves the server. Keeps lab data fully private. ---
const COMMON_UNITS =
  /(?:g\/dL|mg\/dL|mmol\/L|mIU\/L|IU\/L|ng\/mL|pg\/mL|U\/L|µg\/dL|mg\/L|pg\/dL|fL|pg|g\/L|%\s*|cells\/µL|10\^3\/µL|10\^9\/L)/gi;
// Reference range: optional prefix (e.g. "M ", "F ", "Male "), then low-high
const REF_RANGE = /(?:[MF]\s*|Male\s*|Female\s*)?(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/;
const REF_RANGE_STRIP = /(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/;

function inferCategory(testName: string): string {
  const lower = testName.toLowerCase();
  if (/\b(hemoglobin|hgb|rbc|wbc|platelet|hct|hematocrit|mcv|mch)\b/.test(lower)) return "Complete Blood Count";
  if (/\b(glucose|a1c|hb a1c|glycated)\b/.test(lower)) return "Diabetes";
  if (/\b(tsh|t4|t3|thyroid)\b/.test(lower)) return "Thyroid";
  if (/\b(cholesterol|ldl|hdl|triglyceride|lipid)\b/.test(lower)) return "Lipid Panel";
  if (/\b(alt|ast|alp|bilirubin|albumin| liver)\b/.test(lower)) return "Liver Function";
  if (/\b(creatinine|bun|egfr|kidney)\b/.test(lower)) return "Kidney Function";
  if (/\b(sodium|potassium|chloride|co2|bicarb|calcium)\b/.test(lower)) return "Metabolic Panel";
  if (/\b(vitamin|b12|folate|d|iron|ferritin|tibc)\b/.test(lower)) return "Vitamins";
  return "General";
}

function parseReferenceRange(refStr: string): { low: number; high: number } | null {
  const m = REF_RANGE_STRIP.exec(refStr);
  if (!m) return null;
  const low = Number.parseFloat(m[1]);
  const high = Number.parseFloat(m[2]);
  if (Number.isNaN(low) || Number.isNaN(high)) return null;
  return { low, high };
}

/** Find first substring that looks like a reference range (e.g. "12.0-16.0" or "M 13.0-17.0") */
function findRefRangeInString(s: string): { refStr: string; low: number; high: number } | null {
  const m = s.match(REF_RANGE);
  if (!m) return null;
  const refStr = m[0].trim();
  const low = Number.parseFloat(m[1]);
  const high = Number.parseFloat(m[2]);
  if (Number.isNaN(low) || Number.isNaN(high)) return null;
  return { refStr, low, high };
}

function inferFlag(
  value: number,
  refLow: number,
  refHigh: number
): "normal" | "high" | "low" | "critical_high" | "critical_low" {
  const margin = (refHigh - refLow) * 0.2;
  if (value >= refLow && value <= refHigh) return "normal";
  if (value > refHigh) {
    return value >= refHigh + margin * 2 ? "critical_high" : "high";
  }
  return value <= refLow - margin * 2 ? "critical_low" : "low";
}

/** Normalize date string to YYYY-MM-DD */
function normalizeDate(d: string): string {
  const str = d.trim();
  if (str.includes("-") && /^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parts = str.split(/[/-]/).map((p) => p.trim());
  if (parts.length !== 3) return str;
  let month = Number.parseInt(parts[0], 10);
  let day = Number.parseInt(parts[1], 10);
  let year = Number.parseInt(parts[2], 10);
  if (year < 100) year += 2000;
  if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year)) return str;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse one line as tabular row (Quest-style: Test  Result  Unit  Ref Range) */
function parseLineAsColumns(
  line: string
): { testName: string; value: number; unit: string; refStr: string; refLow: number; refHigh: number } | null {
  const tokens = line.split(/\s{2,}|\t/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 2) return null;

  let valueNum: number | undefined;
  let valueIdx = -1;
  let refIdx = -1;
  let refStr = "";
  let refLow = 0;
  let refHigh = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const ref = findRefRangeInString(t);
    if (ref && refIdx < 0) {
      refIdx = i;
      refStr = ref.refStr;
      refLow = ref.low;
      refHigh = ref.high;
    }
    const num = Number.parseFloat(t.replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(num) && /^\d+\.?\d*\s*[HL]?$/i.test(t) && valueIdx < 0 && refIdx !== i) {
      valueNum = num;
      valueIdx = i;
    }
  }

  if (valueNum === undefined || refIdx < 0) return null;
  const testNameTokens = valueIdx > 0 ? tokens.slice(0, valueIdx) : [];
  const testName = testNameTokens.join(" ").trim();
  if (testName.length < 2) return null;

  let unit = "";
  const unitRegex = /(?:g\/dL|mg\/dL|mmol\/L|mIU\/L|IU\/L|ng\/mL|pg\/mL|U\/L|µg\/dL|mg\/L|pg\/dL|fL|pg|g\/L|%\s*|cells\/µL|10\^3\/µL|10\^9\/L)/i;
  for (let i = valueIdx + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (unitRegex.test(t)) {
      unit = t;
      break;
    }
  }
  if (!unit && refIdx > valueIdx && refIdx < tokens.length) {
    const refToken = tokens[refIdx]!;
    const unitInRef = refToken.match(unitRegex);
    if (unitInRef) unit = unitInRef[0].trim();
  }

  return { testName, value: valueNum, unit, refStr, refLow, refHigh };
}

/**
 * Parse lab report from raw text only. No external API calls — data stays private.
 * Supports Quest Diagnostics and other tabular lab report formats.
 */
export function parseLabReportFromText(rawText: string): {
  results: ParsedLabResult[];
  reportDate: string | null;
  labName: string | null;
} {
  const results: ParsedLabResult[] = [];
  let reportDate: string | null = null;
  let labName: string | null = null;

  if (/quest\s*diagnostics/i.test(rawText)) labName = "Quest Diagnostics";

  // Extract date: multiple patterns (Quest uses "Collection", "Received", "Reported")
  const dateMatch1 = rawText.match(
    /(?:report\s+date|date\s+of\s+report|collected?|specimen|collection\s+date|received|reported)[:\s]*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  );
  if (dateMatch1) {
    reportDate = normalizeDate(dateMatch1[1]!);
  } else {
    const anyDate = rawText.match(/\b(\d{4}-\d{2}-\d{2})\b/) ?? rawText.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
    if (anyDate) reportDate = normalizeDate(anyDate[1]!);
  }

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();

  for (const line of lines) {
    if (line.length < 4) continue;
    if (/^(test|component|result|value|reference|unit|ref\.? range|analyte|specimen)/i.test(line)) continue;
    if (/^(date|patient|name|dob|id\s*#|account|physician)/i.test(line)) continue;
    if (/^[\d\s\-\.]+$/.test(line)) continue;

    // Strategy 1: Column-based (Quest-style table: Test  Result  Unit  Ref)
    const colResult = parseLineAsColumns(line);
    if (colResult) {
      const key = `${colResult.testName}:${colResult.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        const flag = inferFlag(colResult.value, colResult.refLow, colResult.refHigh);
        results.push({
          testName: colResult.testName.replaceAll(/\s+/g, " "),
          value: colResult.value,
          unit: colResult.unit,
          referenceRange: colResult.refStr.replaceAll(/\s+/g, " "),
          flag,
          category: inferCategory(colResult.testName),
        });
      }
      continue;
    }

    // Strategy 2: Line-based — one or multiple ref ranges per line (e.g. Quest with few newlines)
    const refRangeRegex = /(?:[MF]\s*|Male\s*|Female\s*)?(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/g;
    let refMatch: RegExpExecArray | null;
    let lastEnd = 0;
    while ((refMatch = refRangeRegex.exec(line)) !== null) {
      const refStr = refMatch[0].trim();
      const refLow = Number.parseFloat(refMatch[1]);
      const refHigh = Number.parseFloat(refMatch[2]);
      if (Number.isNaN(refLow) || Number.isNaN(refHigh)) continue;

      const segment = line.substring(lastEnd, refMatch.index).trim();
      lastEnd = refRangeRegex.lastIndex;

      const valueNumMatch = segment.match(/(\d+\.?\d*)\s*$/);
      let valueNum: number | undefined;
      let testName: string;
      if (valueNumMatch) {
        valueNum = Number.parseFloat(valueNumMatch[1]);
        testName = segment.substring(0, valueNumMatch.index ?? 0).trim();
      } else {
        const numbers = segment.match(/(\d+\.?\d*)/g);
        if (numbers && numbers.length > 0) {
          const last = numbers.at(-1);
          valueNum = last ? Number.parseFloat(last) : undefined;
          testName = segment.replace(/\d+\.?\d*\s*$/, "").trim();
        } else continue;
      }

      if (testName.length < 2 || valueNum === undefined || Number.isNaN(valueNum)) continue;

      const key = `${testName}:${valueNum}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const unitMatch = segment.match(COMMON_UNITS);
      const unit = unitMatch ? unitMatch[0].trim() : "";
      const flag = inferFlag(valueNum, refLow, refHigh);

      results.push({
        testName: testName.replaceAll(/\s+/g, " "),
        value: valueNum,
        unit,
        referenceRange: refStr.replaceAll(/\s+/g, " "),
        flag,
        category: inferCategory(testName),
      });
    }
  }

  return { results, reportDate, labName };
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
    throw new Error("Gemini is not enabled. Set LAB_REPORT_USE_AI=true and GEMINI_API_KEY to use AI parsing.");
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
    throw new Error("Gemini is not enabled. Set LAB_REPORT_USE_AI=true and GEMINI_API_KEY to use AI parsing.");
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

/** User-facing message when Gemini is unavailable. Never expose raw API JSON. */
function toUserFriendlyAiError(_err: unknown): Error {
  const msg = _err && typeof _err === "object" && "message" in _err ? String((_err as { message: unknown }).message) : "";
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota") || msg.includes("exceeded")) {
    return new Error(
      "AI parsing is temporarily unavailable (rate limit). Try again in a few minutes or use a PDF with selectable text so it can be parsed locally."
    );
  }
  return new Error("AI parsing failed. Try again or use a PDF with selectable text for local parsing.");
}

/**
 * Parse lab report PDF. Uses LOCAL-ONLY parsing by default (no data sent externally).
 * Set LAB_REPORT_USE_AI=true and GEMINI_API_KEY to use Google Gemini; otherwise
 * only local text parsing runs — data stays private on your server.
 */
export async function parseLabReport(buffer: Buffer): Promise<{
  results: ParsedLabResult[];
  reportDate: string | null;
  labName: string | null;
  rawText: string;
}> {
  let rawText: string;
  try {
    rawText = await extractTextFromPdf(buffer);
  } catch {
    rawText = "";
  }

  const useAi = isAiAllowed() && getAi();
  const hasText = rawText.trim().length > 0;

  // When we have extracted text: try local parsing first to avoid hitting Gemini quota for text-based PDFs (e.g. Quest)
  if (hasText) {
    const local = parseLabReportFromText(rawText);
    if (local.results.length > 0) {
      return { ...local, rawText };
    }
  }

  // No local results: use AI if enabled (e.g. image PDF or complex layout)
  if (useAi) {
    try {
      const analysis = await analyzeLabReportWithPdf(buffer);
      if (!hasText) {
        rawText = "(PDF processed with AI; no text layer in file)";
      }
      return { ...analysis, rawText };
    } catch (err) {
      if (hasText) {
        const local = parseLabReportFromText(rawText);
        return { ...local, rawText };
      }
      throw toUserFriendlyAiError(err);
    }
  }

  // Default: local-only parsing. No data is sent to any external service.
  if (!rawText.trim()) {
    return {
      results: [],
      reportDate: null,
      labName: null,
      rawText: "(Could not extract text from PDF. For image-based PDFs, set LAB_REPORT_USE_AI=true and GEMINI_API_KEY to use AI parsing.)",
    };
  }

  const local = parseLabReportFromText(rawText);
  return { ...local, rawText };
}

/**
 * SWAI KH-02 — Google Trends Explore CSV Import Validator & Parser
 *
 * Implements strict provenance and structural validation for official Google Trends Explore CSVs:
 * - SHA-256 checksum computation of the original file
 * - Structural verification of official Google Trends export headers ("Interest over time", category, date columns)
 * - Extraction of exact keyword, geographic region, and date range
 * - Verifiable provenance reference formatting:
 *   csv-import:google-trends-explore:sha256:<hash>:q=<query>:geo=<geo>:start=<start>:end=<end>:imported=<timestamp>
 * - Idempotent database ingestion into ProductDemandObservation
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { DemandDataPoint } from "./temporalDemandEngine";

export const GOOGLE_TRENDS_CSV_STORAGE_DIR = path.resolve(
  process.cwd(),
  "data/google_trends_imports"
);

export function saveOriginalGoogleTrendsCsvFile(
  rawCsvContent: string,
  sha256Checksum?: string
): string {
  const computedHash = createHash("sha256")
    .update(Buffer.from(rawCsvContent, "utf8"))
    .digest("hex")
    .toLowerCase();

  if (sha256Checksum) {
    const cleanProvided = String(sha256Checksum).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(cleanProvided)) {
      throw new Error(`Invalid sha256Checksum format '${sha256Checksum}'; must be full 64 hexadecimal characters.`);
    }
    if (cleanProvided !== computedHash) {
      throw new Error(`Checksum mismatch: provided '${cleanProvided}', computed from actual bytes '${computedHash}'.`);
    }
  }

  const storageDirResolved = path.resolve(GOOGLE_TRENDS_CSV_STORAGE_DIR);
  if (!fs.existsSync(storageDirResolved)) {
    fs.mkdirSync(storageDirResolved, { recursive: true });
  }

  const filePath = path.join(storageDirResolved, `${computedHash}.csv`);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(storageDirResolved + path.sep)) {
    throw new Error(`Path traversal attempt detected in CSV file resolution: '${filePath}'.`);
  }

  if (fs.existsSync(resolvedPath)) {
    const stat = fs.lstatSync(resolvedPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Target file '${resolvedPath}' is a symbolic link; symlink targets are prohibited.`);
    }
    const existingBytes = fs.readFileSync(resolvedPath);
    const existingHash = createHash("sha256").update(existingBytes).digest("hex").toLowerCase();
    if (existingHash === computedHash) {
      return resolvedPath;
    }
    throw new Error(`Hash conflict in storage: existing file hash '${existingHash}' does not match computed '${computedHash}'.`);
  }

  // Atomic persistence via temporary file on same directory
  const tempPath = path.join(
    storageDirResolved,
    `.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, rawCsvContent, "utf8");
    fs.renameSync(tempPath, resolvedPath);

    // Post-write verification: ensure file is not a symlink and bytes match
    const finalStat = fs.lstatSync(resolvedPath);
    if (finalStat.isSymbolicLink()) {
      try { fs.unlinkSync(resolvedPath); } catch {}
      throw new Error(`Target file '${resolvedPath}' was resolved as a symbolic link after write.`);
    }
    const writtenBytes = fs.readFileSync(resolvedPath);
    const writtenHash = createHash("sha256").update(writtenBytes).digest("hex").toLowerCase();
    if (writtenHash !== computedHash) {
      try { fs.unlinkSync(resolvedPath); } catch {}
      throw new Error(`Post-write hash verification failed: expected '${computedHash}', got '${writtenHash}'.`);
    }
    return resolvedPath;
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}

export function verifyStoredCsvFile(sha256Checksum: string): {
  exists: boolean;
  validHash: boolean;
  filePath: string | null;
} {
  if (!sha256Checksum || typeof sha256Checksum !== "string" || sha256Checksum.length !== 64) {
    return { exists: false, validHash: false, filePath: null };
  }

  // Path traversal & full 64-hex verification (P0-2 requirement: reject 16..63 prefixes)
  const cleanChecksum = sha256Checksum.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleanChecksum)) {
    return { exists: false, validHash: false, filePath: null };
  }

  const storageDirResolved = path.resolve(GOOGLE_TRENDS_CSV_STORAGE_DIR);
  const filePath = path.join(storageDirResolved, `${cleanChecksum}.csv`);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(storageDirResolved + path.sep)) {
    return { exists: false, validHash: false, filePath: null };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { exists: false, validHash: false, filePath: null };
  }

  try {
    const stat = fs.lstatSync(resolvedPath);
    if (stat.isSymbolicLink()) {
      return { exists: false, validHash: false, filePath: null };
    }

    const bytes = fs.readFileSync(resolvedPath);
    const computedHash = createHash("sha256").update(bytes).digest("hex").toLowerCase();
    const validHash = computedHash === cleanChecksum;
    return {
      exists: true,
      validHash,
      filePath: resolvedPath,
    };
  } catch {
    return { exists: false, validHash: false, filePath: null };
  }
}

export interface GoogleTrendsCsvValidationResult {
  valid: boolean;
  sha256Checksum: string;
  keyword: string | null;
  region: string | null;
  startDate: string | null;
  endDate: string | null;
  cadence?: "DAILY" | "WEEKLY" | "MONTHLY" | null;
  dataPointsCount: number;
  dataPoints: Array<{
    periodStart: string;
    periodEnd: string;
    demandValue: number;
    region: string;
    keyword: string;
  }>;
  evidenceReference: string | null;
  errors: string[];
}

/**
 * Validates and parses raw text content of an official Google Trends Explore CSV export.
 */
export function validateAndParseGoogleTrendsCsv(
  csvContent: string,
  options: {
    expectedKeyword?: string;
    canonicalProductName?: string;
    expectedRegion?: string;
    importedAt?: string;
  } = {}
): GoogleTrendsCsvValidationResult {
  const errors: string[] = [];
  const sha256Checksum = createHash("sha256").update(csvContent, "utf8").digest("hex");
  const importedAt = options.importedAt || new Date().toISOString();
  const effectiveExpectedKeyword = options.expectedKeyword || options.canonicalProductName;

  if (!csvContent || typeof csvContent !== "string" || csvContent.trim().length === 0) {
    return {
      valid: false,
      sha256Checksum,
      keyword: null,
      region: null,
      startDate: null,
      endDate: null,
      dataPointsCount: 0,
      dataPoints: [],
      evidenceReference: null,
      errors: ["CSV content is empty."],
    };
  }

  const lines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  // 1. Verify official Google Trends signature headers
  // Official exports contain "Category:" and "Interest over time" (or "Web Search")
  const hasInterestOverTimeHeader = lines.some((l) => /^Interest over time/i.test(l));
  const hasCategoryHeader = lines.some((l) => /^Category:/i.test(l) || /All categories/i.test(l) || /Web Search/i.test(l));

  if (!hasInterestOverTimeHeader && !hasCategoryHeader) {
    errors.push("Missing official Google Trends Explore signature headers ('Category:' or 'Interest over time').");
  }

  // 2. Locate the column header line: e.g. "Week,automatic cat feeder: (United States)" or "Day,..."
  let headerIndex = -1;
  let rawColumnHeader = "";
  let extractedCadence: "DAILY" | "WEEKLY" | "MONTHLY" | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cadenceMatch = line.match(/^(Week|Day|Month|Date)\s*,/i);
    if (cadenceMatch) {
      headerIndex = i;
      rawColumnHeader = line;
      const c = cadenceMatch[1].toLowerCase();
      if (c === "week") extractedCadence = "WEEKLY";
      else if (c === "day") extractedCadence = "DAILY";
      else if (c === "month") extractedCadence = "MONTHLY";
      break;
    }
  }

  if (headerIndex === -1) {
    errors.push("Could not find valid Google Trends time series column header (e.g. 'Week,keyword: (Region)').");
    return {
      valid: false,
      sha256Checksum,
      keyword: null,
      region: null,
      startDate: null,
      endDate: null,
      dataPointsCount: 0,
      dataPoints: [],
      evidenceReference: null,
      errors,
    };
  }

  // 3. Extract keyword and region from header line
  // Example: "Week,automatic pet feeder: (United States)" -> keyword="automatic pet feeder", region="US"
  const commaIdx = rawColumnHeader.indexOf(",");
  const metricCol = rawColumnHeader.slice(commaIdx + 1).trim();

  let extractedKeyword = "";
  let extractedRegion: string | null = null;

  const matchWithRegion = metricCol.match(/^(.*?):\s*\((.*?)\)$/);
  if (matchWithRegion) {
    extractedKeyword = matchWithRegion[1].trim();
    const regText = matchWithRegion[2].trim().toLowerCase();
    if (regText === "united states" || regText === "us") {
      extractedRegion = "US";
    } else {
      extractedRegion = matchWithRegion[2].trim();
    }
  } else {
    extractedKeyword = metricCol.replace(/[":]/g, "").trim();
  }

  if (options.expectedRegion) {
    const normExpected = options.expectedRegion.trim().toUpperCase();
    if (!extractedRegion) {
      errors.push(
        `CSV header does not specify geographic region; cannot substantiate region expectation '${options.expectedRegion}'.`
      );
    } else if (extractedRegion.toUpperCase() !== normExpected) {
      errors.push(
        `CSV region '${extractedRegion}' does not match expected region '${options.expectedRegion}'.`
      );
    }
  }

  if (effectiveExpectedKeyword && effectiveExpectedKeyword.trim()) {
    const normExpected = effectiveExpectedKeyword.toLowerCase().trim();
    const normExtracted = extractedKeyword.toLowerCase().trim();
    if (!normExtracted.includes(normExpected) && !normExpected.includes(normExtracted)) {
      errors.push(`CSV keyword '${extractedKeyword}' does not match expected keyword '${effectiveExpectedKeyword}'.`);
    }
  }

  // 4. Parse time-series data rows
  const parsedPoints: Array<{
    periodStart: string;
    periodEnd: string;
    demandValue: number;
    region: string;
    keyword: string;
  }> = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.startsWith("#") || /^Category:/i.test(row)) continue;
    const parts = row.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;

    const rawDate = parts[0];
    const rawVal = parts[1];

    // Handle date range format "2026-05-03 - 2026-05-09" or single date "2026-05-03"
    let startDateStr = rawDate;
    let endDateStr = rawDate;
    if (rawDate.includes(" - ")) {
      const dateParts = rawDate.split(" - ");
      startDateStr = dateParts[0].trim();
      endDateStr = dateParts[1].trim();
    }

    const dStart = new Date(startDateStr);
    const dEnd = new Date(endDateStr);
    if (isNaN(dStart.getTime())) continue;

    let demandVal = 0;
    if (rawVal === "<1") {
      demandVal = 0.5;
    } else {
      const parsed = parseFloat(rawVal);
      if (isNaN(parsed) || parsed < 0 || parsed > 100) continue;
      demandVal = parsed;
    }

    parsedPoints.push({
      periodStart: dStart.toISOString(),
      periodEnd: !isNaN(dEnd.getTime()) ? dEnd.toISOString() : dStart.toISOString(),
      demandValue: demandVal,
      region: extractedRegion || "UNKNOWN",
      keyword: extractedKeyword,
    });
  }

  if (parsedPoints.length === 0) {
    errors.push("No valid numeric time series data points found in CSV.");
  }

  // Sort chronologically
  parsedPoints.sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  const startDate = parsedPoints.length > 0 ? parsedPoints[0].periodStart : null;
  const endDate = parsedPoints.length > 0 ? parsedPoints[parsedPoints.length - 1].periodEnd : null;

  const valid = errors.length === 0 && parsedPoints.length >= 3;
  if (parsedPoints.length > 0 && parsedPoints.length < 3) {
    errors.push(`CSV contains only ${parsedPoints.length} points; minimum 3 points required for authoritative demand series.`);
  }

  const safeKeywordTag = encodeURIComponent(extractedKeyword.toLowerCase().replace(/\s+/g, "_"));
  const safeGeoTag = extractedRegion || "UNKNOWN";
  let evidenceReference = valid
    ? `csv-import:google-trends-explore:sha256:${sha256Checksum}:q=${safeKeywordTag}:geo=${safeGeoTag}:start=${startDate?.slice(0, 10)}:end=${endDate?.slice(0, 10)}:imported=${importedAt}`
    : null;

  if (valid) {
    try {
      saveOriginalGoogleTrendsCsvFile(csvContent, sha256Checksum);
    } catch (saveErr: any) {
      errors.push(`Failed to persist raw Google Trends CSV to storage: ${saveErr.message}`);
      evidenceReference = null;
    }
  }

  const effectiveValid = valid && errors.length === 0 && evidenceReference !== null;

  return {
    valid: effectiveValid,
    sha256Checksum,
    keyword: extractedKeyword || null,
    region: extractedRegion,
    startDate,
    endDate,
    cadence: extractedCadence,
    dataPointsCount: parsedPoints.length,
    dataPoints: parsedPoints,
    evidenceReference,
    errors,
  };
}

/**
 * Idempotently imports a verified Google Trends CSV export into SQLite ProductDemandObservation.
 */
export async function importGoogleTrendsCsvToDatabase(
  productId: string,
  csvContent: string,
  options: {
    expectedKeyword?: string;
    region?: string;
    methodologyVersion?: string;
  } = {}
): Promise<{
  success: boolean;
  insertedCount: number;
  skippedCount: number;
  evidenceReference: string | null;
  sha256Checksum: string;
  errors: string[];
}> {
  const validation = validateAndParseGoogleTrendsCsv(csvContent, {
    expectedKeyword: options.expectedKeyword,
    expectedRegion: options.region,
  });

  if (!validation.valid || !validation.evidenceReference) {
    return {
      success: false,
      insertedCount: 0,
      skippedCount: 0,
      evidenceReference: null,
      sha256Checksum: validation.sha256Checksum,
      errors: validation.errors,
    };
  }

  let insertedCount = 0;
  let skippedCount = 0;

  for (const pt of validation.dataPoints) {
    const existing = await prisma.productDemandObservation.findFirst({
      where: {
        productId,
        keyword: pt.keyword,
        region: pt.region,
        periodStart: new Date(pt.periodStart),
      },
    });

    if (existing) {
      skippedCount++;
      continue;
    }

    try {
      await prisma.productDemandObservation.create({
        data: {
          productId,
          source: "GOOGLE_TRENDS_CSV",
          region: pt.region,
          keyword: pt.keyword,
          periodStart: new Date(pt.periodStart),
          periodEnd: new Date(pt.periodEnd),
          demandValue: pt.demandValue,
          valueType: "RELATIVE_INTEREST",
          evidenceReference: validation.evidenceReference,
          methodologyVersion: options.methodologyVersion || "google_trends_csv_v1",
        },
      });
      insertedCount++;
    } catch {
      skippedCount++;
    }
  }

  return {
    success: true,
    insertedCount,
    skippedCount,
    evidenceReference: validation.evidenceReference,
    sha256Checksum: validation.sha256Checksum,
    errors: [],
  };
}

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
import { executeDemandObservationBatchImport } from "./demandObservationBatchImport";

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

export interface GoogleTrendsDataPoint {
  periodStart: string;
  periodEnd: string;
  demandValue: number;
  region: string;
  keyword: string;
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
  dataPoints: GoogleTrendsDataPoint[];
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
    const isSubstring = normExtracted.includes(normExpected) || normExpected.includes(normExtracted);
    const extractedTokens = normExtracted.split(/\s+/).filter((t) => t.length > 2);
    const hasTokenMatch = extractedTokens.length > 0 && extractedTokens.every((t) => normExpected.includes(t));
    if (!isSubstring && !hasTokenMatch) {
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

export type DemandRowVerificationCode =
  | "ROW_VERIFIED"
  | "ROW_NOT_IN_CSV"
  | "DATE_MISMATCH"
  | "VALUE_MISMATCH"
  | "REGION_MISMATCH"
  | "KEYWORD_MISMATCH"
  | "SHA_MISMATCH"
  | "FILE_MISSING"
  | "SOURCE_UNATTESTED"
  | "PRODUCT_MISMATCH";

export interface DemandRowVerificationResult {
  verified: boolean;
  code: DemandRowVerificationCode;
  reason?: string;
  sourceFileSha256?: string;
  matchedRow?: GoogleTrendsDataPoint;
}

/**
 * Validates that an individual product demand observation exists inside an authentic stored CSV file.
 * Verifies exact 64-hex SHA checksum, parses the file, and confirms date, region, keyword, and demandValue match.
 */
export function verifyDemandObservationAgainstRawCsv(
  evidenceRefOrObs: string | null | undefined | { evidenceReference?: string | null; [key: string]: any },
  observation?: {
    keyword?: string | null;
    region?: string | null;
    periodStart: string | Date;
    periodEnd?: string | Date | null;
    demandValue?: number | null;
    productId?: string | null;
  },
  options: {
    expectedKeyword?: string | null;
    candidateTitle?: string | null;
  } = {}
): DemandRowVerificationResult {
  let evidenceReference: string | null | undefined;
  let obs: any;

  if (evidenceRefOrObs && typeof evidenceRefOrObs === "object" && !observation) {
    evidenceReference = (evidenceRefOrObs as any).evidenceReference;
    obs = evidenceRefOrObs;
  } else {
    evidenceReference = typeof evidenceRefOrObs === "string" ? evidenceRefOrObs : null;
    obs = observation;
  }
  const obsData: {
    keyword?: string | null;
    region?: string | null;
    periodStart: string | Date;
    periodEnd?: string | Date | null;
    demandValue?: number | null;
    productId?: string | null;
  } = (observation || obs || {}) as any;

  if (!evidenceReference || typeof evidenceReference !== "string") {
    return {
      verified: false,
      code: "SOURCE_UNATTESTED",
      reason: "No evidence reference provided.",
    };
  }

  let sha256: string | null = null;
  const hashMatch = evidenceReference.match(/\bsha256:([a-f0-9]{64})\b/i);
  if (hashMatch) {
    sha256 = hashMatch[1].toLowerCase();
  } else if (/^[a-f0-9]{64}$/i.test(evidenceReference.trim())) {
    sha256 = evidenceReference.trim().toLowerCase();
  }

  if (!sha256) {
    return {
      verified: false,
      code: "SHA_MISMATCH",
      reason: "Missing or invalid 64-hex SHA-256 in evidence reference.",
    };
  }
  const fileCheck = verifyStoredCsvFile(sha256);
  if (!fileCheck.exists) {
    return {
      verified: false,
      code: "FILE_MISSING",
      sourceFileSha256: sha256,
      reason: `Stored CSV file for SHA '${sha256.slice(0, 12)}...' does not exist.`,
    };
  }

  if (!fileCheck.validHash || !fileCheck.filePath) {
    return {
      verified: false,
      code: "SHA_MISMATCH",
      sourceFileSha256: sha256,
      reason: "Stored CSV file content does not match claimed SHA-256 hash.",
    };
  }

  let rawCsv = "";
  try {
    rawCsv = fs.readFileSync(fileCheck.filePath, "utf8");
  } catch (err: any) {
    return {
      verified: false,
      code: "FILE_MISSING",
      sourceFileSha256: sha256,
      reason: `Failed to read CSV file: ${err.message}`,
    };
  }

  const parsed = validateAndParseGoogleTrendsCsv(rawCsv);
  if (!parsed.valid || !parsed.dataPoints || parsed.dataPoints.length === 0) {
    return {
      verified: false,
      code: "SOURCE_UNATTESTED",
      sourceFileSha256: sha256,
      reason: "Stored CSV failed parsing or contains no data points.",
    };
  }

  // Check keyword alignment
  const obsKw = (obsData.keyword || "").trim().toLowerCase();
  const csvKw = (parsed.keyword || "").trim().toLowerCase();
  const expKw = (options.expectedKeyword || options.candidateTitle || "").trim().toLowerCase();

  if (expKw && csvKw) {
    const normExp = expKw.replace(/[^a-z0-9]/g, " ");
    const normCsv = csvKw.replace(/[^a-z0-9]/g, " ");
    const expWords = new Set(normExp.split(/\s+/).filter((w) => w.length > 2));
    const csvWords = new Set(normCsv.split(/\s+/).filter((w) => w.length > 2));
    let common = 0;
    for (const w of expWords) {
      if (csvWords.has(w)) common++;
    }
    if (common === 0 && !normExp.includes(normCsv) && !normCsv.includes(normExp)) {
      return {
        verified: false,
        code: "PRODUCT_MISMATCH",
        sourceFileSha256: sha256,
        reason: `CSV keyword '${parsed.keyword}' does not match expected candidate '${options.expectedKeyword || options.candidateTitle}'.`,
      };
    }
  }

  if (obsKw && csvKw) {
    const normObs = obsKw.replace(/[^a-z0-9]/g, " ");
    const normCsv = csvKw.replace(/[^a-z0-9]/g, " ");
    if (normObs !== normCsv && !normObs.includes(normCsv) && !normCsv.includes(normObs)) {
      return {
        verified: false,
        code: "KEYWORD_MISMATCH",
        sourceFileSha256: sha256,
        reason: `Observation keyword '${obsData.keyword}' does not match CSV keyword '${parsed.keyword}'.`,
      };
    }
  }

  // Match date and row values
  const obsStartDateStr = new Date(obsData.periodStart).toISOString().slice(0, 10);
  const matchedRow = parsed.dataPoints.find((pt) => {
    const ptStartDateStr = new Date(pt.periodStart).toISOString().slice(0, 10);
    return ptStartDateStr === obsStartDateStr;
  });

  if (!matchedRow) {
    return {
      verified: false,
      code: "ROW_NOT_IN_CSV",
      sourceFileSha256: sha256,
      reason: `No row in CSV matches observation periodStart '${obsStartDateStr}'.`,
    };
  }

  // Compare region
  if (obsData.region) {
    const obsReg = obsData.region.trim().toUpperCase();
    const rowReg = (matchedRow.region || parsed.region || "US").trim().toUpperCase();
    if (obsReg !== rowReg) {
      return {
        verified: false,
        code: "REGION_MISMATCH",
        sourceFileSha256: sha256,
        matchedRow,
        reason: `Observation region '${obsReg}' does not match CSV row region '${rowReg}'.`,
      };
    }
  }

  // Compare periodEnd if provided
  if (obsData.periodEnd && matchedRow.periodEnd) {
    const obsEndStr = new Date(obsData.periodEnd).toISOString().slice(0, 10);
    const rowEndStr = new Date(matchedRow.periodEnd).toISOString().slice(0, 10);
    const rowStartStr = new Date(matchedRow.periodStart).toISOString().slice(0, 10);
    if (obsEndStr !== rowEndStr) {
      const obsEndTime = new Date(obsData.periodEnd).getTime();
      const rowStartTime = new Date(matchedRow.periodStart).getTime();
      const diffDays = Math.round((obsEndTime - rowStartTime) / (1000 * 60 * 60 * 24));
      // Allow weekly observation window (0 to 7 days) if CSV only had single start date
      if (!(rowEndStr === rowStartStr && diffDays >= 0 && diffDays <= 7)) {
        return {
          verified: false,
          code: "DATE_MISMATCH",
          sourceFileSha256: sha256,
          matchedRow,
          reason: `Observation periodEnd '${obsEndStr}' does not match CSV row periodEnd '${rowEndStr}'.`,
        };
      }
    }
  }

  // Compare demandValue
  if (obsData.demandValue !== undefined && obsData.demandValue !== null) {
    if (matchedRow.demandValue === null) {
      return {
        verified: false,
        code: "VALUE_MISMATCH",
        sourceFileSha256: sha256,
        matchedRow,
        reason: `CSV row value is null but observation has '${obsData.demandValue}'.`,
      };
    }
    if (Math.abs(matchedRow.demandValue - obsData.demandValue) > 0.001) {
      return {
        verified: false,
        code: "VALUE_MISMATCH",
        sourceFileSha256: sha256,
        matchedRow,
        reason: `Observation value '${obsData.demandValue}' does not match CSV row value '${matchedRow.demandValue}'.`,
      };
    }
  }

  return {
    verified: true,
    code: "ROW_VERIFIED",
    sourceFileSha256: sha256,
    matchedRow,
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

  try {
    const importRes = await executeDemandObservationBatchImport({
      productId,
      source: "GOOGLE_TRENDS_CSV",
      region: validation.region || options.region || "US",
      evidenceReference: validation.evidenceReference,
      methodologyVersion: options.methodologyVersion || "google_trends_csv_v1",
      points: validation.dataPoints.map((pt) => ({
        keyword: pt.keyword,
        region: pt.region,
        periodStart: pt.periodStart,
        periodEnd: pt.periodEnd,
        demandValue: pt.demandValue,
        evidenceReference: validation.evidenceReference,
        methodologyVersion: options.methodologyVersion || "google_trends_csv_v1",
      })),
    });

    return {
      success: true,
      insertedCount: importRes.insertedCount,
      skippedCount: importRes.skippedCount,
      evidenceReference: validation.evidenceReference,
      sha256Checksum: validation.sha256Checksum,
      errors: [],
    };
  } catch (err: any) {
    return {
      success: false,
      insertedCount: 0,
      skippedCount: 0,
      evidenceReference: validation.evidenceReference,
      sha256Checksum: validation.sha256Checksum,
      errors: [err?.message || String(err)],
    };
  }
}

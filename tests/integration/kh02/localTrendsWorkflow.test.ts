import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/v1/demand/local-trends/route";
import { buildOfficialTrendsExploreUrl, importLocalTrendsCsv, getLocalTrendsWorkflow } from "@/services/kh02/demand/localTrendsWorkflow";
import { GOOGLE_TRENDS_CSV_STORAGE_DIR } from "@/services/kh02/demand/googleTrendsCsvValidator";

const scope = crypto.randomUUID();
const workspaceId = `trends-workspace-${scope}`;
const otherWorkspace = `trends-other-${scope}`;
const productId = `trends-product-${scope}`;
const query = "Stainless Steel Cat Water Fountain";
const ownedFiles = new Set<string>();
function csv(values = [35, 37, 39, 41, 40, 42, 39, 43, 41, 42, 40, 41, 39]) {
  const rows = values.map((value, i) => `${new Date(Date.UTC(2026, 0, 4 + i * 7)).toISOString().slice(0, 10)},${value}`);
  return `Category: All categories\n\nWeek,${query}: (United States)\n${rows.join("\n")}\n`;
}
function input(rawCsv = csv()) {
  const filename = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, crypto.createHash("sha256").update(rawCsv).digest("hex") + ".csv");
  if (!fs.existsSync(filename)) ownedFiles.add(filename);
  return { productId, query, sourceUrl: buildOfficialTrendsExploreUrl(query), rawCsv };
}

beforeEach(async () => {
  await prisma.workspace.upsert({ where: { id: workspaceId }, create: { id: workspaceId, name: "Engineering Trends intake" }, update: {} });
  await prisma.workspace.upsert({ where: { id: otherWorkspace }, create: { id: otherWorkspace, name: "Other engineering scope" }, update: {} });
  await prisma.researchProduct.upsert({ where: { id: productId }, create: { id: productId, title: query, category: "Pets" }, update: {} });
  await prisma.watchlist.upsert({ where: { id: `wl-${scope}` }, create: { id: `wl-${scope}`, name: "Engineering scope", workspaceId }, update: {} });
  await prisma.watchlistItem.upsert({ where: { id: `wi-${scope}` }, create: { id: `wi-${scope}`, watchlistId: `wl-${scope}`, productId, itemType: "PRODUCT" }, update: {} });
  await prisma.productDemandObservation.deleteMany({ where: { productId } });
  await prisma.researchEvidence.deleteMany({ where: { productId } });
});
afterAll(async () => { for (const file of ownedFiles) { try { fs.unlinkSync(file); } catch {} } });

describe("Free local Trends workflow — engineering evidence only", () => {
  it("stores actual DB rows/readback and runs both gates without networking or granting origin authority", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No outbound calls permitted"));
    try {
      const result = await importLocalTrendsCsv(workspaceId, "engineering-importer", input());
      expect(result.automaticAcquisitionAvailable).toBe(false);
      expect(result.imported.insertedCount).toBe(13);
      expect(await prisma.productDemandObservation.count({ where: { productId } })).toBe(13);
      expect(result.authority.businessEligible).toBe(false);
      expect(result.authority.providerOriginVerified).toBe(false);
      expect(result.evaluation?.storedObservations).toBe(13);
      expect(result.evaluation?.g15.coveredDays).toBeGreaterThanOrEqual(60);
      expect(result.evaluation?.g15.eligibleForEvergreen).toBe(false);
      expect(result.evaluation?.g16.eligible).toBe(false);
      expect(result.evaluation?.g16.topThreePublished).toBe(false);
      expect(result.evaluation?.g16.score.evergreenVerification?.identityVerified).toBe(false);
      expect(result.receiptPersisted).toBe(true);
      const receipt = await prisma.researchEvidence.findUnique({ where: { id: result.receiptId } });
      expect(receipt?.classification).toBe("SOURCE_SUBMITTED");
      expect(JSON.parse(receipt!.observedValue!).sourceOriginStatus).toBe("USER_UPLOADED_UNATTESTED");
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it("is idempotent and re-evaluates from durable receipts/rows", async () => {
    const first = await importLocalTrendsCsv(workspaceId, "engineering-importer", input());
    const repeat = await importLocalTrendsCsv(workspaceId, "engineering-importer", input());
    expect(repeat.imported.insertedCount).toBe(0);
    expect(repeat.imported.skippedCount).toBe(13);
    expect(repeat.receiptId).toBe(first.receiptId);
    const readback = await getLocalTrendsWorkflow(workspaceId, productId);
    expect("evaluation" in readback && readback.evaluation?.storedObservations).toBe(13);
    expect("evaluation" in readback && readback.evaluation?.g16.eligible).toBe(false);
  });
  it("rejects conflicting re-export values atomically instead of replacing normalized history", async () => {
    await importLocalTrendsCsv(workspaceId, "engineering-importer", input());
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", input(csv([95, 37, 39, 41, 40, 42, 39, 43, 41, 42, 40, 41, 39])))).rejects.toMatchObject({ code: "CONFLICTING_DUPLICATE_OBSERVATION" });
    expect(await prisma.productDemandObservation.count({ where: { productId } })).toBe(13);
    const first = await prisma.productDemandObservation.findFirst({ where: { productId }, orderBy: { periodStart: "asc" } });
    expect(first?.demandValue).toBe(35);
  });
  it("rejects cross-workspace product intake and readback", async () => {
    await expect(importLocalTrendsCsv(otherWorkspace, "other-actor", input())).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(getLocalTrendsWorkflow(otherWorkspace, productId)).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    expect(await prisma.productDemandObservation.count({ where: { productId } })).toBe(0);
  });
  it.each([
    ["foreign geography", () => ({ ...input(), sourceUrl: buildOfficialTrendsExploreUrl(query).replace("geo=US", "geo=CA") })],
    ["different query", () => ({ ...input(), sourceUrl: buildOfficialTrendsExploreUrl("cat litter box") })],
    ["foreign origin", () => ({ ...input(), sourceUrl: "https://example.com/trends/explore?geo=US&q=cat" })],
  ])("rejects %s before observation insertion", async (_name, makeInput) => {
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", makeInput())).rejects.toMatchObject({ code: "INVALID_ACQUISITION_URL" });
    expect(await prisma.productDemandObservation.count({ where: { productId } })).toBe(0);
  });
  it("rejects a supplied forged authority instead of silently importing it as trusted", async () => {
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", { ...input(), authorityId: "fabricated-authority" })).rejects.toMatchObject({ code: "AUTHORITY_NOT_FOUND" });
    expect(await prisma.productDemandObservation.count({ where: { productId } })).toBe(0);
  });
  it("rejects uploaded providerVerified/asOf flags and malformed or mismatched CSV", async () => {
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", { ...input(), providerVerified: true })).rejects.toMatchObject({ code: "INVALID_TRENDS_INPUT" });
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", { ...input(), asOfTimestamp: "2025-01-01" })).rejects.toMatchObject({ code: "INVALID_TRENDS_INPUT" });
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", input("<html>bot challenge</html>"))).rejects.toMatchObject({ code: "INVALID_GOOGLE_TRENDS_CSV" });
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", input(csv().replace(query, "cat litter box")))).rejects.toMatchObject({ code: "INVALID_GOOGLE_TRENDS_CSV" });
    expect(await prisma.productDemandObservation.count({ where: { productId } })).toBe(0);
  });
  it("excludes incomplete/future buckets from database demand history", async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const result = await importLocalTrendsCsv(workspaceId, "engineering-importer", input(csv() + `${new Date().toISOString().slice(0, 10)},99\n${future},100\n`));
    expect(result.excludedIncompletePeriods).toBe(2);
    expect(result.imported.insertedCount).toBe(13);
    expect(await prisma.productDemandObservation.count({ where: { productId, periodEnd: { gt: new Date() } } })).toBe(0);
  });
  it("bounds UTF-8 bytes, not just JS characters", async () => {
    await expect(importLocalTrendsCsv(workspaceId, "engineering-importer", { ...input(), rawCsv: "猫".repeat(100000) })).rejects.toMatchObject({ code: "CSV_TOO_LARGE" });
  });
  it("rejects cross-origin browser POST before any database write", async () => {
    const response = await POST(new NextRequest("http://localhost:3000/api/v1/demand/local-trends", { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: JSON.stringify(input()) }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CROSS_ORIGIN_FORBIDDEN");
  });
  it("accepts the original 127.0.0.1 browser origin when Next normalizes its request URL to localhost", async () => {
    const response = await POST(new NextRequest(`http://127.0.0.1:3022/api/v1/demand/local-trends?workspaceId=${workspaceId}`, {
      method: "POST", headers: { host: "127.0.0.1:3022", origin: "http://127.0.0.1:3022", "content-type": "application/json" }, body: "invalid-json",
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
  });
  it("does not leak a different workspace product through the listing", async () => {
    const list = await getLocalTrendsWorkflow(otherWorkspace);
    expect("products" in list && list.products.some(p => p.id === productId)).toBe(false);
  });
});

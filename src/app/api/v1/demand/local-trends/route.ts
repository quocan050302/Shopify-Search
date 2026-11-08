import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorizedResearchContext, ResearchAuthError } from "@/services/research/researchAuthService";
import { BatchImportError } from "@/services/kh02/demand/demandObservationBatchImport";
import { getLocalTrendsWorkflow, importLocalTrendsCsv, MAX_TRENDS_UPLOAD_BYTES } from "@/services/kh02/demand/localTrendsWorkflow";

const MAX_BODY_BYTES = MAX_TRENDS_UPLOAD_BYTES * 2;
function failure(error: unknown) {
  if (error instanceof ResearchAuthError || error instanceof BatchImportError)
    return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.statusCode });
  return NextResponse.json({ success: false, error: { code: "TRENDS_WORKFLOW_FAILED", message: "Trends workflow failed. Check the local database and server configuration." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const productId = request.nextUrl.searchParams.get("productId") || undefined;
    return NextResponse.json({ success: true, data: { workspaceId: context.workspaceId, ...await getLocalTrendsWorkflow(context.workspaceId, productId) } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    // Prevent cross-origin browser writes even in a loopback local deployment.
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      // NextURL canonicalizes 127.0.0.1/[::1] to localhost. Preserve exact original
      // browser Origin == HTTP Host, and require loopback + matching protocol/port.
      let originalLoopbackOrigin = false;
      try {
        const sent = new URL(origin);
        const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
        originalLoopbackOrigin = loopback.has(sent.hostname) && loopback.has(request.nextUrl.hostname) &&
          sent.host === request.headers.get("host") && sent.protocol === request.nextUrl.protocol &&
          sent.port === request.nextUrl.port && sent.origin === origin;
      } catch { /* Invalid Origin fails closed. */ }
      if (!originalLoopbackOrigin)
        return NextResponse.json({ success: false, error: { code: "CROSS_ORIGIN_FORBIDDEN", message: "Use the app's own import page." } }, { status: 403 });
    }
    const context = await resolveAuthorizedResearchContext(request);
    const reader = request.body?.getReader();
    if (!reader) throw new BatchImportError("Request body is required.", 400, "EMPTY_BODY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new BatchImportError("Upload body too large.", 413, "BODY_TOO_LARGE");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new BatchImportError("Invalid JSON body.", 400, "INVALID_JSON"); }
    return NextResponse.json({ success: true, data: await importLocalTrendsCsv(context.workspaceId, context.actorId, body) });
  } catch (error) { return failure(error); }
}

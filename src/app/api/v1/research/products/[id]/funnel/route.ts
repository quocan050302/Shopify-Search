import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const snapshot = await prisma.landingPageSnapshot.findFirst({
      where: { productId },
      orderBy: { observedAt: "desc" },
    });

    if (!snapshot) {
      return NextResponse.json({
        success: true,
        data: null,
        message: "No landing page inspection snapshot recorded yet",
      });
    }

    let observations = null;
    let croSignals = null;
    let messageMatch = null;
    let warnings = [];

    try {
      if (snapshot.observationsJson) observations = JSON.parse(snapshot.observationsJson);
      if (snapshot.croSignalsJson) croSignals = JSON.parse(snapshot.croSignalsJson);
      if (snapshot.messageMatchJson) messageMatch = JSON.parse(snapshot.messageMatchJson);
      if (snapshot.warningsJson) warnings = JSON.parse(snapshot.warningsJson);
    } catch (parseErr) {
      console.warn("Snapshot JSON parse error:", parseErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        snapshot,
        observations,
        croSignals,
        messageMatch,
        warnings,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "11.4.0",
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    console.error("[Get Funnel Analysis Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

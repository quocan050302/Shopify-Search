/**
 * GET, POST /api/v1/discovery/config
 *
 * Discovery schedule configuration endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DiscoveryScheduleConfigSchema } from "@/services/discovery/types";
import { requireAdminAuth } from "@/services/security/adminAuth";

export async function GET() {
  try {
    const schedules = await prisma.discoverySchedule.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: schedules.map((s) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        name: s.name,
        enabled: s.enabled,
        providerId: s.providerId,
        searchWindowDays: s.searchWindowDays,
        targetMarket: s.targetMarket,
        keywords: JSON.parse(s.keywordsJson || "[]"),
        industries: JSON.parse(s.industriesJson || "[]"),
        dailyLimit: s.dailyLimit,
        timezone: s.timezone,
        hourOfDayUtc: s.hourOfDayUtc,
        lastRunAt: s.lastRunAt,
        failureCount: s.failureCount,
        lastErrorReason: s.lastErrorReason,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load discovery configuration.";
    return NextResponse.json(
      { success: false, error: { code: "CONFIG_FETCH_FAILED", message: msg } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const parsed = DiscoveryScheduleConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid discovery schedule payload.",
            details: parsed.error.issues,
          },
        },
        { status: 400 }
      );
    }

    const {
      id,
      workspaceId,
      name,
      enabled,
      providerId,
      searchWindowDays,
      targetMarket,
      keywords,
      industries,
      dailyLimit,
      timezone,
      hourOfDayUtc,
    } = parsed.data;

    let schedule;
    if (id) {
      schedule = await prisma.discoverySchedule.update({
        where: { id },
        data: {
          name,
          enabled,
          providerId,
          searchWindowDays,
          targetMarket,
          keywordsJson: JSON.stringify(keywords),
          industriesJson: JSON.stringify(industries),
          dailyLimit,
          timezone,
          hourOfDayUtc,
        },
      });
    } else {
      schedule = await prisma.discoverySchedule.create({
        data: {
          workspaceId,
          name,
          enabled,
          providerId,
          searchWindowDays,
          targetMarket,
          keywordsJson: JSON.stringify(keywords),
          industriesJson: JSON.stringify(industries),
          dailyLimit,
          timezone,
          hourOfDayUtc,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...schedule,
        keywords: JSON.parse(schedule.keywordsJson || "[]"),
        industries: JSON.parse(schedule.industriesJson || "[]"),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to save discovery schedule.";
    return NextResponse.json(
      { success: false, error: { code: "CONFIG_SAVE_FAILED", message: msg } },
      { status: 500 }
    );
  }
}

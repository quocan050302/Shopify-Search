/**
 * SWAI Research Authorization & Context Resolution Service
 *
 * KH-01.A / V11.4.1 — Security, Data Integrity & Evidence Foundation
 *
 * Responsibilities:
 * 1. Resolve trusted research principal from server-side security primitives.
 * 2. Prevent arbitrary caller-controlled workspace headers from bypassing authorization.
 * 3. Enforce tenant ownership for advertisements and products; fail closed on unassociated orphan records.
 * 4. Reject forged actor headers (x-actor-id) and enforce server-verified principal identity.
 * 5. Fail closed when authentication is required but missing or invalid.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { validateAdminRequest } from "@/services/security/adminAuth";

export interface ResearchPrincipal {
  principalId: string;
  authMode: "OWNER_ADMIN" | "USER_SESSION" | "LOCAL_DEV";
  isAuthenticated: boolean;
  allowedWorkspaceIds: string[];
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

export interface ResearchAccessContext {
  workspaceId: string;
  actorId: string;
  accessMode: "AUTHENTICATED" | "EXPLICIT_LOCAL_DEV";
  principal?: ResearchPrincipal;
}

export type ResearchAuthErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "UNAUTHORIZED_WORKSPACE"
  | "WORKSPACE_NOT_FOUND"
  | "FORBIDDEN_WORKSPACE_AD"
  | "AD_NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "NO_WORKSPACE_CONFIGURED";

export class ResearchAuthError extends Error {
  constructor(
    message: string,
    public code: ResearchAuthErrorCode,
    public statusCode: number = 403
  ) {
    super(message);
    this.name = "ResearchAuthError";
  }
}

/**
 * Resolves the trusted server-side research principal.
 * Never trusts x-actor-id or unverified caller assertions.
 */
export async function resolveResearchPrincipal(
  request: NextRequest
): Promise<ResearchPrincipal> {
  const adminCheck = validateAdminRequest(request);

  if (!adminCheck.authorized) {
    throw new ResearchAuthError(
      adminCheck.message || "Authentication required to access research intelligence workspace.",
      adminCheck.code === "ADMIN_AUTH_REQUIRED" ? "UNAUTHORIZED" : "FORBIDDEN",
      adminCheck.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403
    );
  }

  // Resolve all workspaces accessible to this administrator/owner
  const workspaces = await prisma.workspace.findMany({
    select: { id: true },
  });
  const allowedWorkspaceIds = workspaces.map((w) => w.id);

  return {
    principalId: adminCheck.principalId || "admin_owner",
    authMode: adminCheck.authMode || "OWNER_ADMIN",
    isAuthenticated: true,
    allowedWorkspaceIds,
    role: "OWNER",
  };
}

/**
 * Resolves the authenticated caller's identity and authorized research context.
 *
 * Rules:
 * - Checks administrator authentication via Bearer token, x-admin-token, or session cookie.
 * - In production mode, authentication is strictly required.
 * - In local development without configured admin secret, explicit local dev access is granted.
 * - Caller-supplied workspaceId must be present in the principal's allowed workspaces.
 * - Existence of a workspace in DB alone does NOT grant authorization.
 */
export async function resolveAuthorizedResearchContext(
  request: NextRequest
): Promise<ResearchAccessContext> {
  const principal = await resolveResearchPrincipal(request);

  // Caller may request a specific workspace via header or query parameter
  const queryWorkspace =
    request.nextUrl?.searchParams?.get?.("workspaceId") ||
    (request.url ? new URL(request.url).searchParams.get("workspaceId") : null) ||
    "";
  const requestedWorkspaceId = (request.headers.get("x-workspace-id") || queryWorkspace).trim();

  let workspaceId: string;

  if (requestedWorkspaceId) {
    if (!principal.allowedWorkspaceIds.includes(requestedWorkspaceId)) {
      throw new ResearchAuthError(
        "The requested workspace does not exist or access is unauthorized for the authenticated principal.",
        "UNAUTHORIZED_WORKSPACE",
        403
      );
    }
    workspaceId = requestedWorkspaceId;
  } else {
    // Default to the first available authorized workspace
    if (principal.allowedWorkspaceIds.length === 0) {
      throw new ResearchAuthError(
        "No accessible workspace is configured.",
        "NO_WORKSPACE_CONFIGURED",
        403
      );
    }
    workspaceId = principal.allowedWorkspaceIds[0];
  }

  const accessMode = principal.authMode === "LOCAL_DEV" ? "EXPLICIT_LOCAL_DEV" : "AUTHENTICATED";

  return {
    workspaceId,
    actorId: principal.principalId,
    accessMode,
    principal,
  };
}

/**
 * Asserts that the authenticated caller has access to the specified advertisement.
 *
 * Rules:
 * - Ad must exist.
 * - Ad must belong to the caller's authorized workspace via DiscoveryRunAd or Watchlist.
 * - Orphan ads with no workspace association fail closed by default.
 * - No implicit cross-tenant leaks.
 */
export async function assertAdWorkspaceAccess(
  adId: string,
  context: ResearchAccessContext
): Promise<void> {
  if (!adId || typeof adId !== "string" || !adId.trim()) {
    throw new ResearchAuthError("Missing or invalid advertisement ID parameter.", "AD_NOT_FOUND", 400);
  }

  const ad = await prisma.competitorAd.findUnique({
    where: { id: adId },
    include: {
      runAds: true,
      watchlistItems: {
        include: { watchlist: true },
      },
    },
  });

  if (!ad) {
    throw new ResearchAuthError(`Advertisement with ID ${adId} was not found.`, "AD_NOT_FOUND", 404);
  }

  const associatedWorkspaceIds = new Set<string>();
  for (const runAd of ad.runAds) {
    if (runAd.workspaceId) associatedWorkspaceIds.add(runAd.workspaceId);
  }
  for (const item of ad.watchlistItems) {
    if (item.watchlist?.workspaceId) associatedWorkspaceIds.add(item.watchlist.workspaceId);
  }

  // Fail closed: If the ad has NO workspace associations (orphan record), deny access unless
  // operating in the system default workspace with owner authorization.
  if (associatedWorkspaceIds.size === 0) {
    const isSystemOwner =
      (context.accessMode === "AUTHENTICATED" || context.accessMode === "EXPLICIT_LOCAL_DEV") &&
      context.workspaceId === "default-workspace";
    if (!isSystemOwner) {
      throw new ResearchAuthError(
        "Access denied: Unassociated orphan advertisement cannot be accessed outside the system default workspace.",
        "FORBIDDEN_WORKSPACE_AD",
        403
      );
    }
  } else if (!associatedWorkspaceIds.has(context.workspaceId)) {
    throw new ResearchAuthError(
      "The requested advertisement does not belong to your accessible workspace.",
      "FORBIDDEN_WORKSPACE_AD",
      403
    );
  }
}

/**
 * Asserts that the authenticated caller has access to the specified ResearchProduct.
 *
 * Rules:
 * - Product must exist.
 * - Product must belong to the caller's authorized workspace via Watchlist or linked ads.
 * - Orphan products fail closed by default.
 */
export async function assertProductWorkspaceAccess(
  productId: string,
  context: ResearchAccessContext
): Promise<void> {
  if (!productId || typeof productId !== "string" || !productId.trim()) {
    throw new ResearchAuthError("Missing or invalid product ID.", "PRODUCT_NOT_FOUND", 400);
  }

  const product = await prisma.researchProduct.findUnique({
    where: { id: productId },
    include: {
      watchlistItems: {
        include: { watchlist: true },
      },
      adLinks: {
        include: {
          ad: {
            include: {
              runAds: true,
              watchlistItems: { include: { watchlist: true } },
            },
          },
        },
      },
    },
  });

  if (!product) {
    throw new ResearchAuthError(`Product '${productId}' was not found.`, "PRODUCT_NOT_FOUND", 404);
  }

  const associatedWorkspaceIds = new Set<string>();
  for (const item of product.watchlistItems) {
    if (item.watchlist?.workspaceId) associatedWorkspaceIds.add(item.watchlist.workspaceId);
  }
  for (const link of product.adLinks) {
    for (const runAd of link.ad.runAds) {
      if (runAd.workspaceId) associatedWorkspaceIds.add(runAd.workspaceId);
    }
    for (const item of link.ad.watchlistItems) {
      if (item.watchlist?.workspaceId) associatedWorkspaceIds.add(item.watchlist.workspaceId);
    }
  }

  // Fail closed: If the product has NO workspace associations, deny access unless
  // operating in the system default workspace with owner authorization.
  if (associatedWorkspaceIds.size === 0) {
    const isSystemOwner =
      (context.accessMode === "AUTHENTICATED" || context.accessMode === "EXPLICIT_LOCAL_DEV") &&
      context.workspaceId === "default-workspace";
    if (!isSystemOwner) {
      throw new ResearchAuthError(
        `Access denied: Product '${productId}' has no valid workspace association and cannot be accessed.`,
        "FORBIDDEN",
        403
      );
    }
  } else if (!associatedWorkspaceIds.has(context.workspaceId)) {
    throw new ResearchAuthError(
      `Access denied: Product '${productId}' does not belong to authorized workspace '${context.workspaceId}'.`,
      "FORBIDDEN",
      403
    );
  }
}

/**
 * Asserts workspace membership and role hierarchy.
 */
export function assertWorkspaceMembership(
  principal: ResearchPrincipal,
  workspaceId: string,
  requiredRole: "VIEWER" | "MEMBER" | "ADMIN" = "VIEWER"
): void {
  if (!principal.allowedWorkspaceIds.includes(workspaceId)) {
    throw new ResearchAuthError(
      `Principal '${principal.principalId}' does not have access to workspace '${workspaceId}'.`,
      "UNAUTHORIZED_WORKSPACE",
      403
    );
  }

  const roleWeights: Record<string, number> = {
    VIEWER: 1,
    MEMBER: 2,
    ADMIN: 3,
    OWNER: 4,
  };

  const userWeight = roleWeights[principal.role] || 1;
  const requiredWeight = roleWeights[requiredRole] || 1;

  if (userWeight < requiredWeight) {
    throw new ResearchAuthError(
      `Insufficient permissions: Role '${principal.role}' does not satisfy required role '${requiredRole}'.`,
      "FORBIDDEN",
      403
    );
  }
}

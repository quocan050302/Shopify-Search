/**
 * SWAI V11.5.1 — Canonical Run-Specific Explorer URL Builder
 *
 * Links an exact DiscoveryRun ID to Explorer without falling back to ambiguous
 * keyword queries. Ensures Run A and Run B with identical keywords remain strictly isolated.
 */

export function buildExplorerUrlForRun(
  runId: string,
  platform: string = "META"
): string {
  const params = new URLSearchParams();
  if (platform) {
    params.set("platform", platform.toUpperCase());
  }
  if (runId) {
    params.set("requestId", runId.trim());
  }
  return `/explorer?${params.toString()}`;
}

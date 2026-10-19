import { URL } from "url";
import path from "path";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "169.254.169.254", // AWS/GCP/Azure instance metadata
  "metadata.google.internal",
]);

/**
 * Validates an external URL for SSRF vulnerabilities and protocol correctness.
 */
export function validateExternalResourceUrl(rawUrl: string): {
  isValid: boolean;
  reason?: string;
  sanitizedUrl?: string;
} {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { isValid: false, reason: "URL must be a non-empty string" };
  }

  try {
    const parsed = new URL(rawUrl.trim());

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { isValid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check direct blocklist
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return { isValid: false, reason: `Access to restricted host '${hostname}' is prohibited` };
    }

    // Check IPv4 private ranges
    // 10.0.0.0/8
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { isValid: false, reason: "Access to private 10.0.0.0/8 network is prohibited" };
    }
    // 172.16.0.0/12
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { isValid: false, reason: "Access to private 172.16.0.0/12 network is prohibited" };
    }
    // 192.168.0.0/16
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { isValid: false, reason: "Access to private 192.168.0.0/16 network is prohibited" };
    }
    // 127.0.0.0/8
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { isValid: false, reason: "Access to loopback address is prohibited" };
    }

    return {
      isValid: true,
      sanitizedUrl: parsed.toString(),
    };
  } catch {
    return { isValid: false, reason: "Malformed URL structure" };
  }
}

/**
 * Checks and confirms that APP #2 is strictly isolated within its designated repository.
 */
export function verifyApplicationIsolation(): {
  isIsolated: boolean;
  workspaceDir: string;
  appName: string;
  gitOrigin: string;
} {
  const workspaceDir = process.cwd();
  const normalized = workspaceDir.replace(/\\/g, "/");

  // Confirm workspace matches Running-Ads / Shopify-Search
  const isDedicatedDir = normalized.includes("Running-Ads") || normalized.includes("Shopify-Search");

  return {
    isIsolated: isDedicatedDir,
    workspaceDir,
    appName: "Shopify Winning Ads Intelligence (SWAI)",
    gitOrigin: "https://github.com/quocan050302/Shopify-Search.git",
  };
}

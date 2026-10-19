import { URL } from "url";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "169.254.169.254", // AWS/GCP/Azure instance metadata
  "169.254.170.2", // ECS task metadata
  "metadata.google.internal",
  "fd00:ec2::254", // AWS IMDSv6
]);

/**
 * Validates an external URL for SSRF vulnerabilities and protocol correctness.
 * Blocks private/loopback IPs, cloud metadata endpoints, and non-HTTP protocols.
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
      return {
        isValid: false,
        reason: `Unsupported protocol: ${parsed.protocol}`,
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check direct blocklist
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return {
        isValid: false,
        reason: `Access to restricted host '${hostname}' is prohibited`,
      };
    }

    // Validate IPv4 private ranges with strict regex
    const ipv4PrivateRanges = [
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 10.0.0.0/8
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
      /^192\.168\.\d{1,3}\.\d{1,3}$/, // 192.168.0.0/16
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 127.0.0.0/8
      /^0\.0\.0\.0$/, // Unspecified
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/, // 100.64.0.0/10 (CGNAT)
    ];

    for (const pattern of ipv4PrivateRanges) {
      if (pattern.test(hostname)) {
        return {
          isValid: false,
          reason: `Access to private IP range '${hostname}' is prohibited`,
        };
      }
    }

    // Block IPv6 link-local and unique-local addresses
    if (
      hostname.startsWith("fe80:") || // Link-local
      hostname.startsWith("fc") || // Unique local (fc00::/7)
      hostname.startsWith("fd") || // Unique local (fd00::/7)
      hostname === "::1" || // Loopback
      hostname === "::"
    ) {
      return {
        isValid: false,
        reason: `Access to private IPv6 address '${hostname}' is prohibited`,
      };
    }

    // Block cloud metadata endpoints that don't match the blocklist exactly
    if (
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local") ||
      hostname === "metadata" ||
      hostname === "instance-data"
    ) {
      return {
        isValid: false,
        reason: `Access to internal/metadata hostname '${hostname}' is prohibited`,
      };
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
 * Verifies APP #2 isolation using actual Git remote origin rather than
 * just checking directory name substring.
 * NOTE: This is a server-only function — uses Node.js APIs (fs, path) via dynamic require.
 */
export function verifyApplicationIsolation(): {
  isIsolated: boolean;
  workspaceDir: string;
  appName: string;
  gitOrigin: string;
  method: string;
} {
  const workspaceDir = process.cwd();
  const normalized = workspaceDir.replace(/\\/g, "/");
  const expectedOrigin = "https://github.com/quocan050302/Shopify-Search";

  // Method 1: Check git config file for remote origin
  // Uses dynamic require to keep Node.js-only APIs out of the client bundle
  let gitOrigin = "UNKNOWN";
  let method = "DIRECTORY_NAME_ONLY";

  if (typeof window === "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodePath = require("path") as typeof import("path");
      const gitConfigPath = nodePath.join(workspaceDir, ".git", "config");
      if (fs.existsSync(gitConfigPath)) {
        const gitConfig = fs.readFileSync(gitConfigPath, "utf-8");
        const originMatch = gitConfig.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/);
        if (originMatch && originMatch[1]) {
          gitOrigin = originMatch[1].trim();
          method = "GIT_CONFIG_FILE";
        }
      }
    } catch {
      // Fallback to directory name check
      method = "DIRECTORY_NAME_FALLBACK";
    }
  }

  // Method 2: Confirm origin matches expected repository
  const isGitOriginMatch =
    gitOrigin !== "UNKNOWN" &&
    (gitOrigin === expectedOrigin ||
      gitOrigin === expectedOrigin + ".git" ||
      gitOrigin.replace(/\.git$/, "") === expectedOrigin);

  // Method 3: Directory name fallback (less reliable)
  const isDedicatedDir =
    normalized.includes("Shopify-Search") ||
    normalized.includes("shopify-search");

  const isIsolated =
    method === "GIT_CONFIG_FILE" ? isGitOriginMatch : isDedicatedDir;

  return {
    isIsolated,
    workspaceDir,
    appName: "Shopify Winning Ads Intelligence (SWAI) — APP #2",
    gitOrigin,
    method,
  };
}


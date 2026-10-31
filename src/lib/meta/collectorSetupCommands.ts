/**
 * SWAI V11.5.1 — Centralized Meta Collector Setup Commands
 *
 * Provides cross-platform, verified setup and maintenance terminal commands
 * matching package.json scripts and services/meta-ads-collector structure.
 */

export type SupportedPlatform = "darwin" | "linux" | "win32";

export function getEffectivePlatform(explicitPlatform?: string): SupportedPlatform {
  if (explicitPlatform === "win32" || explicitPlatform === "windows") return "win32";
  if (explicitPlatform === "darwin" || explicitPlatform === "macos" || explicitPlatform === "mac") return "darwin";
  if (explicitPlatform === "linux") return "linux";

  if (typeof process !== "undefined" && process.platform) {
    if (process.platform === "win32") return "win32";
    if (process.platform === "darwin") return "darwin";
    return "linux";
  }

  return "darwin";
}

export function getDoctorCommand(): string {
  return "npm run doctor";
}

export function getDiscoveryWorkerCommand(): string {
  return "npm run worker:discovery";
}

export function getCollectorPythonSetupCommand(platform?: string): string {
  const p = getEffectivePlatform(platform);
  if (p === "win32") {
    return "powershell -ExecutionPolicy Bypass -File scripts/meta-collector-setup.ps1";
  }
  return "bash scripts/meta-collector-setup.sh";
}

export interface SetupStepDefinition {
  id: string;
  stepNumber: number;
  title: string;
  description: string;
  command: string;
  commandExplanation: string;
}

export function getCollectorSetupSteps(platform?: string): SetupStepDefinition[] {
  const p = getEffectivePlatform(platform);

  return [
    {
      id: "python_env",
      stepNumber: 1,
      title: "Verify Python Environment",
      description: "Python 3.10+ virtualenv with required dependencies in collector directory.",
      command: getCollectorPythonSetupCommand(p),
      commandExplanation:
        p === "win32"
          ? "Runs Windows setup script to create .venv and install pip dependencies."
          : "Creates virtual environment in services/meta-ads-collector/.venv and installs pinned requirements.",
    },
    {
      id: "collector_config",
      stepNumber: 2,
      title: "Configure Local MCP Provider",
      description: "Local MetaAdsCollector provider initialized and authorized.",
      command: getDoctorCommand(),
      commandExplanation: "Verifies Python virtualenv, stdio MCP handshake, and database connection.",
    },
    {
      id: "worker_process",
      stepNumber: 3,
      title: "Start Discovery Background Worker",
      description: "Worker processes queued research runs and persists extracted ad records.",
      command: getDiscoveryWorkerCommand(),
      commandExplanation: "Polls pending research jobs, executes Meta collector queries, and stores discovered ads.",
    },
    {
      id: "connectivity_test",
      stepNumber: 4,
      title: "Source Access Verification",
      description: "Direct HTTP reachability to public Meta Ad Library repository.",
      command: "curl -I https://www.facebook.com/ads/library/",
      commandExplanation: "Tests outgoing TCP reachability to Facebook Ad Library without blocking IP.",
    },
  ];
}

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venv = path.join(root, "services", "google-transparency", ".venv");
const python = path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const bridge = path.join(root, "scripts", "googleTransparencyServer.py");

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) {
    throw new Error(`Provider setup failed: ${result.error?.message || `exit ${result.status}`}`);
  }
}

if (!fs.existsSync(python)) run(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-m", "venv", venv]);
// Pin the reviewed source rather than execute an unversioned npx package.
run(python, ["-m", "pip", "install", "git+https://github.com/block-town/google-ads-transparency-mcp.git@8180b10a338be0d825d59797084df6bb8c06cca6"]);

const envPath = path.join(root, ".env.local");
const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const current = parse(original);
if (current.GOOGLE_TRANSPARENCY_MCP_URL || current.GOOGLE_ADS_MCP_URL || current.GOOGLE_TRANSPARENCY_MCP_COMMAND?.trim()) {
  console.log("Existing Google MCP configuration preserved. See docs/KH02_FREE_PROVIDER_SETUP.md to switch to the local bridge.");
} else {
  const keys = ["GOOGLE_TRANSPARENCY_MCP_COMMAND", "GOOGLE_TRANSPARENCY_MCP_ARGS"];
  const retained = original.split(/\r?\n/).filter(line => !keys.some(key => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line))).join("\n");
  const command = python.replace(/\\/g, "/");
  const args = JSON.stringify([bridge.replace(/\\/g, "/")]);
  fs.writeFileSync(envPath, `${retained}\nGOOGLE_TRANSPARENCY_MCP_COMMAND='${command}'\nGOOGLE_TRANSPARENCY_MCP_ARGS='${args}'\n`, { mode: 0o600 });
  console.log("Google Ads MCP configured in .env.local. Restart both web server and KH-02 worker.");
}
console.log("No accounts created and no metered queries run. TikTok Organic and Trends need your own free-tier keys; see docs/KH02_FREE_PROVIDER_SETUP.md.");

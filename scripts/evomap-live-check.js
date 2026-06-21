import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function loadLocalEnv() {
  try {
    const raw = readFileSync(path.join(rootDir, ".env.local"), "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
      const [key, ...rest] = trimmed.split("=");
      process.env[key.trim()] ??= rest.join("=").trim().replace(/^["']|["']$/g, "");
    });
  } catch {
    // Optional local file; environment variables are enough.
  }
}

loadLocalEnv();

const { createTestStore, resolveApi } = await import("../apps/api/server.js");
const store = await createTestStore();
const response = await resolveApi("/api/evomap/evolution/run-live", {
  method: "POST",
  store,
  body: {
    publish: process.argv.includes("--publish")
  }
});

const run = response.payload.run || {};
function stepFailure(key, payload) {
  const remote = payload?.remote || {};
  const correction = remote.correction || {};
  return {
    key,
    status: payload?.status || null,
    httpStatus: payload?.httpStatus || null,
    error: payload?.error || remote.error || null,
    fix: correction.fix || null
  };
}

const report = {
  statusCode: response.statusCode,
  ok: response.payload.ok === true,
  node: {
    nodeId: response.payload.node?.nodeId || null,
    status: response.payload.node?.status || null,
    liveMode: response.payload.node?.liveMode === true,
    hasSecret: response.payload.node?.hasSecret === true,
    baseUrl: response.payload.node?.baseUrl || null,
    claimUrl: response.payload.node?.claimUrl || null,
    lastError: response.payload.node?.lastError || null
  },
  validationResult: run.validationResult || null,
  strategyApplied: run.strategyApplied === true,
  stepStatuses: run.stepStatuses || null,
  failedGateSteps: response.payload.remoteGate?.failed?.map((item) => {
    if (item.key === "memoryRecord") return stepFailure(item.key, response.payload.steps?.memoryRecord);
    if (item.key === "memoryRecall") return stepFailure(item.key, response.payload.steps?.memoryRecall?.memory);
    if (item.key === "fetchSearch") return stepFailure(item.key, response.payload.steps?.memoryRecall?.fetchSearch);
    return stepFailure(item.key, response.payload.steps?.[item.key]);
  }) || []
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok && report.validationResult === "remote_validated" && report.strategyApplied ? 0 : 2;

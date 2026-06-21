import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env.local");

function readLocalEnv() {
  const values = {};
  try {
    const raw = readFileSync(envPath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
      const [key, ...rest] = trimmed.split("=");
      values[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    });
  } catch {
    return values;
  }
  return values;
}

function writeLocalEnv(values) {
  const orderedKeys = [
    "EVOMAP_A2A_LIVE",
    "EVOMAP_A2A_BASE_URL",
    "EVOMAP_NODE_ID",
    "EVOMAP_NODE_SECRET",
    "EVOMAP_LLM_API_KEY",
    "EVOMAP_LLM_URL",
    "EVOMAP_LLM_MODEL"
  ];
  const keys = [...orderedKeys, ...Object.keys(values).filter((key) => !orderedKeys.includes(key)).sort()];
  const lines = keys
    .filter((key) => values[key] != null && values[key] !== "")
    .map((key) => `${key}=${JSON.stringify(String(values[key]))}`);
  writeFileSync(envPath, `${lines.join("\n")}\n`, "utf8");
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Best effort on platforms that support POSIX permissions.
  }
}

function buildMessageId() {
  return `msg_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function generateNodeId() {
  return `node_${createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 16)}`;
}

function isValidNodeId(nodeId) {
  return /^node_[0-9a-f]{12,32}$/i.test(String(nodeId || ""));
}

const shouldSave = process.argv.includes("--save-secret");
if (!shouldSave) {
  console.error("Refusing to create or save a persistent EvoMap node secret without --save-secret.");
  console.error("Run: npm run evomap:setup-node -- --save-secret");
  process.exit(2);
}

const localEnv = readLocalEnv();
if (localEnv.EVOMAP_NODE_SECRET) {
  console.log(JSON.stringify({
    ok: true,
    status: "already_configured",
    nodeId: localEnv.EVOMAP_NODE_ID || null,
    envPath
  }, null, 2));
  process.exit(0);
}

const baseUrl = localEnv.EVOMAP_A2A_BASE_URL || process.env.EVOMAP_A2A_BASE_URL || "https://evomap.ai";
const requestedNodeId = localEnv.EVOMAP_NODE_ID || process.env.EVOMAP_NODE_ID || generateNodeId();
if (!isValidNodeId(requestedNodeId)) {
  console.error(JSON.stringify({
    ok: false,
    error: "Invalid EVOMAP_NODE_ID",
    expected: "node_<12-32 hex characters>",
    nodeId: requestedNodeId
  }, null, 2));
  process.exit(2);
}

const envelope = {
  protocol: "gep-a2a",
  protocol_version: "1.0.0",
  version: "1.0.0",
  message_type: "hello",
  message_id: buildMessageId(),
  sender_id: requestedNodeId,
  sender: {
    node_id: requestedNodeId
  },
  trace_id: `trace-${Date.now()}-${randomBytes(4).toString("hex")}`,
  timestamp: new Date().toISOString(),
  payload: {
    capabilities: {
      memory_record: true,
      memory_recall: true,
      fetch: true,
      validate: true,
      publish: true,
      heartbeat_auto: false,
      claim_task_auto: false,
      credit_spending_auto: false
    },
    model: localEnv.EVOMAP_LLM_MODEL || process.env.EVOMAP_LLM_MODEL || "evomap-deepseek-v4-flash",
    env_fingerprint: {
      runtime: "node",
      app: "comforthelper-medical-rehab-assistant",
      platform: "local"
    },
    identity_doc: "Medical rehabilitation MVP agent for deidentified doctor AI suggestions, family rehab Q&A, check-in learning, and strategy validation.",
    constitution: "Never upload PHI. Do not diagnose, adjust prescriptions, claim tasks, spend credits, or run heartbeat automatically."
  }
};

const response = await fetch(`${baseUrl}/a2a/hello`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-correlation-id": envelope.message_id
  },
  body: JSON.stringify(envelope)
});
const remote = await response.json().catch(async () => ({ raw: await response.text() }));
const payload = remote.payload && typeof remote.payload === "object" ? remote.payload : {};
const nodeSecret = remote.node_secret || payload.node_secret;
const nodeId = remote.your_node_id || payload.your_node_id || requestedNodeId;

if (!response.ok || !nodeSecret || payload.status === "rejected" || remote.status === "rejected") {
  console.error(JSON.stringify({
    ok: false,
    httpStatus: response.status,
    error: remote.error || payload.reason || "EvoMap hello did not return a node secret",
    claimUrl: payload.claim_url || remote.claim_url || null
  }, null, 2));
  process.exit(2);
}

writeLocalEnv({
  ...localEnv,
  EVOMAP_A2A_LIVE: "true",
  EVOMAP_A2A_BASE_URL: baseUrl,
  EVOMAP_NODE_ID: nodeId,
  EVOMAP_NODE_SECRET: nodeSecret
});

console.log(JSON.stringify({
  ok: true,
  status: "node_secret_saved",
  nodeId,
  envPath,
  claimUrl: payload.claim_url || remote.claim_url || null,
  creditBalance: payload.credit_balance ?? null
}, null, 2));

/**
 * Multi-instance launcher
 * Reads instances.json from the project root and spawns one server.js
 * process per entry, each with its own PORT and DATA_DIR.
 *
 * Usage:
 *   node start-instances.js
 *   npm run start:instances
 *
 * All data directories are resolved relative to the project root
 * (the folder containing instances.json).
 */

require("dotenv").config();

const { spawn } = require("child_process");
const path      = require("path");
const fs        = require("fs");

const PROJECT_ROOT  = path.join(__dirname, "..");
const CONFIG_PATH   = path.join(PROJECT_ROOT, "instances.json");
const SERVER_SCRIPT = path.join(__dirname, "server.js");

// ── Load config ──────────────────────────────────────────────────────
if (!fs.existsSync(CONFIG_PATH)) {
  console.error("instances.json not found in project root:", PROJECT_ROOT);
  process.exit(1);
}

let instances;
try {
  instances = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch (e) {
  console.error("Failed to parse instances.json:", e.message);
  process.exit(1);
}

if (!Array.isArray(instances) || instances.length === 0) {
  console.error("instances.json must be a non-empty array");
  process.exit(1);
}

// ── Check for port conflicts ─────────────────────────────────────────
const ports = instances.map((i) => i.port);
const duplicates = ports.filter((p, i) => ports.indexOf(p) !== i);
if (duplicates.length) {
  console.error("Duplicate ports in instances.json:", [...new Set(duplicates)].join(", "));
  process.exit(1);
}

console.log(`Starting ${instances.length} instance(s)...\n`);

const children = [];

// ── Spawn each instance ──────────────────────────────────────────────
instances.forEach((inst, idx) => {
  const name    = inst.name    || `Instance ${idx + 1}`;
  const port    = inst.port    || 5000 + idx;
  const dataDir = path.resolve(PROJECT_ROOT, inst.dataDir || `data/instance-${idx + 1}`);

  // Ensure data directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT:          String(port),
    DATA_DIR:      dataDir,
    INSTANCE_NAME: name,
  };

  const child = spawn("node", [SERVER_SCRIPT], {
    env,
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push(child);

  const tag = `[${name}]`.padEnd(18);

  child.stdout.on("data", (d) =>
    process.stdout.write(`${tag} ${d}`)
  );
  child.stderr.on("data", (d) =>
    process.stderr.write(`${tag} ${d}`)
  );
  child.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`\n${tag} exited (${reason})`);
  });

  console.log(`${tag} port=${port}  dataDir=${dataDir}`);
});

console.log("\nAll instances started. Press Ctrl+C to stop all.\n");

// ── Graceful shutdown ────────────────────────────────────────────────
function shutdown() {
  console.log("\nShutting down all instances...");
  children.forEach((c) => c.kill("SIGTERM"));
  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

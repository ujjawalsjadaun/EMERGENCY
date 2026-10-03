#!/usr/bin/env node
/**
 * Dev/prod launcher:  node scripts/run.mjs dev|start
 *  1. creates .env.local on first run (random AUTH_SECRET + ADMIN_PASSWORD - never committed)
 *  2. if DATABASE_URL is not configured, boots a local PostgreSQL (embedded-postgres) in ./.pgdata
 *  3. starts Next.js with that environment and shuts everything down together on Ctrl+C
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";

const mode = process.argv[2] === "start" ? "start" : "dev";
const require = createRequire(import.meta.url);
const ENV_FILE = ".env.local";
const PG_PORT = 5433;
const LOCAL_URL = `postgres://campus:campus@localhost:${PG_PORT}/campus`;

// 1. env file -------------------------------------------------------------
if (!existsSync(ENV_FILE)) {
  const password = randomBytes(6).toString("base64url");
  writeFileSync(
    ENV_FILE,
    `# Generated on first run. Not committed. Add DATABASE_URL=... to use your own PostgreSQL instead of the embedded one.\n` +
      `AUTH_SECRET=${randomBytes(32).toString("hex")}\nADMIN_PASSWORD=${password}\n`,
  );
  console.log(`\n  Created ${ENV_FILE}. Authority password: ${password}\n`);
}
const fileEnv = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const env = { ...process.env, ...fileEnv };
if (!process.env.ADMIN_PASSWORD) console.log(`  Authority password (from ${ENV_FILE}): ${fileEnv.ADMIN_PASSWORD}`);

// 2. database -------------------------------------------------------------
let embedded = null;
if (!env.DATABASE_URL) {
  env.DATABASE_URL = LOCAL_URL;
  const reachable = await new Promise((resolve) => {
    const c = new pg.Client({ connectionString: LOCAL_URL });
    c.connect().then(() => c.end().then(() => resolve(true)), () => resolve(false));
  });
  if (reachable) {
    console.log(`  PostgreSQL already running on port ${PG_PORT}.`);
  } else {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    embedded = new EmbeddedPostgres({
      databaseDir: "./.pgdata",
      user: "campus",
      password: "campus",
      port: PG_PORT,
      persistent: true,
      onLog: () => {},
      onError: () => {},
    });
    if (!existsSync("./.pgdata/PG_VERSION")) {
      console.log("  Initialising local PostgreSQL (first run only)...");
      await embedded.initialise();
    }
    console.log(`  Starting local PostgreSQL on port ${PG_PORT}...`);
    await embedded.start();
    try {
      await embedded.createDatabase("campus");
    } catch {
      /* database already exists */
    }
  }
} else {
  console.log("  Using DATABASE_URL from the environment.");
}

// 3. Next.js --------------------------------------------------------------
if (mode === "start" && !existsSync(".next/BUILD_ID")) {
  console.error("  No production build found. Run `npm run build` first.");
  await embedded?.stop();
  process.exit(1);
}
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), mode], { env, stdio: "inherit" });

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  try {
    await embedded?.stop();
  } catch {
    /* already stopped */
  }
  process.exit(code);
}
child.on("exit", (code) => shutdown(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(0));

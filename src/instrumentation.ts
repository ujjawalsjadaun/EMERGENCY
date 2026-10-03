/** Runs once when the Next.js server starts: launches the SLA auto-escalation job. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __escalationTimer?: NodeJS.Timeout };
  if (g.__escalationTimer) return; // survive dev hot reloads

  const { runEscalationPass } = await import("./lib/issues");
  g.__escalationTimer = setInterval(() => {
    runEscalationPass().catch((err) => console.error("[escalation]", err instanceof Error ? err.message : err));
  }, 10_000);
  g.__escalationTimer.unref();
}

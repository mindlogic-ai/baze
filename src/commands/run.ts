import type { Parsed } from '../args.js';
import { fetchCatalog, gatewayFetch } from '../api.js';
import { FALLBACK_ROWS, pickDefault, type Tool } from '../catalog.js';
import { apiBase } from '../config.js';
import { buildClaudePlan, type HarnessOptions } from '../harness/claude.js';
import { buildCodexPlan } from '../harness/codex.js';
import { buildOpencodePlan } from '../harness/opencode.js';
import { runPlan } from '../spawn.js';
import type { ModelRow } from '../types.js';
import { CliError, info, warn } from '../ui.js';
import type { CreditBalance } from './credits.js';
import { requireApiKey } from './models.js';

/**
 * The launch-time reads are conveniences: a slow gateway falls back to the
 * built-in list rather than holding the coding session back. The session's own
 * LLM calls go from the tool to the gateway and are not bounded here.
 */
const LAUNCH_READ_TIMEOUT_MS = 20_000;

async function remainingCredits(apiKey: string, base: string): Promise<number | undefined> {
  try {
    return (await gatewayFetch<CreditBalance>('/credits/', { apiKey, base, timeoutMs: LAUNCH_READ_TIMEOUT_MS })).total.remaining;
  } catch {
    return undefined;
  }
}

export async function runCommand(tool: Tool, parsed: Parsed): Promise<number> {
  const apiKey = requireApiKey();
  const base = apiBase();
  const dryRun = parsed.flags.get('dry-run') === true;

  let rows: ModelRow[];
  let catalogLive = true;
  try {
    rows = await fetchCatalog(apiKey, { base, timeoutMs: LAUNCH_READ_TIMEOUT_MS });
  } catch (error) {
    // A catalog we cannot reach must not stop a coding session. The fallback
    // rows carry real lanes, so every plan builder below still works. A key the
    // gateway refused is different: the session would fail on its first turn.
    if (error instanceof CliError && error.status !== undefined && error.status < 500) throw error;
    warn(`Could not read the model list (${error instanceof Error ? error.message : String(error)}); using a built-in list.`);
    rows = FALLBACK_ROWS;
    catalogLive = false;
  }

  const flagModel = parsed.flags.get('model');
  const model = typeof flagModel === 'string' ? flagModel : pickDefault(tool, rows);
  if (!model) {
    throw new CliError(`This key has no model that ${tool} can run.`, { hint: 'Run `baze models` to see what it can call.' });
  }
  const effort = parsed.flags.get('reasoning-effort');

  const options: HarnessOptions = {
    apiKey,
    apiBase: base,
    model,
    reasoningEffort: typeof effort === 'string' ? effort : undefined,
    rows,
    catalogLive,
    // `baze claude "fix the failing test"` parses the prompt as a positional,
    // not as passthrough - forwarding only passthrough dropped it silently and
    // opened an interactive session instead of running the prompt.
    passthrough: [...parsed.positionals, ...parsed.passthrough],
  };

  const plan =
    tool === 'claude'
      ? buildClaudePlan(options)
      : tool === 'codex'
        ? buildCodexPlan(options)
        : buildOpencodePlan(options);

  // baze is not in the request path, so it cannot meter per turn (spec §4.6).
  // It reads the balance on both sides of the session and reports the change,
  // labelled for what it is.
  const before = dryRun ? undefined : await remainingCredits(apiKey, base);
  const code = await runPlan(plan, { dryRun });
  if (before !== undefined) {
    const after = await remainingCredits(apiKey, base);
    if (after !== undefined) {
      // Two /credits/ calls per launch; cheap next to a coding session.
      const delta = before - after;
      const amount = Math.abs(delta).toLocaleString('en-US', { maximumFractionDigits: 1 });
      info(
        delta >= 0
          ? `Balance went down ${amount} credits while ${tool} ran (other use of this account in that time is included). Per model: baze usage`
          : `Balance went up ${amount} credits while ${tool} ran - a renewal or top-up landed. Per model: baze usage`,
      );
    }
  }
  return code;
}

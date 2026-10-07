import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { LaunchPlan } from './types.js';
import { c, info, maskKey, say } from './ui.js';

const SECRET_KEYS = ['ANTHROPIC_AUTH_TOKEN', 'BAZE_API_KEY'];
// Hermes takes the key under a name derived from the host (MINDLOGIC_API_KEY,
// BAZE_API_KEY, ...), so any *_API_KEY counts as a secret.
const isSecret = (k: string): boolean => SECRET_KEYS.includes(k) || k.endsWith('_API_KEY');

export function describePlan(plan: LaunchPlan): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(plan.env)) {
    const shown = isSecret(k) ? maskKey(v) : v.length > 80 ? `${v.slice(0, 77)}...` : v;
    lines.push(`  ${k}=${shown === '' ? '""' : shown}`);
  }
  // A temp file is gone once the plan is done, so print what it is, not a path to nothing.
  const temp = new Set(plan.tempFiles ?? []);
  const shownArgs = plan.args.map((a) => (temp.has(a) ? '<temp settings file: the env above, 0600, removed on exit>' : a));
  lines.push(`  ${plan.bin} ${shownArgs.join(' ')}`);
  return lines;
}

export async function runPlan(plan: LaunchPlan, opts: { dryRun: boolean }): Promise<number> {
  for (const note of plan.notes) info(note);

  if (opts.dryRun) {
    for (const line of describePlan(plan)) say(line);
    plan.cleanup?.();
    return 0;
  }

  return new Promise<number>((resolve) => {
    const child = spawn(plan.bin, plan.args, {
      stdio: 'inherit',
      env: { ...process.env, ...plan.env },
    });

    // Ctrl-C already reaches the child: `stdio: 'inherit'` leaves it in our
    // process group, and the terminal signals the whole foreground group. So
    // we do NOT forward SIGINT - doing that delivered it twice, and a tool that
    // asks "interrupt? (y/n)" on the first one never saw the answer. We only
    // keep ourselves alive while the child handles its own interrupt.
    const ignore = (): void => {};
    process.on('SIGINT', ignore);
    // SIGTERM is not a terminal signal and is NOT delivered to the group, so
    // that one we do forward.
    const onTerm = (): void => {
      child.kill('SIGTERM');
    };
    process.on('SIGTERM', onTerm);

    const finish = (code: number): void => {
      process.off('SIGINT', ignore);
      process.off('SIGTERM', onTerm);
      plan.cleanup?.();
      resolve(code);
    };

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        say(c.red(`${plan.bin} is not installed, or is not on your PATH.`));
        say(c.dim('Install it first; baze runs the tool you already have.'));
        finish(127);
        return;
      }
      say(c.red(err.message));
      finish(1);
    });
    // A child killed by a signal exits with code === null and a signal name.
    // `code ?? 0` reported success for an interrupted or crashed session, so
    // `baze claude ... && deploy` would deploy after a Ctrl-C. Use the shell
    // convention instead: 128 + signal number.
    child.on('exit', (code, signal) => {
      if (code !== null) return finish(code);
      finish(128 + (signal ? (constants.signals[signal] ?? 0) : 0));
    });
  });
}

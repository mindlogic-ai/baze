import { CliError } from './ui.js';

/**
 * One generation parameter as `GET /models/{id}/` publishes it for an image or
 * video model - the same schema the gateway fills defaults from.
 */
export interface ParamSpec {
  name: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  values?: unknown[];
  max?: number;
}

/** The count is `--n`, not a parameter: the gateway maps it onto each model's own count field. */
const COUNT_TYPE = 'num_images';

export function parseSets(sets: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of sets) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new CliError(`--set takes key=value, got "${pair}".`);
    out.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return out;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** Numbers stay numbers on the wire; `"5"` for a duration is a 400 on some providers. */
const coerce = (raw: string): string | number => (NUMBER.test(raw) ? Number(raw) : raw);

const describe = (spec: ParamSpec): string => {
  if (spec.values?.length) return `${spec.name} (${spec.values.join(' | ')})`;
  if (spec.max !== undefined) return `${spec.name} (<= ${spec.max})`;
  return spec.name;
};

/**
 * Checks `--set` against the model's schema before anything is sent (or
 * billed). With no schema - an older gateway, or an audio model - the values
 * go through as given and the gateway is the judge.
 */
export function checkParams(
  given: Map<string, string>,
  specs: readonly ParamSpec[] | undefined,
  model: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!specs) {
    for (const [k, v] of given) out[k] = coerce(v);
    return out;
  }
  const settable = specs.filter((s) => s.type !== COUNT_TYPE);
  const byName = new Map(settable.map((s) => [s.name, s]));
  for (const [name, raw] of given) {
    const spec = byName.get(name);
    if (!spec) {
      if (specs.some((s) => s.name === name && s.type === COUNT_TYPE)) {
        throw new CliError(`Set the number of images with --n, not --set ${name}.`);
      }
      const known = settable.map(describe).join(', ');
      throw new CliError(`${model} has no parameter "${name}".`, {
        hint: known ? `It takes: ${known}.` : `${model} takes no parameters.`,
      });
    }
    if (spec.values?.length) {
      const match = spec.values.find((v) => String(v) === raw);
      if (match === undefined) {
        throw new CliError(`${name}=${raw} is not allowed for ${model}.`, {
          hint: `Allowed: ${spec.values.join(', ')}.`,
        });
      }
      out[name] = typeof match === 'number' ? match : String(match);
      continue;
    }
    const value = coerce(raw);
    if (spec.max !== undefined && (typeof value !== 'number' || value > spec.max)) {
      throw new CliError(`${name} must be a number no larger than ${spec.max}.`);
    }
    out[name] = value;
  }
  return out;
}

/** `--n` against the model's own count limit, when it declares one. */
export function checkCount(raw: string | true | undefined, specs: readonly ParamSpec[] | undefined): number {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new CliError('--n must be a positive integer.');
  const limit = specs?.find((s) => s.type === COUNT_TYPE)?.max;
  if (limit !== undefined && n > limit) throw new CliError(`This model makes at most ${limit} images per call.`);
  if (specs && n > 1 && !specs.some((s) => s.type === COUNT_TYPE)) {
    throw new CliError('This model makes one image per call.', { hint: 'Run it again for more.' });
  }
  return n;
}

/** One line per parameter, for `baze gen <kind> --model X --params`. */
export function describeParams(specs: readonly ParamSpec[]): string[] {
  return specs.map((s) => {
    const values = s.values?.length ? s.values.join(' | ') : s.max !== undefined ? `<= ${s.max}` : '';
    const flag = s.type === COUNT_TYPE ? '--n' : `--set ${s.name}=`;
    const dflt = s.default !== undefined ? `  (default ${String(s.default)})` : '';
    return `${flag.padEnd(24)} ${values}${dflt}`;
  });
}

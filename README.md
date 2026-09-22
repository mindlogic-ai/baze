# baze

Run Claude Code, Codex and OpenCode through the Baze gateway with one API key, and read models, credits and usage from a shell.

## Install

```bash
npm i -g @mindlogic-ai/baze
baze --version
```

For a one-off call without installing:

```bash
npx @mindlogic-ai/baze models
```

The scoped name is required. Unscoped `baze` on npm is an unrelated 2017 package.

Node 20.10 or newer. No runtime dependencies.

## Log in

```bash
baze login
```

Paste the key from your Baze API keys page. Echo is off. The key names the Baze it belongs to, so AWS and NCP users run the same command; it is checked against the server before it is saved to `~/.baze/credentials.json` (mode 0600).

For CI, containers, or an older key that does not name its deployment, pipe the key and say which Baze it belongs to:

```bash
printf %s "$KEY" | baze login --with-key --host aws
printf %s "$KEY" | baze login --with-key --host ncp
```

`--host` also takes a full URL for an on-premise server. `BAZE_API_KEY` in the environment beats the stored key, so a container needs no login at all.

## Run a coding agent

```bash
baze claude
baze codex
baze opencode
```

Each command starts the tool you already have installed, pointed at the gateway with your key, and exits with the tool's exit code. Nothing is written to disk: the configuration travels as a temporary settings file (Claude Code), `-c` overrides (Codex) or `OPENCODE_CONFIG_CONTENT` (OpenCode), and your own config files stay untouched.

Every argument other than `--model`, `--dry-run` and `--api-base` (Codex: also `--reasoning-effort`) goes to the tool unchanged, `--help` and `--json` included. `baze claude --help` is Claude Code's help; baze's own is `baze help claude`.

```bash
baze claude --model claude-opus-5 -p "fix the failing test"
baze codex --model gpt-5.6 --reasoning-effort high exec --json "summarize this repo"
baze opencode --model gemini-3.5-pro run "explain src/"
baze claude --dry-run          # print the plan, start nothing
```

### Which harness reaches which models

| Harness | Protocol the tool speaks | Models it can use through baze |
|---|---|---|
| Claude Code (`baze claude`) | Anthropic Messages | Claude models only |
| Codex (`baze codex`) | OpenAI Responses | GPT models only |
| OpenCode (`baze opencode`) | Anthropic, Responses, Gemini and OpenAI-compatible providers | Every chat model this key can call, each on its native lane |

`baze models` shows the lane of every model. `--model` accepts a full id or a unique prefix.

## Make it permanent

```bash
baze setup claude
baze setup codex
baze setup opencode
```

`setup` rewrites the tool's user-level configuration so a plain `claude`, `codex` or `opencode` uses the gateway. The previous file is backed up first, and the command prints the backup path. **The written file holds your API key in plain text.** It is the user-level file, not a project one, so it is not committed, but on a shared machine prefer the launcher commands, which leave nothing behind. `--dry-run` prints the file without writing it.

## Commands

| Command | What it does |
|---|---|
| `baze login [--with-key] [--host aws\|ncp\|<url>]` | store and validate an API key |
| `baze logout [--revoke]` | delete the stored key; `--revoke` disables it on the server first |
| `baze auth` | the masked key, where it came from, and the host in effect |
| `baze env` | `eval "$(baze env)"` exports `BAZE_API_KEY` |
| `baze models [query] [--type T]` | models this key can call, with lane, context and list price |
| `baze embed [text...]` | embedding vectors, billed per token |
| `baze rerank <query> [doc...]` | order documents by relevance to a query |
| `baze guard [text...]` | find or mask personal data in text |
| `baze mcp [list] \| tools <suite> \| call <suite> <tool> ['{json}']` | the Baze first-party MCP suites |
| `baze credits` | monthly, purchased and org-granted balances |
| `baze usage [--from] [--to] [--by model\|key\|day] [--scope key\|member]` | gateway spend, Korea time, at most 92 days |
| `baze claude \| codex \| opencode [--model ID] [--dry-run]` | run that tool through the gateway |
| `baze setup <tool> [--model ID] [--dry-run]` | write the configuration permanently, with a backup |
| `baze doctor` | check key, host, Node, tool versions and conflicting config |
| `baze update` | `npm install -g @mindlogic-ai/baze@latest` |
| `baze docs` | print the agent manual |
| `baze help <command>` | help for one command |

## Global flags

| Flag | Effect |
|---|---|
| `--json` | machine-readable stdout |
| `--api-base <url>` | same as `BAZE_API_BASE`, for this call |
| `--no-input` | never prompt; fail instead |
| `-q`, `--quiet` | drop hints and progress notes |

Launchers do not take the global flags. On `baze claude`, `baze codex` and `baze opencode`, `--json`, `-q` and `--help` belong to the tool.

## Environment

| Variable | Effect |
|---|---|
| `BAZE_API_KEY` | beats the stored key (CI, containers) |
| `BAZE_API_BASE` | beats the stored host |
| `BAZE_CONFIG_DIR` | config directory (default `~/.baze`) |

## If your organization filters API traffic

A Baze admin can screen API requests for personal data and restricted words (the same
filter the chat app has). With **blocking** on, any turn whose text carries a phone number,
an ID, or a listed word is refused with `400 Request blocked by content policy` - and coding
agents send code, logs and git history, so it will happen. `baze login` and `baze doctor`
warn when the key's organization has this on. The fix is on the admin side: switch the API
filter to masking, or exempt the API. With **masking** on, requests go through, but personal
data in what the agent sent reaches the model rewritten.

## Output and exit codes

stdout is data and stderr is prose, so `baze models --json | jq` and `eval "$(baze env)"` are safe. Exit codes: `0` ok, `1` error, `2` out of credit, `127` the tool is not installed. A launcher exits with the tool's own code.

## Contributing

```bash
npm ci
npm test            # compiles to .build/ and runs node --test
npm run typecheck
npm run build       # dist/index.js with the version stamped in
```

Releases are a `v*` tag on `main`; `.github/workflows/release.yml` publishes to npm with provenance through Trusted Publishing. Adding a model to the gateway never needs a release: the CLI reads the catalog at run time.

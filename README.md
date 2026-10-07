# baze

Run Claude Code, Codex, OpenCode and Hermes Agent through the Baze gateway with one API key, and read models, credits and usage from a shell.

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
baze hermes
```

Each command starts the tool you already have installed, pointed at the gateway with your key, and exits with the tool's exit code. Nothing is written to disk: the configuration travels as a temporary settings file (Claude Code), `-c` overrides (Codex), `OPENCODE_CONFIG_CONTENT` (OpenCode) or environment variables plus `--provider custom` (Hermes), and your own config files stay untouched.

Every argument other than `--model`, `--dry-run` and `--api-base` (Codex: also `--reasoning-effort`) goes to the tool unchanged, `--help` and `--json` included. `baze claude --help` is Claude Code's help; baze's own is `baze help claude`.

```bash
baze claude --model claude-opus-5 -p "fix the failing test"
baze codex --model gpt-5.6 --reasoning-effort high exec --json "summarize this repo"
baze opencode --model gemini-3.5-pro run "explain src/"
baze hermes --model gpt-6-sol -z "summarize this repo"
baze claude --dry-run          # print the plan, start nothing
```

### Which harness reaches which models

| Harness | Protocol the tool speaks | Models it can use through baze |
|---|---|---|
| Claude Code (`baze claude`) | Anthropic Messages | Every chat model; non-Claude models are converted to chat completions by the gateway |
| Codex (`baze codex`) | OpenAI Responses | GPT models only |
| OpenCode (`baze opencode`) | Anthropic, Responses, Gemini and OpenAI-compatible providers | Every chat model this key can call, each on its native lane |
| Hermes Agent (`baze hermes`) | OpenAI Chat Completions | Every chat model this key can call, all over Chat Completions |

`baze models` shows the lane of every model. `--model` takes the full id as `baze models` prints it.

Hermes sends a key from the environment only to the host it was issued for, and derives the variable's name from the domain, so `baze hermes` passes your key as `MINDLOGIC_API_KEY` (AWS) or `BAZE_API_KEY` (NCP) together with `CUSTOM_BASE_URL`. A `~/.hermes/.env` that sets either of those wins over the launch; baze warns when it does. There is no `baze setup hermes` yet.

## Generate images, video, speech and music

```bash
baze models --type image                       # what this key can call
baze gen image "a poster for a jazz night" --model gpt-image-1 --set quality=high
baze gen image "make it blue" --model gpt-image-1 --image poster.png -o blue.png
baze gen video "the camera slowly circles" --model bytedance/seedance-1-pro --image blue.png --set duration=5
baze gen speech "안녕하세요" -o hello.wav
baze gen music "short upbeat synth jingle" --model lyria-3-clip-preview
baze gen transcribe meeting.m4a --lang ko,en > meeting.txt
baze gen video --model bytedance/seedance-1-pro --params    # what --set takes
```

Results land in the current directory and their paths are printed, so the next command (or your coding agent) can use them directly. `--set` is checked against the model before anything is sent. A video is waited for; if you stop it, `baze gen wait <id>` picks it up again, and `baze history` lists every call with its files.

## Talk to a studio chatbot

```bash
baze bot ask 3840 "연차 이월 규정 알려줘"
baze bot ask 3840 "그럼 신입은?" --continue
baze bot chat 3840
```

The chatbot answers from its own knowledge and workflow, as it does in the studio. Its owner has to turn on API access.

## Make it permanent

```bash
baze setup claude
baze setup codex
baze setup opencode
```

`setup` rewrites the tool's user-level configuration so a plain `claude`, `codex` or `opencode` uses the gateway. The previous file is backed up first, and the command prints the backup path. `--dry-run` prints the file without writing it.

Where the key ends up differs by tool:

- **Claude Code**: `~/.claude/settings.json` holds the key in plain text, because Claude Code reads it only from there or the environment. It is the user-level file, not a project one, so it is not committed, but on a shared machine prefer `baze claude`, which leaves nothing behind.
- **Codex and OpenCode**: the config names the `BAZE_API_KEY` variable and holds no key. Put `eval "$(baze env)"` in your shell's startup file, or use `baze codex` / `baze opencode`, which need no variable.

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
| `baze gen image\|video\|speech\|music\|transcribe` | generate media; results are saved as files in the current directory |
| `baze gen wait <id>` | collect a job started with `--no-wait` or interrupted |
| `baze bot ask\|chat <chatbot id>` | talk to a studio chatbot, with its knowledge, workflow and tools |
| `baze history` | every generation and bot call from this machine |
| `baze credits` | monthly, purchased and org-granted balances |
| `baze usage [--from] [--to] [--by model\|key\|day] [--scope key\|member]` | gateway spend, Korea time, at most 92 days |
| `baze claude \| codex \| opencode \| hermes [--model ID] [--dry-run]` | run that tool through the gateway |
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

Launchers do not take the global flags. On `baze claude`, `baze codex`, `baze opencode` and `baze hermes`, `--json`, `-q` and `--help` belong to the tool.

## Environment

| Variable | Effect |
|---|---|
| `BAZE_API_KEY` | beats the stored key (CI, containers) |
| `BAZE_API_BASE` | beats the stored host |
| `BAZE_CONFIG_DIR` | config directory (default `~/.baze`) |

## If a turn fails with "Request blocked by content policy"

A Baze admin can screen API requests for personal data and restricted words. With blocking
on, a turn whose text carries a phone number, an ID, or a listed word is refused with that
`400`, and coding agents send code, logs and git history, so it can happen. Nothing in baze
lifts it: ask the admin to switch the API filter to masking, or to exempt the API.

## Output and exit codes

stdout is data and stderr is prose, so `baze models --json | jq` and `eval "$(baze env)"` are safe. Exit codes: `0` ok, `1` error, `2` out of credit, `127` the tool is not installed. A launcher exits with the tool's own code.

## For coding agents

`skills/baze/SKILL.md` is an agent skill for `baze gen`, `embed`, `rerank`, `guard`, `mcp` and `bot`, released with the CLI so it never describes a flag this version does not have. `baze skill install` puts it into Claude Code and Codex (`baze skill status` shows whether it is current); for another agent, copy the folder into its skills directory. The full machine contract is `baze docs`.

## Contributing

```bash
npm ci
npm test            # compiles to .build/ and runs node --test
npm run typecheck
npm run build       # dist/index.js with the version stamped in
```

Releases are a `v*` tag on `main`; `.github/workflows/release.yml` publishes to npm with provenance through Trusted Publishing. Adding a model to the gateway never needs a release: the CLI reads the catalog at run time.

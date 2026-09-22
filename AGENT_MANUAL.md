# baze — agent manual

This is `baze` described for a program that drives it: exact invocations, output shapes, exit codes. `baze docs` prints this file. The human-facing version is README.md.

## Contract

- **stdout is data, stderr is prose.** Every table, hint, warning and progress note goes to stderr. With `--json`, stdout holds exactly one JSON document and nothing else.
- **Exit codes:** `0` ok · `1` error · `2` out of credit (the gateway answered 402) · `127` the tool to launch is not installed. A launcher (`claude`, `codex`, `opencode`) exits with the tool's own code.
- **`--no-input`** makes every command fail instead of prompting. Use it in unattended runs.
- **`-q` / `--quiet`** drops hints and progress notes on stderr. Errors still print.
- **`--json` shapes** are the compatibility contract of this package: a field is only ever added in a minor version; removing or renaming one is a major version.
- Launchers take none of the global flags. On `baze claude|codex|opencode`, everything but `--model`, `--dry-run` and `--api-base` (Codex: also `--reasoning-effort`) is forwarded to the tool, `--help` and `--json` included.

## Credentials

Resolution order: `BAZE_API_KEY` → `~/.baze/credentials.json` (or `$BAZE_CONFIG_DIR/credentials.json`). Host: `--api-base` → `BAZE_API_BASE` → the host stored at login.

```bash
printf %s "$KEY" | baze login --with-key --host aws --no-input   # or --host ncp, or --host https://<server>
baze auth
baze logout
```

`baze auth` prints two stderr lines, the masked key with its source and the host in effect. It has no `--json`; read the key from `baze env` and the host from `BAZE_API_BASE` or the credentials file instead.

For a container, set `BAZE_API_KEY` and skip login. For a shell: `eval "$(baze env)"`.

## Catalog

```bash
baze models --json
baze models --json --type embedding      # llm (default) | audio | image | video | embedding | rerank | realtime
baze models gpt-5 --json                 # substring filter on the id
```

Array of rows:

```json
[
  {
    "id": "claude-sonnet-5",
    "type": "llm",
    "lane": "anthropic" | "responses" | "gemini" | "compat",
    "contextLimit": 200000,
    "maxOutputTokens": 64000,
    "pricing": {
      "inputPer1mUsd": 3.0,
      "outputPer1mUsd": 15.0,
      "cacheReadPer1mUsd": 0.3,
      "cacheWritePer1mUsd": 3.75,
      "cacheWrite1hPer1mUsd": 6.0
    }
  }
]
```

`contextLimit`, `maxOutputTokens` and every pricing rate may be `null`; `pricing` itself may be `null`. Prices are USD per 1M tokens at list price. The lane decides which harness can run the model: `anthropic` → Claude Code and OpenCode; `responses` → Codex and OpenCode; `gemini` and `compat` → OpenCode only.

## Credits and usage

```bash
baze credits --json
```

```json
{
  "object": "credit_balance",
  "monthly_allocated": { "quota": 0, "used": 0, "remaining": 0, "renewal_date": "YYYY-MM-DD" | null },
  "purchased":         { "quota": 0, "used": 0, "remaining": 0 },
  "org_granted":       { "quota": 0, "used": 0, "remaining": 0 },
  "total":             { "quota": 0, "used": 0, "remaining": 0 }
}
```

```bash
baze usage --json                                   # this month, this key, by model
baze usage --json --from 2026-09-01 --to 2026-09-22 --by day
baze usage --json --by key                          # implies --scope member
```

```json
{
  "object": "usage_summary",
  "start_date": "2026-09-01",
  "end_date": "2026-09-22",
  "timezone": "Asia/Seoul",
  "group_by": "model" | "key" | "day",
  "scope": "key" | "member",
  "total": { "call_count": 0, "credits": 0 },
  "rows": [ { "key": "<model id | key label | YYYY-MM-DD>", "call_count": 0, "credits": 0 } ]
}
```

Dates are Korea time. The window is at most 92 days. Credits are what the server billed; the CLI never computes a price.

## Running a coding agent

```bash
baze claude  [--model ID] [--dry-run] [<claude args>]
baze codex   [--model ID] [--reasoning-effort low|medium|high|max] [--dry-run] [<codex args>]
baze opencode [--model ID] [--dry-run] [<opencode args>]
```

`--model` takes a full id or a unique prefix and must be on a lane the tool speaks (Claude Code: `anthropic`; Codex: `responses`; OpenCode: any). Nothing is written to disk. `--dry-run` prints the launch plan (binary, arguments, environment with the key masked) to stderr and exits `0` without starting the tool.

Unattended examples:

```bash
baze claude -p "run the tests and fix what fails" --output-format json
baze codex exec --json "summarize the diff"
baze opencode run "explain src/index.ts"
```

`baze setup <claude|codex|opencode> [--model ID] [--dry-run]` writes the tool's user-level config permanently, backing up the old file; the file then holds the key in plain text. Prefer the launchers in automation.

## Lanes

```bash
baze embed "text a" "text b" --json                 # or --file <one per line>, or stdin
baze rerank "<query>" "doc a" "doc b" --top-n 5 --json
baze guard "text with a phone number" --mode mask --json   # mode mask (default) | detect
```

`embed`: `{ "data": [ { "index": 0, "embedding": [ … ] } ], "model": "…", "usage": { "prompt_tokens": 0, "total_tokens": 0 } }`. At most 2048 inputs; `--dimensions N`; `--task-type` for gemini-embedding-2 only.

`rerank`: `{ "model": "…", "results": [ { "index": 0, "relevance_score": 0.9 } ], "usage": { "total_tokens": 0 } }`, best first. At most 500 documents of 32,000 characters.

`guard`: `{ "mode": "mask", "flagged": true, "results": [ { "index": 0, "flagged": true, "categories": [ "…" ], "entities": [ { "category": "…", "text": "…" } ], "masked_text": "…" } ], "usage": { "requests": 1 } }`. At most 100 items of 20,000 characters, billed per item. Text only.

## MCP suites

```bash
baze mcp list --json                     # [ { "slug", "name", "display_name", "description", "url", "transport" } ]
baze mcp tools <suite> --json            # the suite's tool objects as the server sends them: [ { "name", "description", "inputSchema" } ]
baze mcp call <suite> <tool> '{"arg": "value"}' --json   # the JSON-RPC result, usually { "content": [ { "type": "text", "text": "…" } ] }
echo '{"arg": "value"}' | baze mcp call <suite> <tool> --json
```

Listing and `tools` are free; each `call` is billed as one tool call. The suites are not injected into the launchers; a harness that should use one is configured with the `url` from `list`.

## Diagnostics

```bash
baze doctor          # exit 1 when anything needs fixing; every line on stderr
baze update          # npm install -g @mindlogic-ai/baze@latest
baze --version
baze help <command>
```

### Organization content filter

A `400` whose message starts with `Request blocked by content policy` means the organization
screens API requests for personal data or restricted words and refused this one. It arrives
inside the harness, not from baze, and baze cannot lift it. Do not retry the turn; tell the
user what the message says (ask the admin to mask instead of block, or to exempt the API).

## Environment

| Variable | Effect |
|---|---|
| `BAZE_API_KEY` | beats the stored key |
| `BAZE_API_BASE` | beats the stored host |
| `BAZE_CONFIG_DIR` | config directory (default `~/.baze`) |

# baze — agent manual

This is `baze` described for a program that drives it: exact invocations, output shapes, exit codes. `baze docs` prints this file. The human-facing version is README.md.

## Contract

- **stdout is data, stderr is prose.** Every table, hint, warning and progress note goes to stderr. With `--json`, stdout holds exactly one JSON document and nothing else.
- **Exit codes:** `0` ok · `1` error · `2` out of credit (the gateway answered 402) · `127` the tool to launch is not installed. A launcher (`claude`, `codex`, `opencode`, `hermes`) exits with the tool's own code.
- **Unknown options are errors.** Every command but a launcher exits `1` on an option it does not take, instead of ignoring it. Use `--` before an argument that starts with a dash.
- **Request ids.** When the gateway sends one, a failed call prints `request id: <uuid>` on stderr, and every `--json` result of `gen` and `bot` carries `request_id`. Quote it to support.
- **`--no-input`** makes every command fail instead of prompting. Use it in unattended runs.
- **`-q` / `--quiet`** drops hints and progress notes on stderr. Errors still print.
- **`--json` shapes** are the compatibility contract of this package: a field is only ever added in a minor version; removing or renaming one is a major version.
- Launchers take none of the global flags. On `baze claude|codex|opencode|hermes`, everything but `--model`, `--dry-run` and `--api-base` (Codex: also `--reasoning-effort`) is forwarded to the tool, `--help` and `--json` included.

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
baze models --json --type embedding      # llm (default) | audio | image | video | embedding | rerank | decisions | realtime
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

`contextLimit`, `maxOutputTokens` and every pricing rate may be `null`; `audio` rows add `audioClient` (`google` text-to-speech, `google_lyria3` / `elevenlabs` music, `soniox` transcription); `pricing` itself may be `null`. Prices are USD per 1M tokens at list price. The lane decides which harness can run the model: `anthropic` → Claude Code and OpenCode; `responses` → Codex and OpenCode; `gemini` and `compat` → OpenCode only. Hermes runs every lane over Chat Completions.

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
baze hermes  [--model ID] [--dry-run] [<hermes args>]
```

`--model` takes a full id and must be on a lane the tool speaks (Claude Code: `anthropic`; Codex: `responses`; OpenCode and Hermes: any). Nothing is written to disk. `--dry-run` prints the launch plan (binary, arguments, environment with the key masked) to stderr and exits `0` without starting the tool.

Unattended examples:

```bash
baze claude -p "run the tests and fix what fails" --output-format json
baze codex exec --json "summarize the diff"
baze opencode run "explain src/index.ts"
baze hermes -z "explain src/index.ts"
```

`baze setup <claude|codex|opencode> [--model ID] [--dry-run]` writes the tool's user-level config permanently, backing up the old file. For Claude Code that file holds the key in plain text; the Codex and OpenCode configs name `BAZE_API_KEY` and hold no key. `--dry-run` prints the would-be file with the key masked (first 6 and last 4 characters) and writes nothing. Prefer the launchers in automation.

## Lanes

```bash
baze embed "text a" "text b" --json                 # or --file <one per line>, or stdin
baze rerank "<query>" "doc a" "doc b" --top-n 5 --json
baze guard "text with a phone number" --mode mask --json   # mode mask (default) | detect
```

`embed`: `{ "data": [ { "index": 0, "embedding": [ … ] } ], "model": "…", "usage": { "prompt_tokens": 0, "total_tokens": 0 } }`. At most 2048 inputs; `--dimensions N`; `--task-type` for gemini-embedding-2 only.

`rerank`: `{ "model": "…", "results": [ { "index": 0, "relevance_score": 0.9 } ], "usage": { "total_tokens": 0 } }`, best first. At most 500 documents of 32,000 characters.

`guard`: `{ "mode": "mask", "flagged": true, "results": [ { "index": 0, "flagged": true, "categories": [ "…" ], "entities": [ { "category": "…", "text": "…" } ], "masked_text": "…" } ], "usage": { "requests": 1 } }`. At most 100 items of 20,000 characters, billed per item. Text only.

## Generating media

```bash
baze gen image "<prompt>" --model ID [--set k=v]... [--image <file|url>]... [--n N] [-o file] --json
baze gen video "<prompt>" --model ID [--set k=v]... [--image <file|url>] [--no-wait] [--timeout S] [-o file] --json
baze gen speech "<text>" [--model ID] [--voice NAME] [-o file.wav] --json
baze gen music "<prompt>" --model ID [--lyrics "..."] [--seconds N] [--instrumental] [-o file.mp3] --json
baze gen transcribe <audio file> [--model ID] [--lang ko,en] [--no-diarize] [-o file.txt] --json
baze gen wait <history id> --json
baze gen <kind> --model ID --params --json      # the parameters the model takes; nothing is billed
baze gen image|video|music ... --estimate --json  # what that exact call would charge; nothing is billed
```

Result:

```json
{
  "kind": "image" | "video" | "speech" | "music" | "transcribe",
  "model": "…",
  "history_id": "8 hex chars",
  "files": [ "/absolute/path/of/each/result" ],
  "operation_id": "…",            // video, transcribe, async image
  "text": "…",                    // transcribe only; also "segments": [ … ]
  "credits": 40 | null,           // what the call deducted; null when the gateway did not report it (today: speech for a legacy-mode organization; the call is still billed, `baze usage` has the amount) or a failed video (refunded)
  "request_id": "…" | null
}
```

- `--model` is required for image, video and music (prices differ a hundredfold between models; `baze models --type image|video|audio`). Speech and transcription default to the first model of their engine.
- `--set` is checked against the model's published parameters before the request is sent: an unknown name or a value outside the list exits `1` with the allowed values, and nothing is billed. `--params --json` returns them: `[ { "name", "type": "enum" | "duration" | "num_images", "required", "default", "values"?, "max"? } ]`. The image count is `--n`, never `--set n=`.
- `--estimate` prices the call the other flags describe and makes none (image, video, music; no prompt needed). The server computes it with the function it bills with, so it matches the charge: `{ "object": "estimate", "kind", "model", "credits", "exact", "bound", "lines": [ { "item", "credits", "exact", "bound", "basis", "note"? } ], "request_id" }`. `bound` is where the charge lies against `credits`: `exact`; `minimum` for a token-priced image model (the charge is at least `credits`); `maximum` for a sound effect whose length the engine picks (at most `credits`); `approximate` when the call may draw the member's own credit at another rate (either way). `exact` is `bound == "exact"`. Read `bound`, not the wording of `note`. A `content_filter` line appears when the organization screens prompts. An older server answers exit `1`, "cannot quote prices yet".
- `--image` takes a URL, or a local png/jpg/webp/gif of up to 18 MB, sent inline. Image: edit or reference. Video: the first frame.
- Files are written to the current directory as `baze-<kind>-<local time>-<4 hex>.<ext>` unless `-o` names them; with several images, `-o out.png` becomes `out-1.png`, `out-2.png`. Speech is saved as WAV (24 kHz, 16-bit, mono).
- A video is waited for, polling every 5 s, up to `--timeout` seconds (default 900). Killing the process does not lose the job: it was recorded before the first poll. `--no-wait` prints the history id on stdout (with `--json`: `{ "history_id", "operation_id", "status": "processing" }`) and exits `0`; `baze gen wait <id>` collects it later. A job that fails after the gateway accepted it is refunded by the gateway; the CLI exits `1` with the provider's reason.

## Studio chatbots

```bash
baze bot ask <chatbot id> "<question>" [--continue] [--save] [--timeout S] --json
echo "<question>" | baze bot ask <chatbot id> --json
baze bot chat <chatbot id> [--continue]          # interactive; refuses without a terminal
```

```json
{
  "bot": 3840,
  "text": "…",
  "files": [ { "filename", "mime_type", "url", "expires_in" } ],
  "saved": [ "/absolute/path" ],
  "credits": 18.52,
  "request_id": "…" | null,
  "history_id": "…",
  "turns": 3
}
```

The chatbot runs as it does in the studio: its prompt, knowledge, workflow and tools. The gateway keeps no conversation; `--continue` resends this machine's last conversation with that bot (`~/.baze/conversations/bot-<id>.json`), so `turns` grows and so does the cost. `--save` downloads the files the bot produced into the current directory. A reply that has not come after `--timeout` seconds (default 600) is an error; the bot may still be running on the server. The chatbot needs API access turned on by its owner; the id is a number.

## History

```bash
baze history [--last N] [--kind image|video|speech|music|transcribe|bot] --json
```

Newest first, one object per call: `{ "id", "at", "kind", "model", "status": "submitted" | "processing" | "completed" | "failed", "host", "prompt"?, "operation_id"?, "files"?, "credits"?, "request_id"?, "error"? }`. In the table a completed call whose charge was not reported shows `billed`, not an amount. Kept on this machine only, in `~/.baze/history.jsonl` (0600); prompts are cut at 500 characters.

## MCP suites

```bash
baze mcp list --json                     # [ { "slug", "display_name", "description", "url", "transport" } ]
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

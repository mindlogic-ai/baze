---
name: baze
description: Generate images, video, speech and music, transcribe audio, embed or rerank text, find and mask personal data, call Baze MCP tools, and ask a company's studio chatbots from the shell with the `baze` CLI. Use when the user wants a picture, clip, voice-over, jingle or transcript made or edited; wants embedding vectors, documents ordered by relevance, or phone numbers, emails and ID numbers found or masked in text; wants a Korean public-data tool (holidays, statutes, disclosures, papers and more) called; wants to ask one of their organization's Baze chatbots (knowledge, workflow, tools); or wants to find, resume or reuse something generated earlier. Requires `baze` installed and logged in.
---

# baze

`baze` talks to the Baze gateway with the user's own API key. Every call is billed to the user, so follow the cost rules below.

Before the first use in a session, check it works: `baze auth` (stderr shows the key and host). If it says there is no key, ask the user to run `baze login`; never ask for the key itself.

Always pass `--json` and read stdout; stderr is for people. Exit `2` means out of credit: stop and tell the user (`baze credits`).

## Cost rules

- Image, video and music take `--model`, and prices differ a hundredfold between models. List them with `baze models --type image|video|audio --json` and pick the one the user named, or ask. Do not pick the most expensive by default.
- Before a video, music or a batch of images, run the same command with `--estimate --json` (free, no prompt needed) and tell the user the credits and the model. It is what the call will charge. `bound` says how sure: `exact`, `minimum` (say "at least"), `maximum` ("at most") or `approximate` ("about"); pass on the `note` when there is one.
- Check parameters first, it is free: `baze gen <kind> --model ID --params --json`. `baze gen` refuses a bad `--set` value locally, so a refused call costs nothing; fix it and retry.
- Never loop a paid call on failure. A failure after the gateway accepted a job is refunded automatically; report the reason instead of retrying blindly.

## Generate

```bash
baze gen image "<prompt>" --model <id> [--set k=v]... [--image <file|url>]... [--n N] [-o out.png] --json
baze gen video "<prompt>" --model <id> [--set duration=5] [--image first-frame.png] [-o out.mp4] --json
baze gen speech "<text>" [--voice NAME] [-o out.wav] --json
baze gen music "<prompt>" --model <id> [--lyrics "..."] [--seconds N] [--instrumental] --json
baze gen transcribe <audio file> [--lang ko,en] --json
```

The result's `files` are absolute paths to the saved outputs; use them directly (for example, pass an image from one call as `--image` to the next to edit it or animate it). `--image` takes a local file of up to 18 MB or a URL.

Video takes one to several minutes and `baze gen video` waits (default limit 900 s). For a long job, start it with `--no-wait` and collect it with `baze gen wait <history_id> --json` - the job survives an interrupted wait. `baze history --kind video --json` lists what is still `processing`.

## Text: embeddings, reranking, personal data

```bash
baze embed "text a" "text b" --json                      # or --file <one per line>, or stdin; --model from `baze models --type embedding`
baze rerank "<query>" "doc a" "doc b" --top-n 5 --json   # best first: results[].index points into the documents you passed
baze guard "<text>" --json                               # --mode mask (default) returns masked_text; --mode detect only lists what it found
```

All three are cheap next to media but still billed: embed and rerank per token, guard per item (one per argument, whatever its length), so batch paragraphs rather than sentences. Use `guard` before you put user-supplied text into something shared; its masks are fixed labels such as `[PHONE]`, `[EMAIL]` and `[ID-NUMBER]`. Test values such as `example.com` addresses are left alone on purpose, so an empty result is not proof the format was missed.

## MCP tools

```bash
baze mcp list --json                                    # the suites: slug, display_name, description
baze mcp tools <suite> --json                           # its tools, each with an inputSchema
baze mcp call <suite> <tool> '{"arg": "value"}' --json
```

Read `tools` before the first `call` and pass arguments that match the `inputSchema`. The suites cover Korean public data (holidays and lunar dates, statutes, DART disclosures, business registration, papers, air quality and more); prefer them over your own knowledge for those facts.

## Studio chatbots

```bash
baze bot ask <chatbot id> "<question>" --json
baze bot ask <chatbot id> "<follow-up>" --continue --json
baze bot ask <chatbot id> "<request for a document>" --save --json
```

The id is a number the user gives you. The answer comes from that chatbot's own knowledge and workflow, so prefer it over your own knowledge for questions about the user's organization. `--continue` keeps the conversation (and resends it, so the cost grows each turn); leave it off to start fresh. `--save` downloads files the bot produced into the current directory. A 403 or 404 usually means the chatbot's owner has not turned on API access.

## When something fails

Quote the `request_id` from the JSON or the `request id:` line on stderr when you tell the user. `baze docs` prints the full manual, including every `--json` shape.

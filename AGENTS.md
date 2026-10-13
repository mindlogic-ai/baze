# AGENTS.md

Instructions for anyone, human or agent, changing this repo. `CLAUDE.md` includes this file.

## This repo is public

Every commit message, branch name, PR title and body, review comment and issue here is readable by anyone. Write them for an outside reader.

Never put any of these in a commit, PR, issue or code comment:

- customer or organization names, tenant ids, member ids, API key ids, key counts or usage figures
- links to Slack, internal docs, dashboards, or private repos (including PR and issue numbers of private repos)
- people's names other than the commit author, internal release or QA labels, hostnames of non-public environments
- API keys, even revoked ones; tests use obviously fake values

Describe the behavior instead: "a stopped organization's 503 moved the probe on", not who hit it or where it was reported. Keep internal context in the internal tracker and link nothing back.

## Commits

- Author: your work identity (`Jaeho Shin <jaeho.shin@mindlogic.ai>` for this team), never a personal address. Set it with `git config --global` or `git -c user.email=...` per command, never repo-level `git config user.email`.
- Product name in all copy is **Baze**.

## Checks before a PR

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## Releases

Bump `version` in `package.json`, merge to `main`, then push a tag `v<version>`. `.github/workflows/release.yml` publishes to npm with provenance through Trusted Publishing; no token is stored anywhere.

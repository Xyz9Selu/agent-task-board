# agent-dev-team (adt)

A local CLI that drives a multi-agent dev team from GitHub Issues.

## Setup

```bash
npm install && npm run build && npm link && adt setup
```

Prompts for: GitHub PAT (repo scope), repos to watch (owner/repo), path to cc-mm.

## Usage

```bash
# Schedule periodic runs:
while true; do adt run; sleep 60; done
# or cron: */1 * * * * adt run >> ~/.adt/log 2>&1
```

Commands: `adt run`, `adt status`, `adt pause owner/repo#42`, `adt resume owner/repo#42`, `adt clean`.

## Pages

- `/` — landing page with the hero, counter, and links.
- `/contact` — small contact form (name / email / message). Client-side only;
  submissions are not stored.

## How it works

1. Label an Issue `adt:ready`
2. Next `adt run` picks it up
3. Team walks through 4 stages: **reqs** (PM) -> **design** (Dev) -> **impl** (Dev) -> **review** (Reviewer)
4. At reqs, design, and merge the team pauses for your input
5. Everything happens in GitHub Issue/PR comments and labels

## Requirements

Node.js 20+, cc-mm CLI, local git clone

# ComfortHelper医疗康复助手

ComfortHelper医疗康复助手 is a dual-portal medical rehabilitation MVP for doctor managers and patient families. It supports patient onboarding, AI-assisted document extraction, rehabilitation advice, medication and follow-up reminders, family Q&A, task follow-up, and audit-ready operations.

## Run Locally

```bash
npm run dev
```

Optional LLM configuration uses an OpenAI-compatible chat completions API. Do not commit API keys.
Family Q&A and the family portal's daily rehabilitation advice both use this API when `EVOMAP_LLM_API_KEY` is present. If the key is missing or the request fails, the UI shows `AI 本地兜底`.

You can also put the key in an untracked local file:

```bash
# .env.local
EVOMAP_LLM_API_KEY="your-key"
```

```bash
EVOMAP_LLM_API_KEY="your-key" \
EVOMAP_LLM_URL="https://api.evomap.ai/v1/chat/completions" \
EVOMAP_LLM_MODEL="evomap-deepseek-v4-flash" \
npm run dev
```

Optional EvoMap A2A live connection is disabled by default. Without these variables, ComfortHelper only prepares official `gep-a2a` envelopes locally and does not call EvoMap.

```bash
EVOMAP_A2A_LIVE=true \
EVOMAP_NODE_ID="node_012345abcdef" \
EVOMAP_NODE_SECRET="your-node-secret" \
npm run dev
```

The same A2A values can live in `.env.local`:

```bash
EVOMAP_A2A_LIVE=true
EVOMAP_A2A_BASE_URL="https://evomap.ai"
EVOMAP_NODE_ID="node_012345abcdef"
EVOMAP_NODE_SECRET="your-node-secret"
```

`POST /api/evomap/hello` can be called without `EVOMAP_NODE_SECRET`; if EvoMap returns a `node_secret`, the API response redacts it and does not write it to `data/runtime.json`. Store secrets outside the repo, then pass them through environment variables.

## EvoMap Live Evolution Gate

The real remote closed loop is `POST /api/evomap/evolution/run-live` or:

```bash
npm run evomap:live-check
```

This path does not accept simulated or local-only remote results. It only auto-applies a local strategy when live EvoMap `hello`, memory record, memory recall, fetch, and validate all return `synced`. If any step is missing, local-only, blocked, or failed, the strategy is not changed.

To create and save a real EvoMap node secret in the ignored `.env.local` file, run this only after the operator approves storing a persistent node secret:

```bash
npm run evomap:setup-node -- --save-secret
```

The setup script does not print the secret. It saves `EVOMAP_A2A_LIVE`, `EVOMAP_A2A_BASE_URL`, `EVOMAP_NODE_ID`, and `EVOMAP_NODE_SECRET`, then prints the `claimUrl` returned by EvoMap. Memory record/recall can still fail with `insufficient_node_credits`; in that case, claim the node in EvoMap and add credits before rerunning `npm run evomap:live-check`.

Open:

```text
http://localhost:4173
```

## What Is Included

- Web admin dashboard for study overview.
- Patient list, patient creation form, and patient detail drawer.
- Seeded patients, source documents, AI extraction candidates, visit plans, medication plans, and tasks.
- Minimal JSON API backed by `data/seed.json`.
- Node built-in tests for the MVP API.
- End-to-end-style happy path test that exercises import, document upload, AI confirmation, visit completion, medication adjustment, task handling, quality review, and export.
- Runtime actions for creating a test patient, confirming AI extraction fields, and completing visits.
- Existing patient document upload simulation, which generates a new AI review task.
- Bulk import simulation for creating multiple test subjects and their AI review work.
- Quality/audit workspace for pending documents, AI reviews, open tasks, and audit logs.
- Medication dose adjustment simulation based on body-weight change, including audit and follow-up task generation.
- Runtime persistence in `data/runtime.json`, with a reset button to restore seed data.
- CSV export for the current subject list.

## MVP Flows

1. Open `患者建档` and submit `新建并抽取`.
2. Click `批量导入测试患者` to create multiple seeded patients at once.
3. Open a patient detail drawer and click `模拟上传` to add a follow-up document.
4. Open `AI复核` and click `确认入档` for the generated candidate fields.
5. Open `访视用药`, click `完成访视`, and use `体重调整` to simulate a medication dose recalculation.
6. Open `任务` and click `完成任务`.
7. Open `质控审计` to review pending issues and audit logs.
8. Return to `总览` to see refreshed metrics and audit events.
9. Click `导出CSV` to export the current subject list.
10. Click `测试数据` to reset the runtime data back to the seed dataset.

Runtime edits are saved to `data/runtime.json` while the local server is running. The file is ignored by Git. Use the `测试数据` button to restore the initial seed data from `data/seed.json`.

## Project Structure

```text
apps/
  api/        Minimal Node HTTP API and static server
  web-admin/ Static MVP web app
data/
  seed.json  Test data for the MVP
docs/
  technical-architecture-draft.md
tests/
  api.test.js
```

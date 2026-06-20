# EvoMap MVP

EvoMap is a clinical research management MVP for patient onboarding, AI-assisted document extraction, visit/medication planning, task follow-up, and audit-ready study operations.

## Run Locally

```bash
npm run dev
```

Optional LLM configuration uses an OpenAI-compatible chat completions API. Do not commit API keys.

```bash
EVOMAP_LLM_API_KEY="your-key" \
EVOMAP_LLM_URL="https://api.evomap.ai/v1/chat/completions" \
EVOMAP_LLM_MODEL="evomap-deepseek-v4-flash" \
npm run dev
```

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

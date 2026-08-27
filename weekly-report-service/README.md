# Hexalog Weekly Report Automation

Two independent services:

- `npm run weekly-report`: Render Cron Job entry point. Pulls Freshsales and Meta Ads through MCP, reconciles, computes correlations, stores a Postgres snapshot, renders HTML, and delivers/notifies for Notion.
- `npm run chat`: Always-on Render Web Service. Serves `POST /api/chat` from stored snapshots only. It never calls Freshsales or Meta MCP.

## Setup

1. Copy `.env.example` to `.env` and fill the secrets in your deployment environment.
2. Replace `config/mapping.json` with finalized Freshsales source to Meta campaign/ad set mappings.
3. Confirm the Meta OAuth session path is dedicated to this service before each deploy.
4. Install dependencies with `npm install`.
5. Run `npm run typecheck` and `npm run audit:meta`.
6. Set `DATABASE_URL` to the Render Postgres connection string for both deployed services.

## Freshsales Qualification Metric

Qualified leads use `contact_status_id = 402002304551` (`CC Qualified`). The secondary candidate field `cf_qualification_status = 1620` is documented in `config/mapping.json` but is not used for the metric unless the project brief is updated.

## Scheduling

Do not add an in-process scheduler. Configure Render Cron or GitHub Actions to invoke `npm run weekly-report` weekly. The script applies `CRON_JITTER_MINUTES` at runtime, defaulting to plus/minus 30 minutes.

## Chat API

`POST /api/chat`

```json
{ "week": "2026-08-17", "question": "What changed most this week?" }
```

Set `CHAT_ALLOWED_ORIGIN` to the exact report hosting origin before sharing reports.

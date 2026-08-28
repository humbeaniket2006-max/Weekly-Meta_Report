# Hexalog Weekly Report Automation

One scheduled service:

- `npm run weekly-report`: GitHub Actions entry point. Pulls Freshsales and Meta Ads through MCP, stores the weekly snapshot in Turso, reconciles the current week, renders HTML, and delivers/notifies for Notion.

## Setup

1. Copy `.env.example` to `.env` and fill the secrets in your deployment environment.
2. Replace `config/mapping.json` with finalized Freshsales source to Meta campaign/ad set mappings.
3. Confirm the Meta OAuth session path is dedicated to this service before each deploy.
4. Install dependencies with `npm install`.
5. Run `npm run typecheck` and `npm run audit:meta`.

## Freshsales Qualification Metric

Qualified leads use `contact_status_id = 402002304551` (`CC Qualified`). The secondary candidate field `cf_qualification_status = 1620` is documented in `config/mapping.json` but is not used for the metric unless the project brief is updated.

## Scheduling

Do not add an in-process scheduler. Configure GitHub Actions to invoke `npm run weekly-report` weekly. The script applies `CRON_JITTER_MINUTES` at runtime, defaulting to plus/minus 30 minutes.

## Storage

Create a Turso database for weekly snapshots:

```sh
brew tap libsql/sqld
brew trust --formula libsql/sqld/sqld
brew install tursodatabase/tap/turso
turso db create hexalog-weekly-report
turso db tokens create hexalog-weekly-report
```

Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as GitHub Actions repository secrets alongside `FRESHSALES_MCP_URL`, `FRESHSALES_MCP_TOKEN`, `META_MCP_OAUTH_SESSION_PATH`, and `GROQ_API_KEY`. Storage errors are allowed to fail the run so the report does not silently render without history.

## Publishing

One-time repository setup:

1. In repository settings, set Pages to deploy from branch `main` and folder `/docs`.
2. Create a Notion integration at `notion.so/my-integrations`, then add its secret as the `NOTION_API_KEY` GitHub Actions repository secret.
3. Create or choose the Notion page that will hold weekly reports, share it with the integration from the page's Connections menu, then copy its page ID from the URL into the `NOTION_PARENT_ID` GitHub Actions repository secret.

If `NOTION_PARENT_ID` points to a database instead of a page, set the GitHub Actions repository variable `NOTION_PARENT_TYPE=database`; otherwise it defaults to `page`.

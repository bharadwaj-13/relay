# Relay hosted backend

Canonical origin: `https://relay.tinkeringspaces.com`.

`api/index.mjs` is the Vercel entrypoint. `DATABASE_URL` connects to the
Supabase transaction pooler. Run `node --env-file=.env scripts/migrate.mjs`
once before deploying. The migration preserves existing state.

PostgreSQL stores the durable workspace in a private schema with RLS and
no grants to anonymous/authenticated Data API roles. A row lock serializes
each request's load/validate/save transaction across Vercel instances. The
domain engine's in-memory SQLite working copy is discarded after each request;
no production data depends on Vercel's filesystem. This compact architecture
is intended for hackathon/small-team workloads, not high-volume dispatch.

Responses are released only after PostgreSQL commits. Coordinator sessions,
member sessions, action retry receipts and rate limits persist in PostgreSQL.
SMS is queued before commit, then claimed durably before contacting Twilio.
An uncertain send is not retried automatically. Missing credentials are
reported as configuration_required, never delivery success.

Dashboards poll every five seconds while visible. Dispatch and offer expiry
are evaluated on API requests. There is no always-on background worker in
Vercel: unattended timed work needs a separately configured scheduler.
Pending SMS is drained on subsequent API requests if an invocation stops.

Required server secrets: DATABASE_URL, ADMIN_PASSWORD, TOOL_API_KEY,
WEBHOOK_SECRET. Set PUBLIC_BASE_URL and RESIDENT_PUBLIC_BASE_URL to the
canonical origin. Set VAANI_AGENT_ID to the existing Relay agent.
Do not put secrets in NEXT_PUBLIC variables, the public directory or GitHub.

Keep DEMO_MODE=true and SEED_DEMO_DATA=false for the current empty exercise
workspace. Public signup uses clearly marked exercise verification codes.
Real signup/location/task SMS needs Twilio credentials and appropriate consent.
Switching to live mode requires a separate empty workspace/database; never
reinterpret exercise records as live disaster reports.

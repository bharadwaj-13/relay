# Relay

## Portfolio sandbox

**[Try the interactive demo →](https://relay.tinkeringspaces.com/sandbox)**

No account or API key is needed. **Record a real voice message** in Chrome/Edge, review the transcript and suggested details, confirm the delivery address (optional GPS), then submit once. The coordinator can play the recording and read its transcript. Eligible food/water requests receive a demo volunteer offer; accept, open Google Maps for pickup/delivery, report handover, then confirm receipt as the resident. Medical/urgent requests stay in human review. Supplier stock edits require verification.

The workflow is isolated from Supabase/live accounts and uses its own illustrative matching model. Requests use the browser-local `relay_voice_sandbox_v2` localStorage key; recordings use the same-named IndexedDB database. Separate sandbox role tabs **in the same browser profile and origin** update via storage events. Other devices/browsers do not share data. Reset clears this sandbox's records/audio. Microphone and GPS are optional and need explicit browser permission. Browser speech recognition may send audio to the browser vendor's speech service and depends on browser/network support; when unavailable, the recording can be kept and the transcript entered manually. English detail suggestions are rule-based and editable, not LLM inference. Hindi/Arabic speech can be transcribed where supported, but the details must be selected manually. Maps links send the chosen destination to Google only when opened; they need no Maps API key. Demo pickup landmarks do not represent actual available supplies. There is no live Vaani call, SMS, production API mutation or safe-route/road-distance optimisation in this sandbox.

For the **current organisation-based live platform**, see [PRODUCTION.md](PRODUCTION.md). The older hackathon/local-exercise setup notes below are historical and do not describe the live account model.

A runnable voice-powered disaster relief coordination system, built for a Vaani voice-agent hackathon. Vaani hosts the agent; Relay supplies authenticated action endpoints, durable records, and the coordinator workspace.

## Run it now

Requires **Node.js 24 LTS**. Run `npm install` first. Vercel/Supabase hosting is documented in [DEPLOYMENT.md](DEPLOYMENT.md).

```sh
cd /Users/bunnyy/Documents/Codex/2026-10-31/hey-x20/outputs/relay
npm run dev
```

Open **http://127.0.0.1:3000**. With no `.env`, Relay starts an empty local-only exercise workspace and enables the call lab. Set `SEED_DEMO_DATA=true` explicitly to seed illustrative data. Local data persists in `data/relay-demo.sqlite`; the hosted Vercel adapter instead persists to Supabase. Authored call scenarios are simulations, not Vaani phone calls.

```sh
npm test
```

## What is implemented

- Responsive operations dashboard with live updates through authenticated server-sent events.
- Request intake, search, edits, review queue, caller corrections, optimistic edit checks, and duplicate candidates (never silent auto-merging).
- Volunteer registration, availability changes, and active-assignment blocker flags.
- Resource inventory with separate unverified supply offers and coordinator verification.
- Exact category/unit/stock matching with straight-line proximity when coordinates are known. No fabricated route safety or carrying capacity.
- Proposal → approval → pickup → reported delivery → verified receipt.
- Transactional inventory reservation at approval; release on cancellation; one active job per volunteer.
- Shelter capacity reports with sources/timestamps and coordinator editing.
- Attributed situation updates with expiry; expired updates excluded from the agent tool.
- Vaani REST adapter for real consented outbound callbacks, inbound/outbound call webhooks, and post-call transcripts/outcomes.
- Agent prompt, 16 tool schemas, cURL import-template exporter, and agent bootstrap script.
- Four interactive exercise calls: corrections, duplicate reports, volunteer intake, and urgent review.
- Coordinator login, separate agent/tool authentication, webhook authentication, rate limits, output escaping, request size limits, and a durable audit trail.
- Workspace JSON export and Docker packaging with persistent storage.

## Vaani deployment: add credentials later

The code is ready for configuration, but **no agent has been deployed to your Vaani account and no live call has been verified**. Account access, providers, number assignment, tool import, and publication are external setup steps.

### 1. Configure the backend

Copy `.env.example` to `.env` and fill:

| Variable | Purpose |
| --- | --- |
| `VAANI_API_KEY` | Your Vaani developer key; server-side only. |
| `VAANI_AGENT_ID` | Created by the bootstrap script, or an existing Vaani agent UUID. |
| `PUBLIC_BASE_URL` | Public HTTPS origin of this Node backend. Vaani must be able to reach it. |
| `ADMIN_PASSWORD` | Coordinator login password. Use a strong unique value. |
| `TOOL_API_KEY` | Random secret used by Vaani when calling Relay tools. Separate from the Vaani API key. |
| `WEBHOOK_SECRET` | Random secret for authenticating event deliveries. |
| `VAANI_WEBHOOK_AUTH` | `shared-token`, `secret-path`, or the explicitly documented local `hmac-sha256` adapter. See below. |
| `VAANI_OUTBOUND_NUMBER` | Optional configured caller ID; carrier/number setup must already exist. |
| `DEMO_MODE` | `true` for the exercise; `false` for an empty live workspace. |
| `DATABASE_PATH` | Optional explicit SQLite path. Leave blank for separate automatic demo/live databases. |
| `HOST`, `PORT` | Default `127.0.0.1`, `3000`. Public/container binding requires all three authentication secrets. |

You can generate secrets with `openssl rand -hex 32`. Never put any of these secret values in frontend code or commit `.env`.

Do not combine exercise and live data. If `DATABASE_PATH` points to a database initialized in the other mode, startup fails rather than relabeling it. SQLite needs a persistent disk/volume; do not deploy this as a static-only or ephemeral serverless site. One Node process owns the database.

### 2. Create the Vaani-hosted agent

```sh
npm run vaani:setup
```

This uses the documented `POST /api/create-agent` with `agent_display_name` and `config.persona.identity`, or `PATCH /api/agent/{id}/persona` when an ID already exists. It configures the prompt/greeting, saves newly created identity to ignored `vaani/generated/agent.json`, and prints the ID to add to `.env`. It does not publish through an invented endpoint.

If a creation response is uncertain, check Vaani’s console before rerunning so you do not create duplicate agents. Restart Relay after changing `.env`.

In [Vaani’s console](https://platform.vaani.dev/), review the agent’s speech, model, voice providers, and supported languages. Use interruption handling and short responses. Provider billing/keys are configured in Vaani as required by your account; Relay does not replace Vaani’s speech stack.

### 3. Connect the tools

```sh
npm run vaani:tools
```

This generates 16 `*.curl.txt` templates plus `tool-schemas.json` in ignored `vaani/generated/`. The exported files contain **no actual secrets**. For each tool:

1. Open **Agent → Training → Tools** in Vaani.
2. Import the cURL template, replace `REPLACE_WITH_TOOL_API_KEY` with the actual secret in Vaani’s secure tool-header field, and configure dynamic fields from its schema.
3. Copy the tool description and full parameter schema. Template body values are examples, not literal runtime bindings.
4. Retain the exact tool names and make each tool available to this agent.

Tools: `create_request`, `find_requests`, `update_request`, `register_volunteer`, `offer_supplies`, `report_availability`, `find_matches`, `propose_assignment`, `get_advisories`, `report_assignment`.

The public persona API describes `actions` as provider-specific without a complete portable tool-registration contract. Therefore tool attachment is deliberately done through Vaani’s documented cURL importer rather than guessing the `actions.functions` schema.

The prompt is in `vaani/agent-prompt.md` and is also downloadable in the UI. Consequential writes require caller readback/confirmation. `action_id` is mandatory for mutation tools: the same confirmed action uses the same ID and identical payload on retry. Changed actions use a new ID. Agent tools cannot verify reports, approve assignments, publish advisories, or close deliveries.

### 4. Configure webhooks

Vaani’s webhook guide documents events and payloads but does not specify a complete signing/header contract. Choose a Relay-supported authentication method your Vaani account can deliver:

- **Shared header (preferred when supported):** `VAANI_WEBHOOK_AUTH=shared-token`; URL `${PUBLIC_BASE_URL}/api/webhooks/vaani`; configure `Authorization: Bearer <WEBHOOK_SECRET>` in Vaani.
- **URL-only configuration:** `VAANI_WEBHOOK_AUTH=secret-path`; URL `${PUBLIC_BASE_URL}/api/webhooks/vaani/<WEBHOOK_SECRET>`. Treat the full URL as a credential and exclude it from reverse-proxy access logs.
- **HMAC adapter:** only if your sender explicitly supports this contract. `VAANI_WEBHOOK_AUTH=hmac-sha256`; the configured signature header must contain the hexadecimal HMAC-SHA256 of the **exact raw request bytes**, optionally prefixed with `sha256=`. This is Relay’s supported contract, not an assertion about Vaani’s default signing behavior.

Subscribe to `call_started`, `call_ringing`, `user_picked_up_at`, terminal failure events, `call_ended`, and `call_postprocessing`. Human-transfer events are also recognized. The adapter reads nested `data` on postprocessing, interprets `call_ended.call_duration` as seconds and postprocessing duration as milliseconds, and deduplicates identical deliveries. Late start/ringing events cannot reopen a completed call. Tool writes update the dashboard during a call; final transcripts arrive asynchronously afterward.

### 5. Publish and connect telephony

In Vaani **Deploy → Telephony**, assign a number with inbound routing, or connect the supported carrier/SIP account. Publish the configured agent in Vaani’s console. A normal purchased number does not gain official emergency-number privileges.

The Voice center can dispatch a real outbound callback after the operator confirms consent. The server sends the reference API’s `contact_number`, `name`, `agent_id`, and `medium: telephony` fields. It never treats dispatch acceptance as a successful conversation and never automatically retries an uncertain dispatch.

The UI’s **Launch voice widget** button loads the script documented by Vaani’s deployment guide with your agent ID. The widget/CDN, account permissions, browser microphone access, and published agent must all work. This external widget was not live-tested without credentials. If your account’s widget contract differs, use its provided embed snippet or the phone number; keep the voice runtime on Vaani.

### 6. Smoke-test the real integration

1. Call the Vaani number and record one confirmed request.
2. Confirm the record arrives before the call ends, through a tool call.
3. Interrupt the agent and correct the group size; verify the correction.
4. Review the request, propose a match, and approve it from the dashboard.
5. Report a blocker; cancel and verify stock returns.
6. Complete another assignment, report delivery, then confirm receipt as coordinator.
7. Verify webhook call history and the final transcript.
8. Retry a mutation with the same action ID; confirm no duplicate record or stock change.

## Hackathon demonstration

Choose **Open Innovation**. Pitch: “Relay connects people who need help with people who can deliver it—and tracks whether that help arrived.”

The local call lab is a rehearsal tool, not evidence of live agent performance. For judging, use the published Vaani agent and allow the judge to choose an unseen location, revise quantities, ask for unavailable supplies, or report a possible duplicate. The backend enforces the constraints even if the language model makes a mistake.

Suggested demo:

1. Open **Call lab → A request becomes action** and advance all five turns.
2. Open the saved Palm Court request: it correctly represents eight people and 36 litres.
3. Mark the facts reviewed, find a match, propose it, approve it, and observe stock reservation.
4. Mark pickup, report delivery, then enter accountable receipt confirmation.
5. Explore **Two calls. One location.** to show duplicate review without automatic merging.

## Architecture and operating limits

The application uses native Node HTTP, SQLite, and browser ES modules. No frontend framework, npm installation, external map service, or paid dependency is needed. The map is schematic/illustrative, not a street map or navigation tool; it positions confirmed coordinates and omits unlocated reports. The seeded area and geography are fictional even though the exercise is labeled Bengaluru. The resource matcher does not verify safe access, eligibility, carrying capacity, or field conditions. Shelter counts are reports, not reservations.

This is a working hackathon coordination system, **not a certified emergency dispatch service or a complete operational disaster-response program**. Real use needs an accountable operating organization, verified official information, consent/data-retention processes, incident-specific protocols, and field communication procedures. Immediate danger is flagged to humans; no medical or evacuation instructions are generated by the backend.

A request’s group count may overlap another unreviewed report; overview “people represented” is a sum of reports, not a verified count of unique people. Approval reserves stock in the system but does not prove a volunteer physically accepted the assignment; human operators must coordinate handoff. Availability changes flag the request rather than silently reassigning it. A cancelled delivery releases system stock, and operators must verify physical stock before promising it again.

Coordinator authentication is a single shared workspace login with 12-hour in-memory sessions. Restarting the server invalidates sessions. It is not an enterprise identity/RBAC system. Contact details and transcripts are private workspace data. Keep exports controlled, back up the database, and define retention before collecting live personal information. The event connection is an authenticated workspace feed, not a public resident portal.

## Hosting

### Automatic dispatch and volunteer tasks

The **Auto-dispatch** navigation item adds an optional automatic workflow alongside manual coordination. It defaults to off in a new workspace. No OpenAI API key is needed: eligibility, carrying limits, stock reservation, expiry, and acceptance are deterministic backend rules. Vaani still hosts the conversational agent.

1. Volunteers join and sign in at `/volunteer/`, confirm their coordinates, and opt in with separate water (litres) and food (meals) carrying limits, trip radius, and notification channel. They never choose a pickup source. Set a category capacity to zero to exclude it.
2. Enable dispatch. By default only coordinator-verified requests qualify. Optionally enable caller-confirmed reports: then a Vaani `create_request` with `caller_confirmed: true` can qualify without a coordinator approving that individual request. This flag means an explicit caller readback, not independent verification.
3. A qualifying request must be food/water, non-urgent, non-duplicate, have confirmed coordinates, and have sufficient verified stock plus an available enrolled volunteer within the configured straight-line pickup-plus-delivery radius. The matcher evaluates every feasible volunteer → supplier → resident combination across waiting requests, then greedily assigns the shortest total trip first. Request age is a tie-breaker. This is deterministic proximity optimization, not a globally optimal fleet plan or a road-routing/safety guarantee. Locations are the saved confirmed points, not live vehicle tracking.
4. An automatic **offer** reserves stock and marks the volunteer reserved; it does not claim they accepted or are travelling. The notification appears immediately in the authenticated dashboard inbox.
5. The volunteer opens a task-specific private link on their phone, accepts or declines, opens pickup/delivery directions in Google Maps, marks pickup, and reports delivery. The coordinator dashboard updates immediately through SSE. This does not provide GPS tracking or establish route safety.
6. Declined and expired *unaccepted* offers release stock and try the next eligible volunteer automatically. A volunteer is not repeatedly offered the same request. Once all candidates have been tried the request remains unassigned for coordinator attention. Cancelling an already accepted or physically collected delivery remains a reviewed operation; the system does not assume those physical goods can safely be reassigned.
7. Volunteer-reported delivery remains `awaiting_confirmation`. Independent receipt confirmation is still distinct from the volunteer’s own report.

Medical, urgent, ambiguous-location and possible-duplicate reports stay outside automatic dispatch. All verified sources are considered, subject to category, exact units, stock, capacity, coordinates and radius. A task is not split across several pickups. Legacy source-linked enrollments retain their category/unit capacity but are no longer pinned to that depot. Stock is rechecked while allocating candidates so competing offers cannot over-reserve it. At most one active job is offered to a volunteer. Removing enrollment stops future offers but does not cancel an existing obligation.

#### Notifications

- **In-app:** a dashboard inbox entry and secure private task link. This is not a browser push notification or an outbound phone message. A coordinator can open the task page for the exercise; distribute links privately in an operational setup.
- **SMS:** add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and a public HTTPS `PUBLIC_BASE_URL`; select SMS when enrolling the consenting volunteer. The worker sends an SMS with the private task link using Twilio’s Messages API. Sender permissions/trial-recipient restrictions are configured in Twilio.
- Missing credentials produce `configuration_required`, not a fake “sent” status. Adding credentials and restarting lets still-active unsent offers be submitted. A provider acceptance is labeled `submitted`, not handset delivery.
- A failed/uncertain send is not retried automatically, avoiding duplicate SMS after a timeout. A process interruption after submission may leave `sending`; inspect Twilio before taking manual follow-up action. Message delivery callbacks are not implemented.
- Task tokens are 256-bit bearer capabilities stored server-side. They are redacted from general workspace snapshots and exports. The token is in the page URL fragment and sent to the task API in an Authorization header. It grants only that task’s logistics/actions and does not reveal caller phone numbers or private notes. The coordinator-only link endpoint can retrieve it. Possession of the link is authorization; it is not a verified personal identity, so share it privately.
- The worker evaluates every five seconds and immediately after normal backend mutations. It must run as part of the persistent Node server; it is not a Vaani scheduled campaign or a separately deployed AI worker.

Twilio API reference: https://www.twilio.com/docs/messaging/api/message-resource

### Server deployment

Run on a Node-capable server behind HTTPS with persistent disk, or use the included Dockerfile and Compose configuration. With Compose, fill all authentication secrets and `PUBLIC_BASE_URL`, then run:

```sh
docker compose up --build -d
```

The application binds publicly inside the container but maps only to host loopback. Put an HTTPS reverse proxy in front of it. Preserve SSE streaming for `/api/events`; do not buffer it. Configure proxy logs to omit credential-bearing webhook paths if using secret-path authentication. Back up the `relay-data` volume. Secrets are excluded from the image.

## Resident phone menu and community onboarding

Residents need no dashboard or account. The updated Vaani prompt accepts natural speech and a short spoken menu: **1** request help, **2** track, **3** correct/cancel, **4** volunteer/supply, **5** confirm receipt, **9** request a coordinator callback. Returning callers are recognized by phone number, using authenticated call-event metadata when available, or a caller-confirmed number otherwise. The agent asks for the original name before status lookup, handles multiple matching requests by reference/category, and never fabricates an arrival time. Number recognition is not strong identity verification; status responses exclude private addresses, notes and volunteer contacts. Configure stronger verification before using this for sensitive cases or shared-phone households.

The tools implement cancellation of an unassigned request, explicit resident receipt confirmation after a reported delivery, and a deduplicated callback queue in the Voice center. Active delivery changes/cancellation need coordinator review. A callback queue entry does not place a call automatically or contact emergency services.

Physical **keypad/DTMF support is not verified** in the Vaani account. Saying “one” or “track my request” works through the prompt; actual button presses require the telephony provider to forward digits. Do not advertise a working keypad IVR until tested on the deployed phone number. Re-export the **16** tool definitions with `npm run vaani:tools`, attach them in Vaani, and update the deployed persona; editing this repository does not update an already-published agent.

Separate entry points: `/volunteer/sign-up` and `/volunteer/sign-in` for community accounts; `/coordinator/sign-in` for the coordinator workspace. Dashboards live at `/volunteer/` and `/coordinator/`. The legacy `/join.html` still opens the community portal; `/` redirects to `/coordinator/`. Neither dashboard links to or opens the other portal. Coordinator task-impersonation links and the source-picker enrollment form have been removed.

Anyone can sign up as volunteer, supplier, or both, verify their phone, and sign in. No coordinator creates their account. Passwords are scrypt-hashed; member sessions use expiring HttpOnly, SameSite cookies and cannot authorize coordinator APIs. Coordinator sessions likewise cannot authorize member APIs. Coordinator access is sign-in-only with the configured `ADMIN_PASSWORD`, not public signup. Local loopback exercise mode without that variable uses the explicitly displayed test password `relay-demo-coordinator`; public/live startup still requires explicit secrets. Exercise mode displays a clearly labeled test member verification code. Live verification needs Twilio credentials and never exposes that code to the browser. Expired verification and account recovery currently require coordinator assistance; self-service recovery/resend and role changes are not implemented.

Volunteers save their location, carrying limits, trip radius and notification channel, then explicitly opt in. Eligible offers appear live under **Your assigned routes**, showing the system-selected pickup, drop-off, quantity and estimated trip proximity. The public member API does not expose a supplier catalog or allow pickup selection. Volunteers accept before travelling, open Google Maps directions for pickup and delivery, confirm pickup, and report handover. Residents can confirm actual receipt by phone. Automatic dispatch still defaults off, and urgent/medical, uncertain, duplicate or unlocated cases remain for human review. One universal signup handles supplier-only and combined accounts. Public supply offers enter inventory as **reported**, not verified; a coordinator checks stock before matching. This is verification of the supplies, not account onboarding.

### Location capture and landmarks

An ordinary phone call does **not** expose GPS. After saving a resident request, the agent can ask permission to text a private, single-use, 30-minute `/location.html#token` link. Residents need no account: tap capture, grant browser permission, confirm the suggested/manual landmark or entrance, and save. They can instead type a landmark or tell the voice agent if GPS, SMS or data is unavailable. Location links are not included in coordinator snapshots. Browser GPS requires HTTPS (localhost works for development); no background tracking is performed. Coordinates with accuracy worse than 150 metres require review and are excluded from automatic dispatch.

Volunteers and suppliers have the same explicit capture button in their profile. Optional `GOOGLE_MAPS_API_KEY` enables server-side reverse geocoding; without it GPS still works but the landmark is entered manually. The suggestion must be confirmed, not treated as guaranteed accurate. Google Maps navigation opens only when the volunteer chooses it; directions do not establish safe disaster access. The admin map remains illustrative.

Preserve streaming for both `/api/events` and `/api/members/events` behind your HTTPS proxy. Set Twilio credentials for live signup/location SMS, `GOOGLE_MAPS_API_KEY` if desired, and `PUBLIC_BASE_URL` to the deployed HTTPS origin. Vaani agent publication, number routing, real SMS, device GPS and external geocoding still require live-environment verification.

## Vaani reference pages used

- https://docs.vaani.dev/api-reference/create-agent
- https://docs.vaani.dev/api-reference/update-persona
- https://docs.vaani.dev/api-reference/trigger-call
- https://docs.vaani.dev/guides/webhook-setup
- https://docs.vaani.dev/getting-started/agent-config/training
- https://docs.vaani.dev/getting-started/agent-config/deploy
- https://docs.vaani.dev/getting-started/agent-config/experience

The deployment guide and reference have differing call field/event examples. This implementation follows the dedicated trigger-call reference (`contact_number`) and webhook guide (underscore-separated lifecycle events). Live account verification remains necessary.

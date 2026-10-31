# Verification

Verified locally on October 31, 2026 with Node.js 26.5.0. **47 tests pass**, including the automatic-dispatch, resident phone-flow, and community account extensions. Browser QA verified public signup, demo phone verification, sign-in, manual landmark profile saving, publishing a supply offer as reported, and saving a resident landmark through a private no-account location link. Earlier browser QA verified offer acceptance, pickup, delivery reporting and coordinator-board updates. No actual SMS or device GPS permission was requested during browser QA.

- `npm test`: **47 tests passed**. Domain tests cover inventory reservation/release, competing approvals, caller corrections, duplicate reports, coordinator-only actions, exact units, stale edits, idempotency conflicts, supply verification, advisory expiry, shelter validation, simulation sequencing, and webhook lifecycle order. New tests cover self-service accounts, hashed passwords, verification attempt limits, no live development-code leakage, member/admin separation, logout revocation, repeat caller status lookup, non-Latin names, consented one-use location links, inaccurate GPS review, resident cancellation/callbacks, and explicit phone receipt confirmation. HTTP tests also cover CSRF, tool/webhook authentication, live/demo boundaries, and a local mock outbound provider.
- `node --check public/app.js`, `node --check server.mjs`, and `node --check scripts/export-tools.mjs`: passed.
- Tool exporter: generates 16 schemas and cURL templates using an example HTTPS origin; generated outputs contain no secrets.
- Browser QA: loaded the dashboard, advanced all five water-request exercise turns, verified the corrected group count of eight, reviewed the request, found a resource match, proposed and approved it, marked pickup, reported delivery, and entered explicit receipt confirmation. The request reached `delivered`, the audit timeline retained each step, and the data survived a server restart.
- Desktop and narrower-panel layouts were visually inspected. The map is explicitly illustrative.
- Preview screenshot: `../relay-preview.png`.
- Community portal screenshot: `../relay-community.png`.

## Not verified without your environment

- Vaani account authentication, agent creation/publication, actual speech quality, interruptions, multilingual behavior, carrier routing, number assignment, or live inbound/outbound calls.
- Vaani custom-tool attachment and event authentication in your account. Public docs leave tool action shape and webhook signing details account/provider-specific; setup uses documented creation/persona endpoints and generated console-import tools.
- The external Vaani voice widget and any microphone/voice-provider permissions.
- Public HTTPS hosting, Docker deployment, production load, telecom outages, or real field operations.
- Physical DTMF/keypad routing, real signup/location SMS delivery, device GPS permissions, and Google reverse geocoding. Spoken numeric menu and backend tool flows are implemented; live telephony performance is not proven by local tests.

The authored call lab is a labeled exercise. It is not a test of unseen live voice performance and does not impersonate a Vaani connection.

## Portal separation and nearest-trip update

- 47 tests passing, including seven proximity-optimization tests and a separate coordinator-login HTTP test.
- Tests verify all-source matching, shortest complete trip versus closest pickup, nearby drop-off selection across queued requests, exact units and sufficient verified stock, independent food/water capacity limits, legacy enrollment migration, inaccurate pickup exclusion, single active task per volunteer and no stock over-reservation.
- Volunteer requests cannot pin a pickup source. Coordinator and member sessions cannot authorize the other role's APIs; even local demo coordinator access requires sign-in.
- Browser QA verified no coordinator link in the signed-in volunteer portal, no volunteer signup/task link in the coordinator dashboard, independent coordinator sign-in, and system-selected pickup/drop-off cards.
- An isolated in-memory localhost:3001 fixture verified a complete automatically assigned route, private task review, acceptance and correct Google Maps links for both legs. It did not touch the main exercise database, send messages, request device location, or open external Maps.
- Screenshots: `../relay-nearest-route.png` and `../relay-coordinator-signin.png`.


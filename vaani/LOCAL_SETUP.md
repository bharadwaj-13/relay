# Local Vaani exercise setup

## Saved in Vaani

- Account Chrome profile: tinkering.spaces@gmail.com.
- Agent: **Relay — Relief Coordination (Exercise)**.
- Agent ID: `117469a3-5d4c-45cf-8cc7-8845b85c78e9`.
- Persona: https://platform.vaani.dev/design/agents/117469a3-5d4c-45cf-8cc7-8845b85c78e9/persona
- Exercise-only greeting and persona saved; greeting interruption enabled.
- Custom tool **Relay Operations** (`relay_operations`) created, enabled on the agent, and saved. It sends `operation` and `arguments_json` to the gateway. The operation name selects one of the existing 16 validated tools; it does not expose coordinator mutations.
- The existing survey agent was left untouched. No phone-number assignment or purchasing was performed by this setup.

## Local services

- App: http://127.0.0.1:3000
- Restricted proxy: http://127.0.0.1:3002
- Temporary tunnel: https://air-governance-restoration-shift.trycloudflare.com
- Tool gateway: `POST /api/voice/action` with the separate tool bearer credential.
- Webhook path supported by the proxy: `POST /api/webhooks/vaani`, authenticated using the configured webhook contract. Provider webhook registration is **not yet configured**.

The ignored, permission-restricted `.env` holds the agent ID and independent tool/webhook secrets. It contains no Vaani developer API key, Twilio credentials or Google Maps key. Those remain for the user to configure. The app stays in exercise mode. The coordinator retains the loopback-only demo password until explicitly configured otherwise.

The proxy rejects dashboard HTML, account APIs, coordinator state/exports, volunteer task links and unknown tool paths. It does not forward browser cookies. The tunnel URL is temporary and must be updated in Vaani if the tunnel restarts with another hostname. Never point a public tunnel directly at app port 3000.

The restricted tunnel intentionally does NOT make signup, location-sharing or volunteer-task web pages public. Real SMS and externally usable resident links are therefore not part of this local exercise. No automatic phone routing, emergency dispatch or rescue promise is enabled.

## Commands

From the Relay folder, keep the app and proxy running in separate terminals:

```sh
npm run dev
node --env-file=.env scripts/voice-proxy.mjs
```

From the task workspace, the downloaded official client can restart a tunnel:

```sh
./work/cloudflared-client/cloudflared tunnel --url http://127.0.0.1:3002 --no-autoupdate --protocol http2
```

Stop the cloudflared process to end external access. Do not commit `.env`, runtime databases or downloaded client binaries. No GitHub or Vercel deployment has been made.

## Verified

- 50 automated tests passing, including proxy access restrictions and gateway operation validation/idempotency.
- Public health endpoint returned 200.
- Public coordinator, volunteer and coordinator-state paths returned 404.
- Authenticated gateway request returned the six-choice phone menu.
- Vaani text test connected to room `room-41b1a186`; an exercise intake message was submitted, but no agent reply or saved request was verified before the page changed. Do not describe this as successful end-to-end live agent integration.

## Requires attention before more paid testing

Vaani displayed **KYC Blocked: Calling has been blocked because the KYC verification grace period has expired**. Account identity verification must be completed by the user. Do not bypass it.

The displayed balance changed from INR 997.80 to INR 397.80 while setup/testing and concurrent user interactions were taking place. The cause has not been established. Paid tests are paused pending billing/history review and user clarification. Approval for the text exercise was limited to INR 20 of existing credits; no recharge or purchase was authorized or performed by the setup.

## Remaining setup

1. Clarify the balance change and verify that the test room is closed before any further paid test.
2. Complete the platform's KYC requirements if phone calling is needed.
3. Register authenticated call-event webhooks in Vaani and verify actual event payloads.
4. Verify a Vaani tool call reaches the local gateway, then confirm a saved request in the dashboard and track it through the agent.
5. Configure and test providers, voice behavior and telephony routing explicitly; no inbound number has yet been connected to Relay.
6. Before running `npm run vaani:setup`, preserve the gateway-mapping instructions from the current platform persona. The generic bootstrap prompt targets individual tool names and would otherwise overwrite the gateway-specific deployment mapping.

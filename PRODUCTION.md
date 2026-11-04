# Relay: organisation workspaces

## Portfolio sandbox — isolated from this platform

`/sandbox` is a public, browser-only simulation. Its sample state is not an organisation in Supabase and does not use the private exercise archive. It runs a separate illustrative matching model, not the server domain engine. Role switching is for demonstration only and never changes real account permissions. Scripted call replay is not a live Vaani call. It makes no API calls and needs no provider credentials, payments, microphone or GPS. Server handling bypasses database initialization and the page blocks connections through CSP. Reset affects only the demo's tab-scoped session storage key. Deep links support `?role=resident`, `?role=volunteer`, `?role=supplier`, or `?role=coordinator`.

## Getting started

Open https://relay.tinkeringspaces.com/workspace, create a personal account, then create an organisation. Its creator is owner of only that workspace. A name is not a government/NGO identity certification. Accounts using password sign-in have unverified emails; do not treat that as proof of organisational authority.

The owner shares the separate volunteer and supplier signup links. Community accounts require coordinator approval after an independent contact/suitability check. SMS verification, when connected, does not replace that approval. Owners can approve or suspend coordinator applicants through **Manage coordinator access**. Suspension is checked on every authenticated request. There is no shared workspace-password login in organisation mode.

Use one organisation per response team. Owners can keep an organisation unlisted and share its workspace code privately. Public listings expose only the voluntarily listed organisation name, area and code, not its requests or members. Each organisation has a separate state snapshot, memberships, member accounts/sessions, idempotency records, location links and voice credentials. The PostgreSQL transaction serializes registry and workspace writes; this is a small-team deployment, not a high-scale emergency dispatch backend.

## Daily operation

- Volunteer: availability and current task first; accept, navigate to pickup, confirm pickup, navigate to delivery, report handover. Resident receipt is separate. Location/capacity preferences are folded below tasks.
- Supplier: inventory and stock updates first, then add supplies; pickup settings below. Changes return stock to reported/unverified. Reserved stock cannot be edited by a supplier.
- Coordinator: review community applications, verify stock and requests, resolve urgent/medical/duplicate reports, and manage dispatch policy. Automatic matching starts disabled in a new organisation. It never overrides urgent review or acceptance requirements.

## Maps and location

Browser GPS requires HTTPS (localhost is also supported) and explicit user permission. The caller/resident confirms the intended point. GPS works without a Maps API key; Google Maps URLs open directions using saved coordinates, or search a reported landmark when coordinates are absent. Opening a Maps link shares the chosen point with Google. Directions do not establish a safe disaster route. Distances in matching are straight-line estimates, not road times.

If a pickup point is somewhere other than the current device, manually enter its exact latitude and longitude from Maps and confirm it. Do not guess. Automatic geocoding/reverse-geocoding remains optional and needs a restricted server-side GOOGLE_MAPS_API_KEY and provider billing configuration. Spoken landmarks without verified coordinates are saved but do not qualify for automatic dispatch.

## Google sign-in — integration prepared, provider setup required

Password accounts work without a new Google account integration. Google sign-in remains disabled unless all of the following are completed:

1. Configure Google OAuth Client ID and Secret in Supabase Authentication → Sign In / Providers → Google. Google callback: https://lhcshwvwnqczihpzvscc.supabase.co/auth/v1/callback.
2. Allow https://relay.tinkeringspaces.com/auth.html as a Supabase Auth redirect URL (its nonce query string must be accepted by the configured allowlist, e.g. the scoped /auth.html** URL rule).
3. Set SUPABASE_URL, SUPABASE_ANON_KEY (publishable/anon key, **not** service-role key), and GOOGLE_AUTH_ENABLED=true on Vercel, then redeploy.
4. Test the callback and logout on the production domain. The backend validates the token with Supabase, checks a confirmed Google identity, and binds the callback to the initiating browser nonce. It does not silently link a password account with a matching email.

Google Cloud OAuth configuration and client credentials were not supplied for this release. Do not claim Google sign-in or email verification works until tested. Automated password recovery, MFA, abuse/CAPTCHA protection and formal organisation verification are not yet implemented; complete those before broad public rollout.

## Voice and SMS — organisation-specific setup

The owner opens **Voice integration setup** in /workspace to obtain the organisation-specific Vaani tool endpoint and bearer token, and webhook endpoint/token. Configure an agent and inbound number with these values. The old shared exercise agent/number is not automatically assigned to a new organisation. Calls without an organisation context are rejected; do not silently direct callers into an arbitrary team.

Use vaani/agent-prompt.md for concise intake: reuse details, ask one combined question for missing essentials, confirm once, save once. Target 2–3 exchanges where safe. A normal phone call cannot expose GPS. No real calls were made by the deployment checks.

TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are required for actual SMS. Without them, signups use coordinator approval and no SMS delivery is promised. Resident GPS links require consent and expire after 30 minutes. In-app offers work without SMS. Serverless dispatch expiry and matching run on API activity, with foreground dashboards polling; there is no always-on background scheduler. Add a secured scheduled worker before relying on unattended reassignment.

## Exercise cleanup and recovery

scripts/archive-exercise.mjs defaults to a read-only dry run. --apply archives the old exercise snapshot into the RLS-protected relay_private.workspace_archive table and clears the active legacy records, sessions, action receipts, fake landmarks and Sam-only routing. New platform accounts/organisations created during cutover are preserved. The script refuses to reset a live workspace again. Archives are accessible only through privileged database credentials, never a public API. Keep a retention policy and remove the archive once recovery is no longer needed.

This deployment supports human-supervised community coordination. It is not certified for life-critical emergency dispatch, does not promise communications during network outages, and must not be the sole route to emergency services.

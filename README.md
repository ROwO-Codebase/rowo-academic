# ROwO Academic

ROwO Academic is a program-progress and course-planning companion for students.
It uses ROwO accounts for sign-in and University of Waterloo academic-calendar
data to help students:

- track progress through one or more programs;
- validate completed and planned courses against program requirements; and
- plan future terms while seeing which requirements each course can satisfy.

The production Worker is deployed at <https://academic.rowo.link>.

## Architecture

- [vinext](https://github.com/cloudflare/vinext), Vite, React, and TypeScript
  run as a Cloudflare Worker.
- `DB` is the app-owned D1 binding. It stores user programs, course history,
  future-term plans, catalog snapshots, and opaque ROwO Academic sessions.
- `ACADEMIC_DB` is the query-only academic-calendar binding. It currently points
  to `uwaterloo-academic-calendar-2026`.
- `.openai/hosting.json` keeps the Sites-managed logical app database binding;
  `wrangler.jsonc` supplies direct Cloudflare staging and production bindings.

The two databases are deliberately separate. Application code and migrations
must never write to or migrate `ACADEMIC_DB`.

## Local development

Prerequisites:

- Node.js `>=22.13.0`
- npm
- a Cloudflare login that can read the configured academic-calendar D1

```bash
npm ci
cp .env.example .env.local
npx wrangler login
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm run dev
```

Wrangler/Miniflare persists the app-owned `DB` locally under the ignored
`.wrangler/` directory. The checked-in development configuration marks only
`ACADEMIC_DB` as `remote: true`, so catalog searches use the real query-only
calendar while local student data remains local. The application contains no
write path for the academic binding.

## Validation

```bash
npx tsc --noEmit
npm run cf:types:check
npm run lint
npm test
```

`npm test` performs the production vinext build before running the repository
tests. GitHub Actions runs this same verification and intentionally does not
deploy.

## ROwO sign-in contract

The sign-in flow adapts ROwO's first-party `/sso` fragment handoff:

1. ROwO returns its existing session JWT in the callback URL fragment.
2. The callback removes the fragment from browser history immediately and posts
   the token once to the Academic Worker.
3. The Worker validates it through the `ROWO_AUTH` service binding to the
   production `rowo-auth` Worker (with `https://api.rowo.link/api/user/me` as
   the local-development fallback), discards it, and creates an opaque,
   HttpOnly Academic session whose token is stored only as a hash in `DB`.

This flow uses `ROWO_WEB_ORIGIN` and `ROWO_API_ORIGIN`. It does not require an
OAuth client ID, client secret, or session-signing secret. Before sign-in can
work, the parent ROwO site must explicitly allow
`https://academic.rowo.link` and the exact localhost development origin in its
`SsoPage.tsx` allowlist, then be redeployed. A ready-to-apply change is included
at [`docs/rowo-auth-academic-sso.patch`](docs/rowo-auth-academic-sso.patch).
Browser code does not call the ROwO API directly, so this integration does not
require a CORS change.

## Environments and calendar rollover

`wrangler.jsonc` defines local, staging, and production configurations. D1
bindings and runtime variables are repeated intentionally because Wrangler does
not inherit them into named environments. The committed staging and production
IDs point to the separately provisioned `rowo-academic-users-staging` and
`rowo-academic-users-production` databases.

`ACADEMIC_CALENDAR_LABEL`, `ACADEMIC_CATALOG_ID`, and the `ACADEMIC_DB`
database name/ID form the changeable calendar configuration. For a new academic
year, update all four values together in a reviewed PR, validate against
staging, and then promote to production. No application-data migration should
target the calendar database. Saved student rows keep catalog/PID/version
snapshots; a mismatch is surfaced for reconfirmation instead of silently
re-auditing an old plan under new rules.

## Deployment

After the one-time bootstrap, Cloudflare Workers Builds is the intended ongoing
CD path. GitHub Actions remains CI-only. Protecting `main` and requiring the CI
check will ensure tests pass before Cloudflare sees a production commit. D1
migrations run against the app-owned database by its explicit database name
before the Worker deploy step. The first production Worker version and its
app-owned D1 schema were bootstrapped with Wrangler.

See [docs/cloudflare-setup.md](docs/cloudflare-setup.md) for D1 provisioning,
least-privilege tokens, GitHub integration, Workers Builds commands, custom
domain setup, the parent-site SSO prerequisite, and the annual calendar
rollover checklist.

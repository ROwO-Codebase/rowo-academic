# Cloudflare and GitHub setup

This document covers the account-level work that cannot be completed from the
repository alone. The intended topology is GitHub Actions for CI and Cloudflare
Workers Builds for CD. Do not configure a second GitHub Actions deployment.

## 1. Confirm prerequisites

- The Cloudflare account must own the active `rowo.link` zone.
- The academic-calendar D1 database must be in the same Cloudflare account as
  the Worker. D1 bindings cannot cross account boundaries.
- The GitHub repository must contain this project and the Cloudflare GitHub App
  must be authorized for this repository.
- The production Worker owns the committed `academic.rowo.link` custom-domain
  route; verify HTTPS certificate issuance from an external client.

The reference database committed in `wrangler.jsonc` is:

| Binding | Database | ID | Access contract |
| --- | --- | --- | --- |
| `ACADEMIC_DB` | `uwaterloo-academic-calendar-2026` | `578d593a-d00d-4723-b3de-0659e2388415` | Query-only |

## 2. Provisioned app-owned databases

Distinct D1 databases for staging and production have been provisioned. The
committed bindings are:

| Environment | Database | ID |
| --- | --- | --- |
| Staging | `rowo-academic-users-staging` | `98b4a8fa-ae90-46a5-8d37-8e49e6bfe4c2` |
| Production | `rowo-academic-users-production` | `b487e3d4-8efa-4e95-839b-5157ab0382d0` |

The original creation commands are retained only as a recovery reference; do
not rerun them for the existing environments:

```bash
npx wrangler d1 create rowo-academic-users-staging
npx wrangler d1 create rowo-academic-users-production
```

Do not substitute the academic database ID for either application database ID.
`DB` is the only binding that receives application migrations.

The initial migration has been applied successfully to both databases. Apply
future migrations explicitly by database name and with `--remote`:

```bash
npx wrangler d1 migrations apply rowo-academic-users-staging --remote --env staging --config wrangler.jsonc
npx wrangler d1 migrations apply rowo-academic-users-production --remote --env production --config wrangler.jsonc
```

Using the database name reduces the chance of accidentally targeting
`ACADEMIC_DB`. Wrangler skips confirmation in CI, records applied migrations,
and stops the deploy command when a migration fails.

## 3. Register the ROwO SSO origin

ROwO Academic uses the existing first-party `/sso` fragment handoff, not the
third-party OAuth client flow. Before enabling production sign-in, apply
[`rowo-auth-academic-sso.patch`](rowo-auth-academic-sso.patch):

1. In the parent `rowo-auth` repository, add these exact origins to
   `apps/main/src/pages/SsoPage.tsx`'s destination allowlist:
   - `https://academic.rowo.link`
   - `http://localhost:3000` (or the exact localhost origin actually used;
     never add a wildcard)
2. Redeploy the parent ROwO main site.
3. Verify the callback scrubs the fragment immediately, posts the upstream JWT
   once to the Academic Worker, and never persists that JWT.

The Worker validates the token server-to-server through
`https://api.rowo.link/api/user/me`, discards it, and issues a host-only opaque
session in an HttpOnly cookie. Only a hash of that session token belongs in
`DB`. Because the browser does not call the API directly, no API CORS change is
required.

## 4. Runtime configuration

The non-secret runtime values are versioned in `wrangler.jsonc` for every
environment:

| Variable | Value |
| --- | --- |
| `ROWO_WEB_ORIGIN` | `https://rowo.link` |
| `ROWO_API_ORIGIN` | `https://api.rowo.link` |
| `ACADEMIC_CATALOG_ID` | `663290e835aff7001cc62323` |
| `ACADEMIC_CALENDAR_LABEL` | `2026` |
| `APP_ENV` | Environment-specific |

There is no ROwO OAuth client secret and no session-signing secret in this SSO
design. The Cloudflare build token is a deployment credential, not a Worker
runtime variable. If a future feature introduces runtime secrets, add them in
Worker Settings > Variables & Secrets (or with Wrangler secret commands), not
as plaintext `vars` and not in the repository.

## 5. Bootstrap the environment Workers

Production was bootstrapped with Wrangler. Staging remains to be deployed.
Authenticate Wrangler interactively and select the correct Cloudflare account
before a manual deployment:

Build each environment before the first deploy so Vite flattens the matching
Wrangler bindings:

```bash
CLOUDFLARE_ENV=staging npm run build
npx vinext deploy --skip-build --env staging

CLOUDFLARE_ENV=production npm run build
npx vinext deploy --skip-build --env production
```

In PowerShell, set `$env:CLOUDFLARE_ENV` before the corresponding build instead
of using the POSIX prefix syntax.

Named Wrangler environments create separate Workers and keep staging user data
away from production. The production environment's committed Custom Domain
route causes Cloudflare to provision DNS and a certificate for
`academic.rowo.link`.

## 6. Create a least-privilege Workers Builds token

The token generated automatically by Workers Builds does not include D1 edit
permission, so it cannot run the migration-first deploy command. Create a
user-scoped Cloudflare API token limited to the relevant account and
`rowo.link` zone with only:

- Account / Workers Scripts: Edit
- Account / D1: Edit
- Zone / Workers Routes: Edit for `rowo.link`
- Any identity/account read permissions Cloudflare requires to use the token

Do not grant KV, R2, DNS-wide, or unrelated-account access. Select this same
token in the Build settings for both environment Workers. Workers Builds
currently requires a user-scoped build token; keep it in Cloudflare, not in the
repository or GitHub Actions.

## 7. Connect GitHub to Workers Builds (pending)

For each Worker, open Cloudflare Dashboard > Workers & Pages > Worker > Settings
> Builds, authorize the GitHub App for only this repository, and connect it.

### Production Worker

- Production branch: `main`
- Non-production branch builds: disabled
- Build variables:
  - `CLOUDFLARE_ENV=production`
  - `NODE_VERSION=22.13.0`
- Build command: `npm run build`
- Deploy command:

```bash
npx wrangler d1 migrations apply rowo-academic-users-production --remote --env production --config wrangler.jsonc && npx vinext deploy --skip-build --env production
```

### Staging Worker

- Production branch: `staging` (create or select the team's staging branch)
- Build variables:
  - `CLOUDFLARE_ENV=staging`
  - `NODE_VERSION=22.13.0`
- Build command: `npm run build`
- Deploy command:

```bash
npx wrangler d1 migrations apply rowo-academic-users-staging --remote --env staging --config wrangler.jsonc && npx vinext deploy --skip-build --env staging
```

Vite resolves the Cloudflare environment while building and writes a flattened
deployment configuration. Setting `CLOUDFLARE_ENV` on the build is therefore
required; adding only `--env` to a later Wrangler deploy is not sufficient.

Branch preview versions may share the staging D1 bindings and SSO callback
configuration. Leave them disabled until shared staging state and preview-host
authentication are an intentional choice.

## 8. Protect GitHub branches (pending)

Create a branch rule or ruleset for `main` that:

- requires pull requests and at least one review;
- requires the repository's `CI / verify` status check;
- blocks force pushes and direct pushes/bypass; and
- optionally requires the branch to be current before merging.

Cloudflare deploys every commit pushed to its configured production branch. The
protected branch is therefore the release gate. `.github/workflows/ci.yml` must
remain CI-only—do not add `wrangler-action`, Cloudflare credentials, or another
deployment job.

## 9. Verify the custom domain

The initial production Worker was deployed with version
`857b4b4d-1f4a-4a56-a728-2466b1fc2437`. Its public DNS, HTTPS certificate,
landing page, API authentication boundary, and SSO redirect were verified from
outside the local intercepted DNS path. For future deployments, confirm that:

- `academic.rowo.link` appears under Worker Settings > Domains & Routes;
- Cloudflare issued the certificate and created the Worker DNS record;
- `/` loads over HTTPS; and
- ROwO redirects only to the exact allowlisted Academic origin.

Keep the route in `wrangler.jsonc` as the source of truth. Dashboard-only route
changes may be overwritten by a later Wrangler deployment.

## 10. Roll over the academic calendar

When a new crawler/database release is ready:

1. Provision and validate the new academic-calendar D1 database independently.
2. In one reviewed PR, update every `ACADEMIC_DB.database_name`, every
   `ACADEMIC_DB.database_id`, every `ACADEMIC_CATALOG_ID`, and every
   `ACADEMIC_CALENDAR_LABEL` occurrence in `wrangler.jsonc`; also refresh
   `.env.example`.
3. Deploy to staging and validate program lookup, requirement evaluation, and
   planner results against known cases.
4. Merge through the protected production branch.
5. Retain the prior calendar database for rollback until production validation
   is complete.

Never apply the app migration directory to the academic-calendar database.
Changing the calendar binding does not move or rewrite user data in `DB`.

## Account-action checklist

- [x] Confirm the academic D1 database and `rowo.link` zone share the Worker account.
- [x] Create staging and production app-owned D1 databases.
- [x] Commit both user D1 IDs in `wrangler.jsonc`.
- [x] Apply the initial app migration to both remote app databases.
- [ ] Add the production and exact localhost origins to ROwO's SSO allowlist and redeploy it.
- [ ] Add the exact staging origin after the staging Worker is provisioned.
- [x] Bootstrap the production Worker.
- [ ] Bootstrap the staging Worker.
- [ ] Create and select the least-privilege D1-capable Workers Builds token.
- [ ] Authorize the Cloudflare GitHub App for this repository only.
- [ ] Configure the staging and production Workers Builds settings above.
- [ ] Protect `main` and require `CI / verify`.
- [x] Deploy the committed `academic.rowo.link` Custom Domain route.
- [x] Confirm HTTPS and certificate issuance from an external client.

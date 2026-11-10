# Implementation progress

Plan: [plan.md](plan.md). Work branch: `feat/optional-features`.

Updated: 10 November 2026. All six features are implemented and locally verified.
The web/API is deployed. Live Upstash cache/queue verification now passes.
Production caching and public HTTPS verification pass. A continuously running
worker is NOT DEPLOYED because no host was selected. The selected implementation
scope is complete; see [verification.md](verification.md) for the final audit.

| Area    | Current evidence                                                    | Status                                         |
| ------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| O00-O06 | Migrations, forms, pagination, charts, transactional revisions      | Local checks pass                              |
| O07     | Cache adapter, timeout, expiry, isolation, invalidation and races   | Local and live Upstash checks pass             |
| O08-O10 | Doctor roles, assignments, authorization and read-only UI           | Local and deployed HTTPS checks pass           |
| O11     | Reminder processor and real Redis queue                             | Local checks pass                              |
| O12     | Actual scheduler execution, retries, reconnect and SIGTERM          | Native outage/scheduler and Upstash queue pass |
| O13     | Neon upgrade, promoted web/API, production cache and browser checks | Verified on public production HTTPS            |

Preflight: pagination is additive to the daily route; charts use full calendar
data; cache keys use patient ID and transactional data revision; doctor checks
precede cache lookup; jobs use TCP Redis rather than the cache REST client.
These interfaces are consistent across the tasks.

- Initial O00 regression: upgrade failed on the original migrator with
  `column "first" does not exist`, proving later migrations were not applied.
- Execution choice: retain this shared checkout on a new feature branch so the
  user can review the work directly. Preserve the existing plan/README edits.
  Git publication follows the user's separate commit request. No paid
  infrastructure is assumed.

## Verified implementation

- O00: ordered migrations and isolated native PostgreSQL runner. Upgrade/data
  preservation, rollback, duplicate versions and reruns pass.
- O01: extracted reading form; four React Testing Library tests pass.
- O02-O03: paginated history API/UI; API isolation/validation and three UI tests
  pass. Real browser checks navigate 24 synthetic readings over two pages.
- O04-O05: monthly API/chart/table; leap/calendar/ownership cases and three UI
  tests pass. Browser checks responsive chart sizing before checking overflow.
- O06: revisions change atomically with successful mutations. A database-trigger
  failure proves readings and revisions roll back together.
- O07: cache adapter and API tests pass, including actual timeout behavior under
  a stalled HTTP transport, invalid payloads, expiry, outages and a late fill.
  `test:cache:live` now passes against the project database; see provider setup below.
- O08-O09: doctor migration, trusted CLI, repeatable seed, and authorization tests
  pass. Revoking access blocks the next request before a warmed cache lookup.
- O10: two UI tests and a real doctor browser journey pass (read-only reports,
  switching, revocation, empty assignments). Synthetic doctor screenshot captured.
- Doctor browser checks pass after correcting synthetic fixture emails to use
  the same normalization as login.
- O11: reminder processor/calendar tests pass for zero/one/three/four readings,
  doctors/new accounts, retry date stability and concurrent deduplication. Queue
  worker/scheduler integration also passes as recorded below.

## Decisions and corrections

- A history request now owns its rendered page rows; the browser regression found
  that a new page label could briefly accompany the previous page's data.
- Recharts observes resizing asynchronously. The mobile check waits for the
  rendered chart width to match its container, rather than asserting mid-resize.
- BullMQ 6.7.3 uses the Job Schedulers template API and the immutable timestamp
  in its generated scheduler job ID; see the real execution correction below.
- Git publication is authorized by the user's separate commit request. No paid
  worker host or provider plan upgrade was made.

## Review fixes and queue verification

- Independent review found no critical issue and three important issues: retained
  failed jobs were not retried, Redis outages could block shutdown, and a failed
  live-cache deletion could skip other cleanup. All three now have fixes and
  regressions. The review also requested real scheduled-job and reconnect checks.
- Failed reminder days now retry with a fresh attempt budget. The actual Redis
  test exhausts three attempts, restores processing, and re-enqueues successfully.
- Worker shutdown closes offline connections without waiting for an `end` event
  that IORedis may not emit when no socket exists. Native SIGTERM tests pass with
  Redis available and unavailable. The process has a five-second final deadline.
- Real scheduler execution showed BullMQ does not deserialize producer-internal
  `prevMillis` into job options. Target dates now use the immutable timestamp in
  BullMQ's generated scheduler job ID, validated with real scheduled execution
  and stable retry-date tests. This corrects the earlier progress note.
- Queue integration now passes 4/4: retry/deduplication/exhausted recovery, actual
  scheduled timestamps and Redis restart, outage shutdown, and healthy shutdown.
- A two-second idle sample on native test Redis observed 8 commands in the latest
  run (other runs varied). This is not a hosted Upstash quota measurement.
- The chart-access revocation regression now clears existing summary data if the
  chart request loses access. Latest UI evidence: 13/13 passed.
- Latest full API/unit evidence: 35/35 passed. Patient/session/doctor browser
  journeys pass, with fresh synthetic desktop/mobile/doctor screenshots.

## Neon rehearsal and deployment work

- Project: `odd-hat-72813920`, region Singapore. Rehearsal branch:
  `br-red-sun-b3yqvcu7` (`optional-features-rehearsal-20261110`). Production stays
  on its original branch, `br-raspy-water-b3jc9wel`.
- Rehearsal migrations 1-4 applied and reran successfully, preserving all 3 users
  and 21 readings in the parent snapshot. Old account fields/readings matched
  exactly; new roles defaulted to patient and revisions to zero.
- New preview-only Vercel variables point at the rehearsal branch with an
  independent session secret. Production secrets were not copied into previews.
- The API now derives a preview's exact origin from `VERCEL_URL` when no explicit
  `APP_ORIGIN` is set. The production origin remains explicit. A focused test
  covers the environment distinction and hostname validation.
- Preview build READY: `dpl_98qkDzYz2SX19v3h5NxGNPmUZoYs`.
  Source hash: `016b3addac29b826645dc657ae4f89c41603da93274b978500bce70c8c18074b`.
  This is an uncommitted worktree deployment, not a Git commit publication.
- Preview API and browser verification passed through existing authenticated CLI
  access. Production migrations 1-4 then applied successfully, preserving all
  three existing users and 21 readings. The repeatable seed added one synthetic
  doctor account/assignment without overwriting existing user data.
- Production deployment READY and promoted:
  `dpl_CE2Eg16QkyJ98VnagF12LHCv2jxZ`.
  Live URL: <https://sweety-blood-glucose-tracker-tan.vercel.app>.
  Deployed source hash:
  `f502bae0a6afec0fb5a64300cc0cb5f03dac8a8c1d4776497434f525e0b5b68f`.
  This identifies the deployed uncommitted source bundle, not a Git commit.
  Subsequent documentation/test metadata corrections are local.
- Staged production checks passed before promotion. Canonical HTTPS API smoke
  and real browser checks passed for patient history/chart/reports, doctor
  read-only access, and synthetic registration/reading create/edit/delete.
  The browser test removed its own account and session. A subsequent database
  check found four users, 21 readings, one doctor, and zero deployment-test users.
- The CLI created a temporary automation bypass for protected preview checks.
  It was revoked after verification. The raw project check confirmed zero
  bypass entries and no automation-bypass environment variable. Preview and
  deployment URL protection remain enabled; the canonical production URL is public.
- At the first web deployment, Upstash credentials were absent and the live cache
  check returned `PENDING` with exit status 2. The provider setup below resolves
  that credential gap. The final deployment below activates production caching.

## Upstash setup and live verification

- Created through the authenticated Upstash MCP server: **SweetyRedis**, ID
  `6a7f38c1-18fa-4c9b-8019-ff3774c79fc6`, Free plan, Singapore
  (`ap-southeast-1`), state `active`. TLS is enabled, eviction is disabled.
  This is an account-owned database, not a temporary unclaimed database.
- Ran `npx -y upstash setup --yes --codex`; the plugin and skills were installed.
  `codex mcp login upstash` completed successfully. Restart Codex to load the
  installed MCP tools in a new session. Creation used the authenticated MCP
  connection without waiting for a restart.
- Saved REST URL/token and TCP/TLS URL to ignored `.env` and
  `.env.production.local`, both mode `0600`. Cache and queue namespaces differ
  between development and production. No credentials are in tracked source.
- `@upstash/redis` 1.41.0 was already installed. Added the shared client factory
  in `lib/redis.ts`, connected `server/cache.js` to it, and verified native object
  serialization, `PING`, a read/write round trip, and TTL with real Upstash.
  The temporary setup key was deleted.
- Live cache checks passed for real hits, TTL expiry, and create/delete report
  invalidation, using a temporary native PostgreSQL test database and unique
  Redis namespace. Cleanup removes only the generated account and keys.
- All four queue integration checks passed with `TEST_REDIS_URL` pointing to
  Upstash. Processing/retries/deduplication and the spawned worker's catch-up
  use Upstash; restart/outage/scheduler cases retain their private native Redis.
  The actual synthetic reminder processor persisted the expected records.
- The latest two-second idle sample observed one command; this short sample is
  not an estimate of an always-on worker's monthly quota. No hosted worker is
  running. API/unit tests remain 35/35 passing after the shared-client change;
  the production build and formatting checks pass.

## Reproduce the checks

```sh
npm run test:isolated
npm run test:ui
npm run test:jobs:integration
npm run format:check
npm run test:deployment -- https://sweety-blood-glucose-tracker-tan.vercel.app
npm run test:deployed:browser -- https://sweety-blood-glucose-tracker-tan.vercel.app
```

The deployed browser command is read-only by default. Supplying the explicit
`DEPLOYMENT_TEST_DATABASE_URL` enables a fresh synthetic account's mutation
journey and targeted cleanup. It must point to the deployment's database;
ordinary database test suites must never use that production URL.

## Final Vercel verification

- Production: <https://sweety-blood-glucose-tracker-tan.vercel.app>, READY,
  deployment `dpl_D8qmTKomEq9oQoLzRxGpzq8uaPMx`, function region `sin1`.
  Source hash `8a56a7ffe45e64962f3d5e5816197eba69f42f07436388bd6239c7ba6262542b`.
  This build was created from the tested worktree before Git publication.
- Production REST URL/token are Secrets in Vercel; the production namespace is
  separate from development. The TCP/TLS worker secret stays outside Vercel's
  request-handler environment because the worker runs separately.
- Pre-promotion tests caught a module-loading error: Vercel compiled the shared
  TypeScript file while the JavaScript API retained a `.ts` import. The API now
  imports the shared JavaScript implementation, with a typed `lib/redis.ts`
  entry point. The fixed staged deployment passed before promotion.
- API smoke, real browser registration/reading CRUD, history/chart/reports,
  doctor read-only access, secure sessions, and logout pass on both the staged
  build and canonical production URL. Staged browser requests explicitly use
  the configured canonical Origin; public browser checks use the browser's
  native Origin and no Vercel protection credential.
- Added `test:deployed:cache`: real Redis summary/chart entries, cache reuse
  without TTL reset, and create/edit/delete invalidation all pass over HTTPS.
  It owns a generated account and exact cache keys; it never truncates tables.
- Fixed the browser harness to await logout and route completion before closing.
  A temporary credential appeared in the earlier failed teardown trace; it was
  revoked, and subsequent test output was redacted. The replacement credential
  was also revoked after the successful staged checks. Final project state has
  zero bypass entries, no bypass environment variable, and protection enabled.
- Cleaned the one synthetic account left by that failed teardown using its exact
  ID/email and creation time. Final production state: four users, 21 readings,
  one doctor, one assignment, migrations 1-4, zero deployment-test accounts.
- Final regression: 35/35 API/unit tests, 13/13 UI tests, patient/session/doctor
  browser journeys, four queue integration checks, build and formatting pass.
- Runtime review of the verified deployment found cache hits/misses with zero
  cache fallbacks and no invocation/module failures. Request logs contained
  zero HTTP 5xx records during the 15-minute verification window. Error-level
  stderr records were PostgreSQL TLS-mode deprecation warnings, not failed
  application requests. No external log drain is configured.

No always-on worker host was selected or provisioned. Its local native process
and real Upstash queue are verified. This is the documented O12 completion path.

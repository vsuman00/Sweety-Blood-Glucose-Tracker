# Optional features: final verification

Verified on 10 November 2026. O00-O13 are complete for the selected scope:
six bonus features, Neon PostgreSQL, Upstash Redis, and the Vercel web/API.
Docker is excluded. An always-on worker host was not selected; the separate
native worker has been demonstrated against real Upstash.

## Deploy result

| Field           | Verified value                                                        |
| --------------- | --------------------------------------------------------------------- |
| URL             | <https://sweety-blood-glucose-tracker-tan.vercel.app>                 |
| Target / status | Production / READY                                                    |
| Deployment      | `dpl_D8qmTKomEq9oQoLzRxGpzq8uaPMx`                                    |
| Framework       | Vite React client and Express Node.js API                             |
| Function region | `sin1` (Singapore)                                                    |
| Build duration  | Approximately 22.3 seconds                                            |
| Source          | Worktree on `feat/optional-features`, deployed before Git publication |
| Source hash     | `8a56a7ffe45e64962f3d5e5816197eba69f42f07436388bd6239c7ba6262542b`    |
| Upstash         | SweetyRedis, Free plan, `ap-southeast-1`, TLS on, eviction off        |
| Neon migrations | Versions 1, 2, 3, 4 applied                                           |

The source hash is SHA-256 of the JSON array of sorted `{path, sha256}` records
for deployment inputs. Git metadata, `.vercel`, `.env*`, dependencies, build output,
docs, tests, README, and logs are excluded. It identifies the deployed worktree
bundle, not a Git commit. Documentation and test-harness changes postdate the
build; deployed runtime inputs were checked against the manifest.

## Requirement evidence

| Task | Outcome and evidence                                                                                                                                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O00  | Ordered migrations, v1 upgrade/data preservation, rollback, reruns and duplicate-version rejection pass in `tests/migrations.test.js`. `scripts/test-isolated.js` owns its temporary native PostgreSQL lifecycle. Neon rehearsal and production upgrades preserved the existing three users and 21 readings.                                                          |
| O01  | `ReadingForm.jsx` extraction and RTL checks cover validation, create/edit payloads, cancellation, rejected saves and duplicate submission. Native browser validation is also exercised.                                                                                                                                                                               |
| O02  | `tests/optional-api.test.js` verifies additive pagination, the legacy daily response, stable ordering, counts, malformed inputs and ownership. Count and rows share one SQL snapshot.                                                                                                                                                                                 |
| O03  | UI tests and `tests/browser.js` navigate 24 synthetic readings over two pages. History owns its requested page state, ignores late responses, refreshes after writes and handles loading/retry/empty states.                                                                                                                                                          |
| O04  | API tests verify complete monthly chart data, date bounds, leap/calendar cases, invalid/future months and isolation. Data does not depend on the history page.                                                                                                                                                                                                        |
| O05  | RTL and browser checks cover four slot lines, missing-day gaps, empty data, the accessible table and responsive sizing without overflow. Chart and doctor screenshots use synthetic data.                                                                                                                                                                             |
| O06  | `tests/revisions.test.js` verifies successful mutation revisions, failed/stale writes and a forced database failure that rolls readings and revisions back together.                                                                                                                                                                                                  |
| O07  | SDK timeout/configuration tests and injected-cache tests cover hits, expiry, namespace/account isolation, malformed payloads, outages, CRUD invalidation and late-fill races. Real Upstash checks pass for hits, TTL and invalidation. Production HTTPS checks confirm summary/chart Redis entries, hit reuse without TTL reset, and create/edit/delete invalidation. |
| O08  | Role/assignment CLI, migration, default-patient registration, assignment constraints and repeatable seed tests pass. Existing records remain intact.                                                                                                                                                                                                                  |
| O09  | `tests/doctor.test.js` covers anonymous/wrong-role access, assigned/unassigned patients, uniform unavailable IDs, revocation and role changes before warmed-cache reads. Production smoke checks verify the read-only API.                                                                                                                                            |
| O10  | RTL and real browser journeys verify patient switching, access loss, empty assignments and read-only controls. Losing chart permission clears previously displayed summaries. The public doctor flow passes.                                                                                                                                                          |
| O11  | Reminder tests cover zero-to-three readings, four-reading exclusion, doctors/new accounts, fixed dates and concurrent deduplication. Real BullMQ tests verify retries, exhausted-day recovery and one persisted reminder per patient/day.                                                                                                                             |
| O12  | Actual scheduler execution and timezone checks, native Redis restart/reconnect, and spawned-worker SIGTERM cases pass. Upstash queue processing and native worker catch-up/shutdown pass too. A two-second Upstash idle sample observed one command; this is not a monthly quota estimate. No hosted worker is claimed.                                               |
| O13  | Build, formatting and regressions pass. The fixed production build passed staged API/browser/cache checks, was promoted without rebuilding, and passed the same checks on the public URL without a protection credential. Runtime and cleanup evidence follow.                                                                                                        |

## Verification results

| Check                                                     | Result                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| API/unit suite with isolated PostgreSQL                   | 35 passed, 0 failed                                                                       |
| Vitest / React Testing Library                            | 13 passed, 0 failed                                                                       |
| Local patient, session-expiry and doctor browser journeys | Passed                                                                                    |
| Queue integration suite                                   | 4 passed, 0 failed; native outage tests and real Upstash processing                       |
| Production build and formatting                           | Passed                                                                                    |
| Live Upstash SDK/cache                                    | PING, object round trip, bounded TTL, hit and invalidation passed                         |
| Staged production API and browser                         | Passed, including synthetic registration and reading CRUD                                 |
| Public production API and browser                         | Passed with native browser Origin and no Vercel protection credential                     |
| Deployed Upstash cache                                    | Real summary/chart entries, reused TTL, create/edit/delete invalidation and logout passed |

The deployed browser test awaits logout and outstanding route callbacks before
closing. The cache test requires an explicit matching cleanup database and only
deletes its generated account, sessions and exact cache keys. Neither deployed
test truncates tables or runs schema migrations.

## Production audit

- Final database state: four users, 21 readings, one doctor, one assignment,
  migrations 1-4, and zero deployment-test accounts. The fourth user is the
  deliberately seeded synthetic doctor. No existing readings were overwritten.
- One fixture survived an earlier browser teardown failure. It was identified
  by exact ID/email/name/creation time and removed with its own cache keys.
  Subsequent staged and public runs completed cleanup successfully.
- The first staged build failed because the JavaScript API imported a TypeScript
  path absent from Vercel's runtime bundle. It was never promoted. The shared
  JavaScript client plus typed TypeScript entry point fixes that deployment
  boundary; the final deployment has no module/invocation failures.
- The reviewed runtime window contained cache hits and misses, zero cache
  fallbacks, and no application exception. The 15-minute request-log query for
  the final deployment returned zero HTTP 5xx records. These are bounded checks,
  not a guarantee about future traffic.
- Error-level stderr entries in the reviewed window were PostgreSQL driver's
  TLS-mode deprecation warnings. They did not correspond to failed requests.
  No external log drain or continuous monitoring service is configured.
- Protected staged URLs needed an automation credential because the development
  OIDC token was rejected by the existing Trusted Sources rule. An earlier test
  failure trace included a temporary credential; it was revoked. Its replacement
  was also revoked after successful tests. Final project state has zero bypass
  entries and no automation-bypass environment variable. Deployment Protection
  remains enabled for preview and deployment URLs; the canonical URL is public.

## Reproduce and operate

```sh
npm run test:isolated
npm run test:ui
npm run test:jobs:integration
npm run format:check
npm run test:deployment -- https://sweety-blood-glucose-tracker-tan.vercel.app
npm run test:deployed:browser -- https://sweety-blood-glucose-tracker-tan.vercel.app
```

The deployed browser command is read-only unless
`DEPLOYMENT_TEST_DATABASE_URL` is explicitly supplied. For the production cache
check, supply that database URL plus the deployment's Upstash REST URL/token and
namespace through an ignored `.env.deployment-test.local`, then run:

```sh
node --env-file=.env.deployment-test.local tests/deployed-cache.js https://sweety-blood-glucose-tracker-tan.vercel.app
```

For live provider suites, supply `TEST_UPSTASH_REDIS_REST_URL` and
`TEST_UPSTASH_REDIS_REST_TOKEN` for `test:cache:live`, and `TEST_REDIS_URL` for
`test:jobs:integration`. Use the isolated test database runner and generated
Redis prefixes. Ordinary API tests truncate only a separate `_test` database;
never point them at the deployment's database.

Run `npm run worker` separately with the configured PostgreSQL URL, Upstash
TCP/TLS URL and queue prefix. Demonstrate/backfill with
`npm run reminders:enqueue -- --date=2026-11-09`. A stopped worker or sleeping
Mac does not provide continuous scheduling. It writes reminder logs, not
email/SMS or medical recommendations. Always-on hosting and its budget remain
a separate, unselected deployment option.

The prior verified production build `dpl_CE2Eg16QkyJ98VnagF12LHCv2jxZ` is the
rollback reference. Rollback was not executed during final verification.
Promoting that existing build preserves PostgreSQL data and serves the earlier
cache-disabled API. Stopping the worker or disabling caching also leaves reading
data in PostgreSQL; do not drop role/assignment tables as a routine rollback.

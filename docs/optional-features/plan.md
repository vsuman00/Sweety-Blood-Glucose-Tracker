# Sweety optional features: implementation plan

Date: 10 November 2026

Status: COMPLETE for the six selected optional features and web deployment.
Local, live Upstash, and production HTTPS checks pass. An always-on worker host
was not selected; the native worker demonstration is verified. See
[progress.md](progress.md) for the implementation and verification record.

## Scope and starting point

Complete the six remaining bonus tasks from the Kenpath assignment: pagination,
monthly charts, React Testing Library form tests, Redis report caching, a BullMQ
background job, and a doctor role. Docker is excluded by the user's decision.
Use the existing Neon PostgreSQL database and Upstash Redis. Keep the current
React, Express, PostgreSQL driver, authentication, and Vercel API architecture.

The required assignment features were already implemented when this plan was
written. The optional implementation now passes 35 API/unit tests, 13 UI tests,
four real Redis queue tests, and patient/session/doctor browser journeys. The
production HTTPS journey also passed with synthetic registration and reading
create/edit/delete. Separate live Upstash cache and queue checks now pass too.

Keep the existing Neon project. Migrations 1-4 were rehearsed on a Neon branch,
then applied to production with all three existing users and 21 readings
preserved. One synthetic doctor account was subsequently added. Upstash REST
and TCP/TLS credentials are configured locally for SweetyRedis (Free plan,
Singapore); Vercel production uses PostgreSQL with the Upstash report cache.
No continuously running worker has been deployed.

| Assignment bonus                              | Planned tasks | Current status                                  |
| --------------------------------------------- | ------------- | ----------------------------------------------- |
| Pagination on readings                        | O02, O03      | IMPLEMENTED; local and HTTPS checks pass        |
| Monthly line chart                            | O04, O05      | IMPLEMENTED; local and HTTPS checks pass        |
| Reading-form tests with React Testing Library | O01           | IMPLEMENTED; local UI suite passes              |
| Redis report caching and invalidation         | O06, O07      | IMPLEMENTED; local and live Upstash checks pass |
| BullMQ daily reminder log                     | O11, O12      | IMPLEMENTED; native Redis and live Upstash pass |
| Doctor reports for assigned patients          | O08, O09, O10 | IMPLEMENTED; local and HTTPS checks pass        |
| Docker Compose                                | None          | EXCLUDED by user                                |

## Decisions shared by the tasks

### Data and API compatibility

- PostgreSQL remains the source of truth for accounts, readings, permissions,
  sessions, and reminder-log records. Upstash holds disposable report caches and
  BullMQ queue state. Neither replaces the PostgreSQL database.
- Preserve all required validation, user isolation, stale-write protection,
  one-decimal averages, and Asia/Kolkata calendar rules.
- Preserve `GET /api/readings?date=YYYY-MM-DD` and its `{readings}` response when
  pagination is absent. Paginated history is an additive mode described in O02.
  Required report statistics must never be calculated from a page of history.
- Preserve `/api/reports?date=YYYY-MM-DD`. Add a separate monthly-chart endpoint;
  keep the existing daily, month-to-date, and previous-month meanings.
- Retain the existing layout and visual style. Add focused components instead
  of rewriting the dashboard or moving to another framework.

### Neon, migrations, and environments

- Keep `pg` and the existing session store. Use a pooled Neon URL for the API
  and worker, and a direct URL for migrations.
- Extend the migration runner to apply ordered, numbered SQL files once. Never
  edit `001_initial.sql` to introduce features into an existing database.
- Test every new migration on a Neon development branch before production.
  Existing users and readings must survive the upgrade.
- Keep development/test/production database names distinct. Preserve the test
  database guard. Test suites must not load `.env.production.local`.
- Keep secrets in ignored local files or server environment settings. Do not
  add client-side `VITE_` credentials or print tokens in logs.

### Report caching and correctness

- Use `@upstash/redis` over HTTPS in both Express entry points. Cache complete
  report objects as JSON strings with an initial 60-second TTL.
- Give cache keys an environment namespace, format version, patient ID, data
  revision, report kind, and requested date/month. Require a namespace unique
  to the app database/environment when caching is enabled.
- Add a monotonically increasing report revision per user in PostgreSQL. Bump
  it in the same transaction as each successful reading create/update/delete.
  Failed validation, duplicate writes, and stale writes do not bump it.
- Read the revision from PostgreSQL before selecting a cache entry. A changed
  revision makes all old daily/monthly/chart entries unreachable immediately;
  their TTL removes the old keys. This is logical invalidation, without broad
  Redis scans or deleting queue keys. Moving a reading between dates or months
  invalidates every report for that patient.
- Load report data from the primary database after reading the revision. Test
  concurrent cache fills against writes so an old fill cannot become current.
  A PostgreSQL revision lookup remains on cache hits; the benefit is avoiding
  repeated report aggregation, not eliminating every database query.
- Cache failures or a one-second request timeout fall back to PostgreSQL.
  A committed write must still return success if a cache operation fails.
  Missing both cache credentials disables caching; partial configuration fails
  clearly at startup. Do not retry cache requests for several seconds.
- Check authentication and doctor assignment before each cache lookup. Do not
  cache permission decisions, patient lists, or authentication errors.

### Doctor access

- Assignment-sized policy: new public registrations are patients.
  Existing users become patients. Only a trusted server-side command can grant
  the doctor role or manage doctor-patient assignments. There is no public role
  picker, self-assignment endpoint, or admin dashboard in this scope.
- Doctor accounts see a read-only assigned-patient dashboard. Existing patient
  accounts keep their current reading-management flow. Doctors cannot create,
  edit, or delete patient readings through the doctor API.
- Use a role field on users and an assignment table with foreign keys and a
  unique doctor/patient pair. Validate the two account roles when assigning;
  role changes must remove incompatible assignments transactionally.
- Read current role and assignment from PostgreSQL on protected requests.
  Revoking an assignment must block the next request even when reports are
  already cached. Return 401 without a session, 403 for a wrong role, and a
  uniform 404 for unavailable/unassigned patient IDs.
- The role and assignment policy above is an implementation assumption
  because the assignment does not specify an onboarding workflow. Record it in
  the README and the O08 doctor spec.

### BullMQ runtime and cost

- Use BullMQ with an Upstash Redis TCP/TLS connection, separate from the REST
  credentials used by the report cache. Introduce `REDIS_URL` using `rediss://`
  for Upstash. Do not try to use a REST token as the Redis TCP password.
- Run one native Node.js worker process through `npm run worker`. Keep worker
  startup out of `server/app.js` and `api/index.js`; an ordinary Vercel request
  handler is not the worker host. A local demo needs no Docker.
- Keep Upstash eviction disabled if caches and queues share a database. Cache
  entries expire by TTL; BullMQ keys must not be evicted. Use separate cache and
  queue prefixes. Never run `FLUSHDB` against shared infrastructure.
- The reminder is a log entry, not an email, SMS, or medical recommendation.
  At 00:05 Asia/Kolkata, evaluate the previous calendar day for patient accounts
  that existed by the end of that day. Record those with zero to three readings;
  skip accounts with four readings and skip doctors.
- Persist reminder records with a unique `(user_id, reading_date)` constraint.
  Retries must not create duplicate records. Application logs may repeat after
  a crash; do not claim exactly-once console output.
- Preserve the target date across retries using the job's scheduled timestamp
  or explicit date payload, rather than recomputing it from retry time. On
  restart, enqueue the most recent completed day idempotently; older missed
  dates use an explicit backfill command.
- Use current Job Schedulers APIs, bounded retries/backoff, bounded completed
  job retention, failure reporting, and graceful shutdown. Verify installed
  BullMQ/Redis compatibility before choosing package versions.
- Upstash documents that BullMQ generates commands while idle. Measure this
  during the demo; do not promise an always-on worker will fit the free tier.
  Keep the demo worker off when unused. An always-on hosted worker and its cost
  are a separate deployment decision; do not provision a paid host implicitly.

## Implementation order

Execute one task at a time. Each task should leave the required app runnable.
Task checkboxes record locally verified implementation. Provider and deployment
checks remain separate. Commands and files are added by their owning tasks.

### O00: Configuration, migrations, and isolated verification

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: none. Spec: short, in this section.
- **Goal/context:** prepare the existing app for additive migrations and safe
  integration tests. `server/database.js` currently applies only version 1.
- **Approach:** add ordered migration discovery and duplicate/version checks;
  introduce an unpooled migration URL with the existing URL as a local fallback.
  Record Upstash REST/TCP and namespace settings in `.env.example` when used.
  Add `npm run test:isolated` to start a temporary native PostgreSQL instance,
  create a distinct `_test` database, run API/browser checks sequentially, and
  stop the instance even on failure. No existing database is reset by the wrapper.
- **Acceptance:** a fresh database and an upgraded v1 fixture both migrate;
  reruns are idempotent; migration errors roll back; existing data survives;
  the isolated test runner works without Docker and without production secrets.
- **Verify:** `npm run test:isolated`, `npm run build`, `npm run format:check`.

### O01: Extract and test the reading form

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O00. Spec: short, in this section.
- **Goal/context:** satisfy the explicit React Testing Library bonus while
  protecting the behavior currently embedded in `client/main.jsx`.
- **Approach:** extract a `ReadingForm` component with the current date, slot,
  value, busy, edit, and error contracts. Add Vitest, jsdom, React Testing
  Library, user-event, and jest-dom; add `npm run test:ui`.
- **Acceptance:** tests cover required/invalid values, valid create payloads,
  edit/cancel behavior, rejected saves preserving input, and disabled duplicate
  submission. Use accessible labels and observable behavior, not snapshots of
  the component implementation. Native browser validation remains covered by
  the real browser suite.
- **Verify:** `npm run test:ui`, `npm run test:isolated`, `npm run build`.

### O02: Paginated readings API

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O00. Spec: short, contract below.
- **Goal/context:** support history beyond the four entries available on a day.
- **Approach:** support `GET /api/readings?page=1&limit=20` across the current
  user's history; allow an optional `date` filter. Default page/limit to 1/20
  in paginated mode. Validate positive safe integers, a maximum limit of 100,
  repeated/malformed query parameters, and an offset within a safe bound.
  Sort by date descending, then canonical slot order, then ID. Return
  `{readings, pagination:{page,limit,total,totalPages}}`; empty results have
  `totalPages:0`. Count and page rows must use a consistent database snapshot.
- **Acceptance:** the legacy date-only response remains compatible; two users
  cannot see each other's history/counts; empty and beyond-last pages are valid;
  invalid inputs return readable 400 errors. Stable fixture pages have no gaps
  or duplicates. Document that concurrent inserts may shift offset-based pages.
- **Verify:** add pagination cases to the API suite; `npm run test:isolated`.

### O03: Reading-history UI

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O01, O02. Spec: short.
- **Goal/context:** expose pagination without changing the required daily list.
- **Approach:** add a history section with previous/next controls, total count,
  and page size. Keep history rows read-only; use the existing day workflow for
  editing. Cancel or ignore old requests after page/account changes.
- **Acceptance:** navigation, loading, empty, retry, and last-page states work
  on desktop/mobile. Refresh history after CRUD and clamp an invalid last page
  after deletion. Changing accounts or expiring a session clears all history.
- **Verify:** `npm run test:ui` for navigation/error behavior;
  `npm run test:isolated` with a synthetic multi-page browser fixture.

### O04: Monthly chart-data API

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O00. Spec: short, contract below.
- **Goal/context:** provide full chart data independently of history pagination.
- **Approach:** add `GET /api/reports/monthly?month=YYYY-MM`, returning
  `{start,end,readings}` with an exclusive end and date/slot/value rows in date
  and canonical slot order. Past months include the entire calendar month;
  the current month ends after today. Reject invalid and future months.
- **Acceptance:** every owned reading in the period appears, at most 124 rows;
  empty months, leap days, December/January boundaries, and user isolation work.
  No reading from another month or account appears. Existing report responses
  and numeric rounding remain unchanged.
- **Verify:** add API fixtures for all boundary cases; `npm run test:isolated`.

### O05: Monthly line chart

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O01, O04. Spec: short.
- **Goal/context:** show glucose history by day without inventing measurements.
- **Approach:** add Recharts and a responsive monthly chart with one line per
  meal slot. Include every calendar day; missing readings are null gaps, not
  zeroes or interpolated values. Use the selected dashboard date's month.
  Label axes with dates and mg/dl; provide a legend, readable tooltips, and an
  accessible table of the same measurements.
- **Acceptance:** plotted values equal API data; one-point and empty months
  work; mobile layout has no overflow. Saving/deleting refreshes the chart,
  including both months when a reading is moved. No diagnostic bands or advice.
- **Verify:** `npm run test:ui` for data/gap/state behavior; browser verification
  through `npm run test:isolated`; `npm run build`.

### O06: Transactional report revisions

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O00. Spec: short.
- **Goal/context:** ensure report invalidation survives cache outages and races.
- **Approach:** add the next numbered migration for a per-user revision. Update
  create/update/delete handlers to mutate the reading and revision atomically
  with a checked-out PostgreSQL client; preserve current conflict semantics.
  Keep report loading separate from transport so patient and doctor routes can
  later reuse it.
- **Acceptance:** successful writes increment the owner's revision once; all
  rejected writes leave it unchanged. Cross-date edits invalidate both periods;
  another user's revision is unchanged. Simulated failures roll back both data
  and revision. Release the database client on every path.
- **Verify:** fresh/upgrade migration tests and API transaction regressions via
  `npm run test:isolated`.

### O07: Upstash report caching

- [x] Status: IMPLEMENTED; isolated and live Upstash checks pass. Dependencies: O04, O06. Spec: short.
- **Goal/context:** cache existing summaries and monthly chart data consistently
  across local Express and Vercel instances.
- **Approach:** add a reusable cache adapter using `@upstash/redis`; inject it
  into `createApp`. Apply the revision/namespace/TTL policy above. Configure it
  in both server entry points. Await bounded cache work so it is not abandoned
  after a serverless response. Emit safe hit/miss/fallback diagnostics without
  logging patient readings, credentials, or whole cache contents.
- **Acceptance:** repeated reads hit; expired entries miss; each successful
  mutation immediately makes old reports inaccessible. Test outage, timeout,
  malformed cached data, account/environment isolation, and concurrent fills.
  Failed writes do not invalidate. A bad cache never causes a successful reading
  write to be reported as failed.
- **Verify:** `npm run test:isolated` with an injected cache; introduce
  `npm run test:cache:live` for real Upstash using `TEST_UPSTASH_REDIS_REST_URL`,
  `TEST_UPSTASH_REDIS_REST_TOKEN`, and a generated test namespace. The live test
  checks real hit/TTL/write invalidation and removes only keys it created.
  Missing test credentials are reported as pending, not as a live pass.

### O08: Doctor schema, trusted assignment commands, and demo data

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O00. Spec: full; write the bounded role/API
      contract in `docs/optional-features/doctor-spec.md` first using the policy above.
- **Goal/context:** make assignment ownership explicit before adding report access.
- **Approach:** add a numbered role/assignment migration. Add trusted commands
  with help/validation to grant roles and assign/unassign existing accounts.
  Use transactions for role changes and assignment cleanup. Extend the repeatable
  synthetic seed with one doctor, an assigned patient, and an unassigned patient;
  preserve existing demo credentials/readings.
- **Acceptance:** existing users remain patients; public registration cannot
  request a doctor role; duplicate/invalid assignments are rejected safely.
  Role changes cannot leave active incompatible assignments. Seed reruns do not
  duplicate or overwrite user data. Commands require explicit account identifiers
  and database configuration; document production effects.
- **Verify:** `npm run test:isolated` with role/migration/command tests; run the
  seed twice against the disposable test fixture and assert stable records.

### O09: Doctor report authorization

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O04, O07, O08. Spec: full, O08 document.
- **Goal/context:** allow only assigned-patient reads, including warmed caches.
- **Approach:** expose a paginated `GET /api/doctor/patients` and read-only
  `/api/doctor/patients/:patientId/reports?date=YYYY-MM-DD` and
  `/api/doctor/patients/:patientId/reports/monthly?month=YYYY-MM` routes. Reuse
  patient report calculations after checking the current role and assignment.
  Expose role through public auth responses; keep ownership session-derived.
- **Acceptance:** anonymous users, patients, another doctor, unknown IDs, revoked
  assignments, and injected ownership fields cannot obtain patient data. Test
  revocation after warming the cache. Patient totals remain isolated, and doctor
  routes never allow reading mutations. The patient list exposes only the name
  and ID needed for selection plus pagination metadata.
- **Verify:** the authorization matrix in the API suite through
  `npm run test:isolated`; cache-hit and uncached paths must both be covered.

### O10: Doctor dashboard

- [x] Status: IMPLEMENTED; local checks passed. Dependencies: O01, O05, O09. Spec: short; follows O08.
- **Goal/context:** let a doctor select an assigned patient and inspect reports.
- **Approach:** add role-based navigation, a paginated assigned-patient selector,
  date selection, summary cards, daily list, and monthly chart using the existing
  components. Clear report/chart state before changing patients or accounts.
- **Acceptance:** no reading-edit controls appear for doctors; no-assignment,
  revoked-access, session-expiry, loading, and retry states are usable. A delayed
  old response cannot replace the selected patient's data. Existing patient CRUD
  and mobile layouts continue to work.
- **Verify:** `npm run test:ui` for switching/races/error states;
  `npm run test:isolated` with assigned/unassigned doctor browser journeys.

### O11: BullMQ queue and idempotent reminder processor

- [x] Status: IMPLEMENTED; processor/calendar and real native Redis queue checks pass. Dependencies: O00, O08. Spec: short.
- **Goal/context:** implement the optional daily reminder log with real queue work.
- **Approach:** add BullMQ and its compatible TCP client; isolate queue creation
  from API imports. Add the reminder-log migration and a processor that queries
  actual PostgreSQL reading counts for an explicit date. Use stable date-based
  job identity, retries/backoff, and a unique reminder record per user/date.
  Use bounded batches and bounded retention; do not store passwords or glucose
  measurements in job payloads.
- **Acceptance:** zero/one/three readings produce records; four produce none;
  doctors and accounts created after the target day are excluded. Reprocessing,
  concurrent workers, and a crash/retry produce no duplicate database records.
  Redis/DB outages produce visible failures/retries, without affecting patient CRUD.
- **Verify:** processor cases in `npm run test:isolated`; add
  `npm run test:jobs:integration` using `TEST_REDIS_URL` and a generated queue
  prefix. A native local Redis instance is sufficient; the test never clears
  unrelated keys. Verify actual enqueue/process/retry behavior, not just mocks.

### O12: Scheduler, worker lifecycle, and Docker-free demonstration

- [x] Status: IMPLEMENTED; native scheduler/outage checks and live Upstash queue/worker demonstration pass. Hosted worker NOT DEPLOYED. Dependencies: O11. Spec: short.
- **Goal/context:** make the job runnable on a schedule and demonstrable on demand.
- **Approach:** add `npm run worker`, idempotent daily scheduler registration,
  and `npm run reminders:enqueue -- --date=YYYY-MM-DD` for demo/backfill. Validate
  dates and preserve them on retries. Handle SIGINT/SIGTERM by stopping workers
  and closing queue/Redis/PostgreSQL connections. Make the app's normal start
  independent of the worker. Add explicit worker configuration checks.
- **Acceptance:** the schedule uses 00:05 Asia/Kolkata and the previous day;
  January/leap-day boundaries and retries across midnight are correct. Restart
  does not register duplicate schedulers; it idempotently catches the latest
  completed day. A one-off demo works without waiting overnight. The worker
  reconnects and exits cleanly. It does not claim to run while the Mac is asleep.
- **Verify:** `npm run test:jobs:integration` with a controlled clock/short test
  schedule; run a synthetic one-off job through a dedicated Upstash test queue.
  Record command usage during a fixed idle interval and document the measurement.
  For a continuously running deployment, first select a native-process worker
  host and budget; otherwise mark hosted reminders NOT DEPLOYED.

### O13: Final regression, deployment, and documentation

- [x] Status: IMPLEMENTED AND VERIFIED; regressions, Neon migration preservation, live Upstash, and production HTTPS API/browser/cache checks pass. Dependencies: O01-O12.
      Spec: none; verify against the completed feature contracts.
- **Goal/context:** prove all six bonus features work and keep required features
  and delivery materials accurate.
- **Approach:** update README setup/API/env/assumption notes, synthetic screenshots,
  and the assignment checklist. Run new migrations on a Neon development branch,
  verify data preservation, then apply the same numbered migrations to the
  configured target during deployment. Configure Upstash secrets server-side.
  Deploy the web/API and, if selected, the separate worker. Keep the prior web
  deployment available for rollback; use additive schemas compatible with it.
- **Acceptance:** all six bonus tasks have passing local evidence. Live web/API,
  cache, and worker evidence are recorded separately; credentials or worker-host
  gaps remain explicit. Rollback can disable caching and stop the scheduler/
  worker without losing PostgreSQL readings. Doctor API rollback must preserve
  patient isolation; do not drop role/assignment data as a routine rollback.
- **Verify:** run the release commands below and record results. Extend deployed
  smoke checks using synthetic fixtures only. Refresh screenshots to show history,
  chart, and doctor views; include a reproducible worker demonstration.
- **Out of scope:** Docker, MongoDB migration, clinical recommendations, messaging
  providers, a public admin UI, additional auth providers, and unrelated rewrites.

## Dependency path and release checks

The main path is O00 -> O01 -> O02 -> O03 -> O04 -> O05 -> O06 -> O07 -> O08 ->
O09 -> O10 -> O11 -> O12 -> O13. Individual task dependencies above are the
actual prerequisites. Start with O00, then finish one testable slice at a time.

After the owning tasks add the new commands, run:

```sh
npm run test:isolated
npm run test:ui
npm run test:jobs:integration
npm run build
npm run format:check
npm run test:cache:live
```

`test:isolated` owns its temporary PostgreSQL lifecycle and runs API/browser
checks sequentially. `test:jobs:integration` starts temporary native Redis by
default; `TEST_REDIS_URL` selects a remote test connection. Real provider checks require test credentials and
namespaces. Ordinary unit/UI tests must not require Upstash or production data.
Update format scripts to include new JavaScript/configuration directories.

After deployment, use the existing read-only synthetic-account smoke command:

```sh
npm run test:deployment -- https://sweety-blood-glucose-tracker-tan.vercel.app
```

Extend that smoke test for read-only history/chart/doctor behavior. Test deployed
mutations and cache invalidation only with an explicit synthetic test account,
and delete only records created by that test. Worker logs must identify the test
date and outcome without exposing patient measurements.

Completion means every in-scope task is implemented and verified, with evidence
for each bonus. Local verification, provider verification, deployment, and hosted
worker operation are separate statuses. Writing a plan alone is not completion
evidence. A local worker demonstration is sufficient unless always-on hosting
is separately selected; real Upstash connectivity must still be verified.

## Provider setup status

| Item                                                     | Purpose                               | When needed                         |
| -------------------------------------------------------- | ------------------------------------- | ----------------------------------- |
| Existing Neon pooled URL                                 | API and worker database traffic       | Configured; production verified     |
| Neon direct URL and development branch                   | Migration rehearsal and deployment    | Rehearsal/production verified       |
| Upstash REST URL and standard token                      | Report-cache reads/writes             | Production configured; O07/O13 pass |
| Upstash TCP/TLS connection URL                           | BullMQ connections                    | Configured locally; O12 passes      |
| Unique cache namespace and queue prefix                  | Separate databases/environments/tests | Before any Redis writes             |
| Worker host and budget, if always-on operation is wanted | Continuous reminders                  | Before hosted-worker deployment     |

No paid resource or upgraded plan is assumed. A temporary unclaimed Upstash
database expires and cannot be counted as a durable deployment. Keep provider
credentials out of chat and version control.

## Completion and operations

O00-O13 are verified. The staged production API, browser, and cache journeys
passed before promotion; the public canonical URL then passed the same checks
without a protection credential. See [verification.md](verification.md) for the
deployed source, requirement evidence, cleanup, and operational limits.

The previous healthy deployment remains available for rollback. Cache disablement
or worker shutdown does not remove PostgreSQL reading data. Run the native worker
when demonstrating reminders. If always-on hosting is later selected, configure
that host and its budget separately; no such host is running now. Docker remains
excluded. The implementation is on `feat/optional-features`; the verification
record identifies the exact worktree inputs used by the earlier deployment.

## Sources checked for this plan

- [Original assignment email](https://mail.google.com/mail/u/?authuser=vaibhavsuman5%40gmail.com#all/1a1af2980425f852): bonus scope and delivery requirements.
- Repository: `README.md`, `package.json`, `client/main.jsx`, `server/app.js`,
  `server/database.js`, `server/dates.js`, `api/index.js`, `db/001_initial.sql`,
  and the API/browser/session/database-guard tests.
- [Upstash TypeScript SDK](https://upstash.com/docs/redis/sdks/ts/overview),
  [timeouts](https://upstash.com/docs/redis/sdks/ts/advanced), and
  [retries](https://upstash.com/docs/redis/sdks/ts/retries): serverless cache client.
- [BullMQ with Upstash](https://upstash.com/docs/redis/integrations/bullmq):
  TCP/TLS configuration, compatibility, and idle-command billing.
- [Upstash eviction](https://upstash.com/docs/redis/features/eviction) and
  [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production):
  keep eviction disabled for queue state.
- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers/) and
  [connections](https://docs.bullmq.io/guide/connections): scheduling and worker lifecycle.
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
  and [Recharts accessibility](https://github.com/recharts/recharts/blob/main/storybook/stories/API/Accessibility.mdx): UI testing and chart behavior.

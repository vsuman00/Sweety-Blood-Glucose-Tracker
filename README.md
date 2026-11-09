# Sweety – Blood Glucose Tracker

A private glucose journal built for the Kenpath take-home assignment with React, Node.js/Express and PostgreSQL. Users can register, log in, manage readings and review daily and calendar-month summaries.

![Sweety dashboard with synthetic readings](docs/screenshots/dashboard.png)

## Assignment coverage

The required application features and local delivery materials are implemented. The following checklist describes the application; employer submission remains a separate step.

| Requirement                           | Local implementation                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React, Node.js/Express and PostgreSQL | React client, Express API, SQL migration and PostgreSQL session store                                                                                              |
| Registration, login and private data  | Name/email/password registration, bcrypt hashes and user-scoped queries                                                                                            |
| Reading CRUD                          | Create, view, edit and delete date, meal slot and glucose value in mg/dl                                                                                           |
| Reading rules                         | Four named slots, whole numbers from 40 to 600, no future dates, duplicate prevention and at most four per day; edits use the same validation                      |
| Concurrency and errors                | Database uniqueness, version checks for stale changes and readable errors                                                                                          |
| Reports                               | Daily, selected-date month-to-date and full previous-calendar-month summaries; highest, lowest, one-decimal average and count; daily reading list and empty states |
| Data setup                            | Numbered migration, repeatable synthetic seed, two demo accounts and secret-free `.env.example`                                                                    |
| Documentation and demonstration       | Setup/test instructions, date assumptions, possible improvements and desktop/login/mobile screenshots                                                              |
| Version history                       | Incremental local commits for features, fixes, tests and documentation                                                                                             |

Verification commands and their coverage are described below. Screenshots satisfy the assignment's screenshots-or-demo option; a separate video is not required.

## Run locally

Requires Node.js 22.12 or newer, npm, and a running PostgreSQL server (tested locally with PostgreSQL 17). No MongoDB or hosted services are required.

```sh
npm ci
createdb sweety
createdb sweety_test
cp .env.example .env
```

Edit `.env`: set both database URLs for your PostgreSQL user, and replace `SESSION_SECRET` with a random value of at least 32 characters. Generate one with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The example URLs use localhost and port 5432. Adapt the username, password and port to your installation. Keep `.env` private; only `.env.example` belongs in Git.

```sh
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001. Use this exact browser origin; state-changing API requests require an Origin header matching `APP_ORIGIN`. Vite proxies `/api` to Express and fails clearly if port 5173 is occupied, keeping the browser origin consistent. Stop the app with Ctrl+C. You can also run the API and client in separate terminals with `npm run dev:api` and `npm run dev:client`.

Synthetic demo accounts:

| Email                | Password           |
| -------------------- | ------------------ |
| `demo@example.test`  | `Sweety-demo-2026` |
| `other@example.test` | `Sweety-demo-2026` |

Seed data includes today, the first day of this month, and the previous month. Seeding again leaves existing demo accounts and their data unchanged. These credentials are public synthetic examples, not secrets. Do not use real health data for the demonstration.

For a local production build:

```sh
npm run build
# Set APP_ORIGIN=http://127.0.0.1:3001 in .env for this local check.
npm start
```

Open http://127.0.0.1:3001. Express serves the built client. Restore `APP_ORIGIN` to port 5173 before using the Vite development server again.

## Deploy to Vercel and Neon

The Neon project is named **Sweety-Blood Glucose Tracker**. Vercel requires a lowercase name without spaces, so its project is **sweety-blood-glucose-tracker**. The API and database use Singapore regions.

Vercel builds the React client with `npm run build` and serves `dist/`. Its install command includes development dependencies so Vite is available when `NODE_ENV=production`. The `vercel.json` rewrite routes all `/api` paths to `api/index.js`, which exposes the existing Express API with a shared PostgreSQL pool attached to Vercel's function lifecycle. Local development still uses `server/index.js`.

Set these variables in Vercel's Production environment:

| Variable         | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`   | Neon's pooled connection URL, including its SSL parameters |
| `SESSION_SECRET` | A private random value of at least 32 characters           |
| `APP_ORIGIN`     | `https://sweety-blood-glucose-tracker-tan.vercel.app`      |
| `NODE_ENV`       | `production`                                               |

Keep database credentials and the session secret on the server; never prefix them with `VITE_`. Set `APP_ORIGIN` to the exact browser origin, without a trailing slash. Changing the domain requires updating this value and redeploying. Production cookies require HTTPS; Express trusts one reverse proxy.

Run schema migrations manually with Neon's **direct** connection URL in an ignored `.env.production.local` file:

```sh
node --env-file=.env.production.local scripts/migrate.js
# Optional synthetic demo accounts and readings:
node --env-file=.env.production.local scripts/seed.js
```

Do not run the test suites against production. Preview deployments need a separate database and an `APP_ORIGIN` matching their browser origin. Production credentials are not configured for previews. For migrations on an existing database, verify the change on a Neon branch before applying it to production.

After deployment, verify registration, login, session persistence after refresh, reading creation/editing/deletion, reports and logout over HTTPS. The in-memory authentication rate limiter applies per function instance, so it does not provide a shared limit across instances. Expired-session cleanup remains an operational follow-up.

Run the deployment smoke check against the seeded demo deployment:

```sh
npm run test:deployment -- https://sweety-blood-glucose-tracker-tan.vercel.app
```

This check reads the synthetic demo account's data and tests login, secure cookies, nested API routing, Origin rejection and logout. It does not change readings.

## Verification

```sh
npm test
npm run build
npm run test:browser
npm run format:check
```

API tests use real PostgreSQL. **They truncate users, readings and sessions in `TEST_DATABASE_URL`**, which must be a separate database with a name ending in `_test`. Both database URLs must be set. The shared guard parses their database names through the PostgreSQL driver and rejects matching names even when the hosts, ports, credentials or connection options differ. Use different database names even across separate servers. Never point the test URL at data you need. Browser tests use that test database, serve the built client on port 3002 and remove their temporary account. Run the API and browser suites sequentially. The browser command also runs a separate mocked session-expiry suite on port 3003 without database access.

The browser test uses an installed Google Chrome through Playwright; no running development server is needed. If Chrome is unavailable, install it before running that optional local browser check. The API tests and production build do not require Chrome.

The tests cover authentication, bcrypt storage, normalized email uniqueness, logout, Origin checks, two-user isolation, boundary and invalid values, invalid/future dates, create/edit validation, four-slot limits, duplicate races, stale edit/delete conflicts, empty reports, calendar boundaries and rounding. The browser journey covers registration, an empty day, creation, duplicate errors, editing, deletion, mobile overflow, decimal display and logout. Database constraint tests also bypass the API to check enforcement. Additional regressions cover oversized reading versions, clearing old account state after session expiry during save/delete, delayed account switching, and restoring keyboard focus after closing the delete dialog.

## Design and API

`client/` contains the React dashboard and forms. `server/` contains Express routes, validation, calendar helpers and parameterized SQL. `db/` contains the initial migration; `scripts/` contains migration and synthetic seed runners. There is one API and one PostgreSQL database.

The database contains users, readings and server-side sessions. Passwords use bcrypt cost 12. Session IDs are in HttpOnly, SameSite=Lax cookies; cookies become Secure in production. Login regenerates the session ID. Login and registration share a per-IP attempt limit. Every reading operation and aggregate query filters by the session's user ID. Client-supplied ownership fields have no effect. Another user's reading ID returns 404.

| Method | Endpoint                        | Input or result                                       |
| ------ | ------------------------------- | ----------------------------------------------------- |
| POST   | `/api/auth/register`            | `{name,email,password}`; creates account, returns 201 |
| POST   | `/api/auth/login`               | `{email,password}`; establishes session               |
| GET    | `/api/auth/me`                  | Public account fields, server today, timezone         |
| POST   | `/api/auth/logout`              | `{}`; destroys session                                |
| GET    | `/api/readings?date=YYYY-MM-DD` | Owned readings in meal-slot order                     |
| POST   | `/api/readings`                 | `{date,slot,value}`                                   |
| PUT    | `/api/readings/:id`             | `{date,slot,value,version}`                           |
| DELETE | `/api/readings/:id`             | `{version}`                                           |
| GET    | `/api/reports?date=YYYY-MM-DD`  | `daily`, `monthToDate`, `previousMonth`               |

Reading responses contain `id`, `date`, `slot`, `value` and `version`. API values must be JSON numbers. Slot codes are `morning_fasting`, `after_breakfast`, `after_lunch` and `after_dinner`. Each report includes `start`, exclusive `end`, `highest`, `lowest`, `average`, `count` and `readings` (daily only has populated readings).

Errors use `{error:{code,message,fields?}}`: 400 for validation, 401 for authentication, 403 for rejected Origin, 404 for unavailable records, 409 for conflicts and 429 for excessive authentication attempts.

Reading validation uses rule-specific messages in the API and form:

| Rule                             | Feedback                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Missing value                    | Please enter a glucose value.                                                                |
| Fraction or value outside 40–600 | Value must be a whole number between 40 and 600 mg/dl.                                       |
| Duplicate slot                   | Names the occupied slot, for example: You already have an After lunch reading for this date. |
| Creating a reading on a full day | You can add only 4 readings per day.                                                         |
| Future date                      | Date cannot be in the future.                                                                |

The database rejects conflicting writes before the API selects a duplicate-slot or full-day message. Editing an existing reading on a full day remains allowed; moving it into an occupied slot returns the slot-specific error. Failed validation and conflicts preserve the existing data. Browser checks cover these messages, successful correction after an error, and full-day edits.

A database unique constraint on `(user_id, reading_date, slot)` resolves concurrent duplicates. Four allowed slots plus uniqueness enforce the maximum of four per day. Version-conditional updates and deletes prevent stale tabs from overwriting newer data. Duplicate edits leave the original row unchanged; stale edits prompt a reload. All three report summaries are computed in one SQL statement for a consistent snapshot.

## Notes

Employer requirements are registration/login, private CRUD, four slots, integer glucose from 40 to 600 mg/dl, no future dates, duplicate prevention, daily/month reports, clear errors and submission materials. PostgreSQL takes precedence over the email's ambiguous "MERN + PostgreSQL" wording.

Implementation choices:

- All calendar dates use **Asia/Kolkata**, including server-side future-date validation. Reading dates remain PostgreSQL `DATE` strings, without UTC conversion. Audit timestamps use `timestamptz`.
- Month-to-date runs from the selected month's first day through the selected date. Previous month means the full preceding calendar month, including across January/year boundaries. Future report dates are rejected.
- Dates before 1900 are unsupported. Passwords require at least eight characters and at most 72 UTF-8 bytes to avoid bcrypt truncation; names are limited to 100 characters. Emails are trimmed and lowercased.
- Averages use PostgreSQL numeric rounding once, to one decimal (positive halfway values round up). The UI retains trailing `.0`. Empty summaries have count zero and null statistics; the UI shows dashes and a friendly message.
- Sessions expire after 24 hours. The default session store pruning is disabled; expired sessions are rejected but retained. Scheduled cleanup is a future operational task.
- Screenshots satisfy the screenshots-or-demo requirement. They show synthetic data. No diagnosis, glucose classification or medical recommendations are generated.

Possible improvements: password reset and email verification, per-user timezone settings, automated accessibility checks, CI, expired-session cleanup, structured operational logging and deployment hardening. The current login rate limiter is in memory and the production proxy setting assumes one trusted proxy. Review both before hosting. Google Fonts is optional; system fallbacks keep the interface usable offline.

## Submission materials

- [Desktop dashboard](docs/screenshots/dashboard.png)
- [Login screen](docs/screenshots/login.png)
- [Mobile dashboard](docs/screenshots/mobile.png)
- Setup, test instructions, assumptions and improvements: this README
- Configuration placeholders: `.env.example`; synthetic seed: `scripts/seed.js`

Commits record implementation checkpoints, fixes and deployment configuration. Employer submission is a separate step and is not performed by the application.

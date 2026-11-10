# Doctor access contract

Status: implementation contract for O08-O10. Based on the approved optional-feature plan.

Public registration always creates a patient, ignoring client-supplied roles and
ownership fields. Existing accounts migrate to patient. A trusted operator uses
the server-side access command to promote an existing account and manage explicit
doctor-patient assignments. Credentials for that command belong to the operator;
there is no public administrative API.

## Roles and assignments

- A user has exactly one role: patient or doctor.
- Patients retain private reading CRUD and their own reports.
- Doctors use assigned-patient reports and do not mutate readings.
- Assignment requires a doctor account and a different patient account. A pair
  occurs at most once. A patient may have multiple assigned doctors.
- Role changes remove all assignments involving that account in the same
  transaction. Account/role rows are locked in ID order when assigning to prevent
  races with role changes. Existing readings are retained when a role changes.
- Each protected request checks the current account role. Each doctor report
  request checks the current assignment before accessing cached or uncached data.
- Revoking access blocks subsequent requests. Requests already in flight may
  finish; no cross-request authorization decision is cached.

## Commands

```sh
npm run access -- role --email doctor@example.test --role doctor
npm run access -- assign --doctor doctor@example.test --patient demo@example.test
npm run access -- unassign --doctor doctor@example.test --patient demo@example.test
```

The commands act on the database named by their server environment. Parse and
validate all options before opening a database connection. `--help` has no side
effects. Unknown/repeated flags, invalid roles, missing accounts, duplicate pairs,
and nonexistent assignments return a readable error and nonzero exit code.

## API

| Method and path                                                     | Result                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /api/auth/me`                                                  | Existing fields plus `user.role`                                  |
| `GET /api/doctor/patients?page=1&limit=20`                          | `{patients:[{id,name}],pagination:{page,limit,total,totalPages}}` |
| `GET /api/doctor/patients/:patientId/reports?date=YYYY-MM-DD`       | Existing daily/month-to-date/previous-month report structure      |
| `GET /api/doctor/patients/:patientId/reports/monthly?month=YYYY-MM` | Existing monthly chart structure                                  |

Pagination follows the reading-history limits and validation. Patient lists sort
by name and ID. Responses expose only assigned patient IDs/names and the requested
measurements; they never expose passwords or other patients' identities.

Return 401 for missing/expired sessions, 403 for a wrong role, and the same 404
for malformed, nonexistent, or unassigned patient IDs. An authorized request with
an invalid date/month returns 400. No doctor mutation route exists. A patient
cannot elevate their role by editing a request, cookie, query, or request body.

## Dashboard and test matrix

Doctors receive an assigned-patient selector, daily report, monthly summaries,
and monthly chart/table. There are no reading-mutation controls. Clear old patient
data before switching, logging out, or rendering an access error. Ignore delayed
responses after patient/account changes.

Verify anonymous, patient, assigned doctor, different doctor, revoked assignment,
role downgrade, missing patient, and malformed IDs. Repeat authorization tests
after warming caches. Browser tests include a doctor with no assignments and an
assigned doctor; the existing patient CRUD journey must still pass.

Synthetic demo: `doctor@example.test` uses the existing public demo password,
views `demo@example.test`, and cannot view `other@example.test`. Repeat seeding
must preserve existing accounts, roles, and readings rather than overwrite them.

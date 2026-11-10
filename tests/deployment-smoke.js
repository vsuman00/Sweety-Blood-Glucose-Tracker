import assert from "node:assert/strict";

const origin = new URL(process.argv[2]).origin;
const appOrigin = process.env.DEPLOYMENT_APP_ORIGIN || origin;
assert.equal(
  new URL(origin).protocol,
  "https:",
  "Use an HTTPS deployment URL.",
);
const fetchDeployment = (path, options = {}) => {
  const url = new URL(path, origin);
  assert.equal(
    url.origin,
    origin,
    "Deployment requests must stay on the selected origin.",
  );
  const headers = { ...options.headers };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
    headers["x-vercel-protection-bypass"] =
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (process.env.VERCEL_OIDC_TOKEN)
    headers["x-vercel-trusted-oidc-idp-token"] = process.env.VERCEL_OIDC_TOKEN;
  return fetch(url, { ...options, headers, redirect: "manual" });
};
const api = (path, options = {}) => fetchDeployment(`/api${path}`, options);
assert.equal((await fetchDeployment("/")).status, 200, "Deployment homepage");
assert.equal((await api("/auth/me")).status, 401, "Guest API routing");

let cookie;
try {
  const login = await api("/auth/login", {
    method: "POST",
    headers: { Origin: appOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "demo@example.test",
      password: "Sweety-demo-2026",
    }),
  });
  assert.equal(login.status, 200, "Synthetic demo login");
  const session = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("sweety.sid="));
  assert(session, "Session cookie");
  cookie = session.split(";")[0];
  assert.match(session, /;\s*HttpOnly/i);
  assert.match(session, /;\s*Secure/i);
  assert.match(session, /;\s*SameSite=Lax/i);
  const me = await api("/auth/me", { headers: { Cookie: cookie } });
  assert.equal(me.status, 200, "Authenticated API routing");
  const { today, user } = await me.json();
  assert.equal(user.role, "patient", "Demo patient role");
  for (const path of [
    `/readings?date=${today}`,
    `/reports?date=${today}`,
    "/readings?page=1&limit=20",
    `/reports/monthly?month=${today.slice(0, 7)}`,
  ]) {
    const response = await api(path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, path);
    await response.json();
  }
  assert.equal(
    (await api("/doctor/patients", { headers: { Cookie: cookie } })).status,
    403,
    "Patients cannot access doctor routes",
  );
  const untrusted = await api("/readings", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(untrusted.status, 403, "Origin protection");
} finally {
  if (cookie) {
    const logout = await api("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: appOrigin,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(logout.status, 204, "Logout");
    assert.equal(
      (await api("/auth/me", { headers: { Cookie: cookie } })).status,
      401,
      "Session invalidated",
    );
  }
}
let doctorCookie;
try {
  const login = await api("/auth/login", {
    method: "POST",
    headers: { Origin: appOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "doctor@example.test",
      password: "Sweety-demo-2026",
    }),
  });
  assert.equal(login.status, 200, "Synthetic doctor login");
  doctorCookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("sweety.sid="))
    .split(";")[0];
  assert.equal((await login.json()).user.role, "doctor", "Doctor role");
  const assigned = await api("/doctor/patients?page=1&limit=20", {
    headers: { Cookie: doctorCookie },
  });
  assert.equal(assigned.status, 200, "Assigned patient list");
  const { patients } = await assigned.json();
  assert.ok(patients.length > 0, "Seeded doctor assignment");
  const current = await api("/auth/me", { headers: { Cookie: doctorCookie } });
  const { today } = await current.json();
  for (const path of [
    `/doctor/patients/${patients[0].id}/reports?date=${today}`,
    `/doctor/patients/${patients[0].id}/reports/monthly?month=${today.slice(0, 7)}`,
  ])
    assert.equal(
      (await api(path, { headers: { Cookie: doctorCookie } })).status,
      200,
      path,
    );
  assert.equal(
    (await api("/readings?page=1", { headers: { Cookie: doctorCookie } }))
      .status,
    403,
    "Doctor cannot access patient CRUD",
  );
} finally {
  if (doctorCookie)
    assert.equal(
      (
        await api("/auth/logout", {
          method: "POST",
          headers: {
            Cookie: doctorCookie,
            Origin: appOrigin,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      204,
      "Doctor logout",
    );
}
console.log(
  "Deployment passed: homepage, secure sessions, readings, reports, pagination, chart data, assigned doctor reports, role/origin protection and logout.",
);

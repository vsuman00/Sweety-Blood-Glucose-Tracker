import assert from "node:assert/strict";

const origin = new URL(process.argv[2]).origin;
assert.equal(
  new URL(origin).protocol,
  "https:",
  "Use an HTTPS deployment URL.",
);
const api = (path, options = {}) => fetch(`${origin}/api${path}`, options);
assert.equal((await fetch(origin)).status, 200, "Public homepage");
assert.equal((await api("/auth/me")).status, 401, "Guest API routing");

let cookie;
try {
  const login = await api("/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
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
  const { today } = await me.json();
  for (const path of [`/readings?date=${today}`, `/reports?date=${today}`]) {
    const response = await api(path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, path);
    await response.json();
  }
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
        Origin: origin,
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
console.log(
  "Deployment passed: homepage, nested API routes, demo login, secure session, readings, reports, origin protection and logout.",
);

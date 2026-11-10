import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { slots } from "./constants.js";
import { ReadingForm } from "./components/ReadingForm.jsx";
import { ReadingHistory } from "./components/ReadingHistory.jsx";
import { ReportPanels } from "./components/ReportPanels.jsx";
import { DoctorDashboard } from "./components/DoctorDashboard.jsx";
import { MonthlyChart } from "./components/MonthlyChart.jsx";
const localToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "same-origin",
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error?.message || "Request failed. Please try again."),
      { ...data.error, status: response.status },
    );
  return data;
}
const send = (method, body) => ({ method, body: JSON.stringify(body) });
function App() {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    [register, setRegister] = useState(false);
  const [auth, setAuth] = useState({ name: "", email: "", password: "" }),
    [authError, setAuthError] = useState(null),
    [busy, setBusy] = useState(false);
  const [maxDate, setMaxDate] = useState(localToday()),
    [date, setDate] = useState(localToday());
  const [reports, setReports] = useState(null),
    [loadError, setLoadError] = useState(null),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState({
      date: localToday(),
      slot: "morning_fasting",
      value: "",
    }),
    [editing, setEditing] = useState(null),
    [formError, setFormError] = useState(null),
    [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(null);
  function clearSessionState(error = null) {
    setUser(null);
    setReports(null);
    setEditing(null);
    setDeleting(null);
    setForm({ date: maxDate, slot: "morning_fasting", value: "" });
    setFormError(null);
    setLoadError(null);
    setNotice("");
    setLoading(false);
    setAuth({ name: "", email: "", password: "" });
    setRegister(false);
    setAuthError(error);
  }
  function sessionExpired() {
    clearSessionState(new Error("Your session expired. Please log in again."));
  }
  useEffect(() => {
    api("/auth/me")
      .then((data) => {
        setUser(data.user);
        setMaxDate(data.today);
        setDate(data.today);
        setForm((f) => ({ ...f, date: data.today }));
      })
      .catch((error) => {
        if (error.status !== 401) setAuthError(error);
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!user || user.role === "doctor") return;
    let active = true;
    setLoading(true);
    setReports(null);
    setLoadError(null);
    api(`/reports?date=${date}`)
      .then((data) => {
        if (active) setReports(data);
      })
      .catch((error) => {
        if (active) {
          setLoadError(error);
          if (error.status === 401) sessionExpired();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, date, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      setMaxDate(localToday());
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!editing) setForm((f) => ({ ...f, date }));
  }, [date, editing]);
  const resetForm = () => {
    setEditing(null);
    setForm({ date, slot: "morning_fasting", value: "" });
    setFormError(null);
  };
  async function authenticate(event) {
    event.preventDefault();
    setBusy(true);
    setAuthError(null);
    try {
      if (register) await api("/auth/register", send("POST", auth));
      await api("/auth/login", send("POST", auth));
      const me = await api("/auth/me");
      clearSessionState();
      setUser(me.user);
      setMaxDate(me.today);
      setDate(me.today);
      setForm({ date: me.today, slot: "morning_fasting", value: "" });
    } catch (error) {
      setAuthError(error);
    } finally {
      setBusy(false);
    }
  }
  async function save(payload) {
    setBusy(true);
    setFormError(null);
    setNotice("");
    try {
      await api(
        editing ? `/readings/${editing.id}` : "/readings",
        send(editing ? "PUT" : "POST", payload),
      );
      setNotice(editing ? "Reading updated." : "Reading added.");
      setDate(form.date);
      setEditing(null);
      setForm({ ...form, value: "" });
      setRefresh((n) => n + 1);
    } catch (error) {
      setFormError(error);
      if (error.status === 401) sessionExpired();
    } finally {
      setBusy(false);
    }
  }
  async function remove(reading) {
    setBusy(true);
    setNotice("");
    setFormError(null);
    try {
      await api(
        `/readings/${reading.id}`,
        send("DELETE", { version: reading.version }),
      );
      setDeleting(null);
      if (editing?.id === reading.id) resetForm();
      setNotice("Reading deleted.");
      setRefresh((n) => n + 1);
    } catch (error) {
      setFormError(error);
      setDeleting(null);
      if (error.status === 401) sessionExpired();
    } finally {
      setBusy(false);
    }
  }
  function edit(reading) {
    setEditing(reading);
    setForm({ ...reading, value: String(reading.value) });
    setFormError(null);
    setNotice("");
    document.getElementById("reading-value")?.focus();
  }
  if (!ready)
    return (
      <main className="shell">
        <p role="status">Opening your journal...</p>
      </main>
    );
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Sweety home">
          <span className="brand-icon" aria-hidden="true">
            s
          </span>
          sweety<span className="brand-dot">.</span>
        </a>
        <span className="top-caption">YOUR DAILY GLUCOSE JOURNAL</span>
        {user && (
          <button
            className="quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/auth/logout", send("POST", {}));
                clearSessionState();
              } catch (error) {
                setLoadError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            Log out
          </button>
        )}
      </header>
      {!user ? (
        <main className="auth-layout">
          <section className="auth-intro">
            <p className="eyebrow">A LITTLE CHECK-IN, EVERY DAY</p>
            <h1>
              Small readings.
              <br />A clearer picture.
            </h1>
            <p>Keep your glucose readings together, one day at a time.</p>
            <div className="intro-note">
              <span aria-hidden="true">✳</span> Four moments. One simple
              journal.
            </div>
          </section>
          <section className="panel auth-panel">
            <p className="eyebrow">WELCOME TO SWEETY</p>
            <h2>{register ? "Start your journal" : "Welcome back"}</h2>
            <p className="muted">
              {register
                ? "Create an account to keep your readings private."
                : "Log in to pick up where you left off."}
            </p>
            <ErrorBox error={authError} />
            <form onSubmit={authenticate}>
              {register && (
                <label>
                  Name
                  <input
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={auth.name}
                    onChange={(e) => setAuth({ ...auth, name: e.target.value })}
                  />
                </label>
              )}
              <label>
                Email
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={auth.email}
                  onChange={(e) => setAuth({ ...auth, email: e.target.value })}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={register ? "new-password" : "current-password"}
                  value={auth.password}
                  onChange={(e) =>
                    setAuth({ ...auth, password: e.target.value })
                  }
                />
              </label>
              {register && (
                <p className="hint">
                  At least 8 characters; no more than 72 UTF-8 bytes.
                </p>
              )}
              <button className="primary full" disabled={busy}>
                {busy
                  ? "Please wait..."
                  : register
                    ? "Create account"
                    : "Log in"}
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setAuthError(null);
              }}
            >
              {register
                ? "Already have an account? Log in"
                : "New here? Create an account"}
            </button>
          </section>
        </main>
      ) : user.role === "doctor" ? (
        <main className="shell">
          <h1>Hello, {user.name}.</h1>
          <p className="muted">Assigned patient reports · Read-only access</p>
          <DoctorDashboard
            key={user.id}
            api={api}
            date={date}
            maxDate={maxDate}
            onDateChange={setDate}
            onSessionExpired={sessionExpired}
          />
        </main>
      ) : (
        <main className="shell">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR HEALTH, ONE DAY AT A TIME</p>
              <h1>Hello, {user.name}.</h1>
              <p className="muted">A simple place for your daily readings.</p>
            </div>
            <label className="date-picker">
              Selected date
              <input
                aria-label="Selected date"
                type="date"
                min="1900-01-01"
                max={maxDate}
                value={date}
                onChange={(e) => {
                  if (e.target.value) {
                    setDate(e.target.value);
                    setNotice("");
                  }
                }}
              />
              <span className="hint">All dates use Asia/Kolkata (IST)</span>
            </label>
          </div>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {loadError && (
            <>
              <ErrorBox error={loadError} />
              <button onClick={() => setRefresh((n) => n + 1)}>
                Retry loading
              </button>
            </>
          )}
          <div className="dashboard">
            <section className="panel entry-panel">
              <p className="eyebrow">
                {editing ? "MAKE A CORRECTION" : "A MOMENT TO CHECK IN"}
              </p>
              <h2>{editing ? "Edit reading" : "Add a reading"}</h2>
              <p className="muted small">
                One reading per meal slot, up to four a day.
              </p>
              <ErrorBox error={formError} />
              {formError?.code === "STALE_VERSION" && (
                <button
                  onClick={() => {
                    setRefresh((n) => n + 1);
                    resetForm();
                  }}
                >
                  Reload latest data
                </button>
              )}
              <ReadingForm
                form={form}
                onChange={setForm}
                maxDate={maxDate}
                editing={editing}
                busy={busy}
                onSave={save}
                onCancel={resetForm}
              />
              <div className="privacy-note">
                Your readings are private to your account.
              </div>
            </section>
            <div className="report-area" aria-busy={loading}>
              {loading && <p role="status">Loading your readings...</p>}
              <ReportPanels
                reports={reports}
                date={date}
                busy={busy}
                onEdit={edit}
                onDelete={setDeleting}
              />
            </div>
          </div>
          <MonthlyChart
            key={`chart-${user.id}`}
            api={api}
            month={date.slice(0, 7)}
            refresh={refresh}
            onSessionExpired={sessionExpired}
          />
          <ReadingHistory
            key={user.id}
            api={api}
            refresh={refresh}
            onSessionExpired={sessionExpired}
          />
          <footer>
            Made for everyday tracking. All glucose values are in mg/dl.
          </footer>
          {deleting && (
            <DeleteDialog close={() => setDeleting(null)} busy={busy}>
              <h2 id="delete-title">Delete this reading?</h2>
              <p>
                {slots[deleting.slot]} on {deleting.date}: {deleting.value}{" "}
                mg/dl.
              </p>
              <p className="muted">This cannot be undone.</p>
              <div className="row-actions">
                <button disabled={busy} onClick={() => setDeleting(null)}>
                  Keep reading
                </button>
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() => remove(deleting)}
                >
                  Delete reading
                </button>
              </div>
            </DeleteDialog>
          )}
        </main>
      )}
    </>
  );
}
function DeleteDialog({ children, close, busy }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = ref.current;
    element.querySelector("button")?.focus();
    function keydown(event) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const buttons = [...element.querySelectorAll("button:not(:disabled)")];
        if (!buttons.length) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons.at(-1).focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === buttons.at(-1)
        ) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    }
    element.addEventListener("keydown", keydown);
    return () => {
      element.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [busy]);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        className="panel dialog"
      >
        {children}
      </section>
    </div>
  );
}
function ErrorBox({ error }) {
  return error ? (
    <div className="error" role="alert">
      <p>{error.message}</p>
      {error.fields && (
        <ul>
          {Object.entries(error.fields).map(([field, message]) => (
            <li key={field}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  ) : null;
}
createRoot(document.getElementById("root")).render(<App />);

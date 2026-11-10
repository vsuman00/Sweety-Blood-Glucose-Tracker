import React, { useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { slots } from "../constants.js";

export function chartRows(report) {
  const values = new Map(
    report.readings.map((reading) => [
      `${reading.date}:${reading.slot}`,
      reading.value,
    ]),
  );
  const rows = [];
  for (
    const day = new Date(`${report.start}T00:00:00Z`);
    day.toISOString().slice(0, 10) < report.end;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const date = day.toISOString().slice(0, 10);
    rows.push({
      date,
      ...Object.fromEntries(
        Object.keys(slots).map((slot) => [
          slot,
          values.get(`${date}:${slot}`) ?? null,
        ]),
      ),
    });
  }
  return rows;
}

export function MonthlyChart({
  api,
  month,
  refresh,
  onSessionExpired,
  basePath = "/reports",
  onAccessError,
}) {
  const [entry, setEntry] = useState(null),
    [error, setError] = useState(null),
    [retry, setRetry] = useState(0);
  const key = `${basePath}:${month}:${refresh}:${retry}`;
  const data = entry?.key === key ? entry.data : null;
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;
  const accessError = useRef(onAccessError);
  accessError.current = onAccessError;
  useEffect(() => {
    let active = true;
    setEntry(null);
    setError(null);
    api(`${basePath}/monthly?month=${month}`)
      .then((data) => {
        if (active) setEntry({ key, data });
      })
      .catch((error) => {
        if (!active) return;
        setError(error);
        if (error.status === 401) expired.current();
        if (error.status === 403 || error.status === 404)
          accessError.current?.(error);
      });
    return () => {
      active = false;
    };
  }, [api, month, refresh, basePath, retry, key]);
  const rows = data ? chartRows(data) : [];
  return (
    <section className="panel chart-panel" aria-busy={!data && !error}>
      <h2>Monthly glucose chart</h2>
      <p className="muted">
        {month} · mg/dl · Missing readings appear as gaps.
      </p>
      {error ? (
        <>
          <p className="error" role="alert">
            {error.message}
          </p>
          <button onClick={() => setRetry((n) => n + 1)}>Retry chart</button>
        </>
      ) : !data ? (
        <p role="status">Loading chart...</p>
      ) : !data.readings.length ? (
        <p>No readings in this month yet.</p>
      ) : (
        <>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart
                data={rows}
                title={`Glucose readings for ${month}`}
                margin={{ top: 15, right: 15, left: 5, bottom: 15 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => value.slice(8)}
                />
                <YAxis width={45} domain={["auto", "auto"]} />
                <Tooltip />
                <Legend />
                {Object.entries(slots).map(([slot, label], index) => (
                  <Line
                    key={slot}
                    name={label}
                    dataKey={slot}
                    type="linear"
                    stroke={["#38664b", "#a45b3e", "#406f98", "#856195"][index]}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details>
            <summary>View monthly readings table</summary>
            <div className="table-scroll">
              <table>
                <caption>Monthly glucose readings in mg/dl</caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    {Object.entries(slots).map(([slot, label]) => (
                      <th key={slot}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      {Object.keys(slots).map((slot) => (
                        <td key={slot}>{row[slot] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

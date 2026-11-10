import React, { useEffect, useRef, useState } from "react";
import { slots } from "../constants.js";

export function ReadingHistory({ api, refresh, onSessionExpired }) {
  const [page, setPage] = useState(1),
    [limit, setLimit] = useState(20);
  const [entry, setEntry] = useState(null),
    [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const requestKey = `${page}:${limit}:${refresh}:${retry}`;
  const data = entry?.key === requestKey ? entry.result : null;
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;
  useEffect(() => {
    let active = true;
    setEntry(null);
    setError(null);
    api(`/readings?page=${page}&limit=${limit}`)
      .then((result) => {
        if (!active) return;
        const lastPage = Math.max(1, result.pagination.totalPages);
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setEntry({ key: requestKey, result });
      })
      .catch((error) => {
        if (!active) return;
        setError(error);
        if (error.status === 401) expired.current();
      });
    return () => {
      active = false;
    };
  }, [api, page, limit, refresh, retry, requestKey]);
  return (
    <section className="panel history-panel" aria-busy={!data && !error}>
      <div className="section-heading">
        <h2>Reading history</h2>
        <label>
          History page size
          <select
            value={limit}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              setPage(1);
            }}
          >
            {[20, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <>
          <p className="error" role="alert">
            {error.message}
          </p>
          <button onClick={() => setRetry((n) => n + 1)}>Retry history</button>
        </>
      ) : !data ? (
        <p role="status">Loading history...</p>
      ) : (
        <>
          {!data.readings.length ? (
            <p>No readings in your history yet.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">
                  Your recorded glucose readings
                </caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Meal slot</th>
                    <th>Glucose</th>
                  </tr>
                </thead>
                <tbody>
                  {data.readings.map((reading) => (
                    <tr key={reading.id}>
                      <td>{reading.date}</td>
                      <td>{slots[reading.slot]}</td>
                      <td>{reading.value} mg/dl</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Page {page} of {Math.max(1, data.pagination.totalPages)} ·{" "}
            {data.pagination.total} readings
          </p>
          <div className="row-actions">
            <button disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
              Previous page
            </button>
            <button
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((n) => n + 1)}
            >
              Next page
            </button>
          </div>
        </>
      )}
    </section>
  );
}

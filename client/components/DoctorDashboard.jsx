import React, { useEffect, useRef, useState } from "react";
import { ReportPanels } from "./ReportPanels.jsx";
import { MonthlyChart } from "./MonthlyChart.jsx";

export function DoctorDashboard({
  api,
  date,
  maxDate,
  onDateChange,
  onSessionExpired,
}) {
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [list, setList] = useState(null),
    [listError, setListError] = useState(null);
  const [patientId, setPatientId] = useState("");
  const [entry, setEntry] = useState(null),
    [error, setError] = useState(null),
    [retry, setRetry] = useState(0);
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;
  const key = `${patientId}:${date}:${refresh}:${retry}`;
  const reports = entry?.key === key ? entry.reports : null;
  const patients = list?.patients || [];
  const selected = patients.find((patient) => String(patient.id) === patientId);
  useEffect(() => {
    let active = true;
    setList(null);
    setListError(null);
    setPatientId("");
    api(`/doctor/patients?page=${page}&limit=20`)
      .then((result) => {
        if (!active) return;
        const last = Math.max(1, result.pagination.totalPages);
        if (page > last) {
          setPage(last);
          return;
        }
        setList(result);
        setPatientId(
          result.patients.length ? String(result.patients[0].id) : "",
        );
      })
      .catch((error) => {
        if (active) {
          setListError(error);
          if (error.status === 401) expired.current();
        }
      });
    return () => {
      active = false;
    };
  }, [api, page, refresh]);
  useEffect(() => {
    let active = true;
    setEntry(null);
    setError(null);
    if (patientId)
      api(`/doctor/patients/${patientId}/reports?date=${date}`)
        .then((reports) => {
          if (active) setEntry({ key, reports });
        })
        .catch((error) => {
          if (active) {
            setError(error);
            if (error.status === 401) expired.current();
          }
        });
    return () => {
      active = false;
    };
  }, [api, patientId, date, refresh, retry, key]);
  function refreshPatients() {
    setPatientId("");
    setPage(1);
    setRefresh((n) => n + 1);
  }
  function changePage(next) {
    setPatientId("");
    setList(null);
    setPage(next);
  }
  return (
    <>
      <section className="panel history-panel">
        <h2>Assigned patients</h2>
        <button onClick={refreshPatients}>Refresh patients</button>
        {listError ? (
          <p className="error" role="alert">
            {listError.message}
          </p>
        ) : !list ? (
          <p role="status">Loading patients...</p>
        ) : !patients.length ? (
          <p>No patients are assigned to you yet.</p>
        ) : (
          <>
            <label>
              Assigned patient
              <select
                value={patientId}
                onChange={(event) => setPatientId(event.target.value)}
              >
                {patients.map((patient) => (
                  <option value={patient.id} key={patient.id}>
                    {patient.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Patient page {page} of {Math.max(1, list.pagination.totalPages)}
            </p>
            <div className="row-actions">
              <button
                disabled={page === 1}
                onClick={() => changePage(page - 1)}
              >
                Previous patients
              </button>
              <button
                disabled={page >= list.pagination.totalPages}
                onClick={() => changePage(page + 1)}
              >
                Next patients
              </button>
            </div>
          </>
        )}
      </section>
      {selected && (
        <section className="doctor-report">
          <div className="page-heading">
            <h2>Reports for {selected.name}</h2>
            <label className="date-picker">
              Selected date
              <input
                aria-label="Selected date"
                type="date"
                min="1900-01-01"
                max={maxDate}
                value={date}
                onChange={(event) => {
                  if (event.target.value) onDateChange(event.target.value);
                }}
              />
            </label>
          </div>
          {error ? (
            <>
              <p className="error" role="alert">
                {error.message}
              </p>
              <p>
                Access may have changed. Refresh your assigned patients or try
                again.
              </p>
              <button onClick={() => setRetry((n) => n + 1)}>
                Retry reports
              </button>
            </>
          ) : !reports ? (
            <p role="status">Loading patient reports...</p>
          ) : (
            <>
              <ReportPanels reports={reports} date={date} readOnly />
              <MonthlyChart
                key={patientId}
                api={api}
                basePath={`/doctor/patients/${patientId}/reports`}
                month={date.slice(0, 7)}
                refresh={retry + refresh}
                onSessionExpired={() => expired.current()}
                onAccessError={(error) => {
                  setEntry(null);
                  setError(error);
                }}
              />
            </>
          )}
        </section>
      )}
    </>
  );
}

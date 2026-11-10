import React from "react";
import { slots } from "../constants.js";
export function ReportPanels({
  reports,
  date,
  busy = false,
  onEdit,
  onDelete,
  readOnly = false,
}) {
  if (!reports) return null;
  return (
    <>
      <section className="panel daily-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE DAILY PICTURE</p>
            <h2>Daily report</h2>
          </div>
          <span className="pill">{reports.daily.count} of 4 readings</span>
        </div>
        <Stats report={reports.daily} />
        {!reports.daily.count ? (
          <div className="empty">
            <span aria-hidden="true">○</span>
            <h3>A fresh page for this day</h3>
            <p>
              {readOnly
                ? "No readings recorded for this day."
                : "Add your first reading to see your daily picture."}
            </p>
          </div>
        ) : (
          <ul className="reading-list">
            {reports.daily.readings.map((reading) => (
              <li key={reading.id}>
                <div>
                  <span className="slot-name">{slots[reading.slot]}</span>
                  <span className="reading-number">
                    {reading.value} <small>mg/dl</small>
                  </span>
                </div>
                {!readOnly && (
                  <div className="row-actions">
                    <button
                      disabled={busy}
                      onClick={() => onEdit(reading)}
                      aria-label={`Edit ${slots[reading.slot]}`}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      className="danger"
                      onClick={() => onDelete(reading)}
                      aria-label={`Delete ${slots[reading.slot]}`}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="summary-grid">
        {[
          ["monthToDate", "Month to date"],
          ["previousMonth", "Previous month"],
        ].map(([key, title]) => (
          <section className="panel summary" key={key}>
            <p className="eyebrow">{title.toUpperCase()}</p>
            <h2>
              {reports[key].start} <span className="muted">to</span>{" "}
              {key === "monthToDate" ? date : previousDay(reports[key].end)}
            </h2>
            <Stats report={reports[key]} />
            {!reports[key].count && (
              <p className="hint">No readings in this period yet.</p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
function previousDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function Stats({ report }) {
  return (
    <dl className="stats">
      {[
        ["Highest", report.highest],
        ["Lowest", report.lowest],
        ["Average", report.average === null ? null : report.average.toFixed(1)],
        ["Count", report.count],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

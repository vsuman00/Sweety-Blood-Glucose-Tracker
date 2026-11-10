import React from "react";
import { slots } from "../constants.js";

export function ReadingForm({
  form,
  onChange,
  maxDate,
  editing,
  busy,
  onSave,
  onCancel,
}) {
  function submit(event) {
    event.preventDefault();
    if (busy) return;
    onSave({
      date: form.date,
      slot: form.slot,
      value: form.value.trim() === "" ? null : Number(form.value),
      ...(editing && { version: editing.version }),
    });
  }
  return (
    <form onSubmit={submit}>
      <label>
        Date
        <input
          required
          type="date"
          min="1900-01-01"
          max={maxDate}
          value={form.date}
          onInvalid={(event) => {
            const input = event.currentTarget;
            input.setCustomValidity(
              input.validity.rangeOverflow
                ? "Date cannot be in the future."
                : "Choose a valid date from 1900 through today.",
            );
          }}
          onChange={(e) => {
            e.currentTarget.setCustomValidity("");
            onChange({ ...form, date: e.target.value });
          }}
        />
      </label>
      <label>
        Meal slot
        <select
          value={form.slot}
          onChange={(e) => onChange({ ...form, slot: e.target.value })}
        >
          {Object.entries(slots).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="reading-value">
        Glucose <span className="muted">(mg/dl)</span>
      </label>
      <input
        id="reading-value"
        required
        type="number"
        min="40"
        max="600"
        step="1"
        inputMode="numeric"
        placeholder="e.g. 105"
        value={form.value}
        onInvalid={(event) => {
          const input = event.currentTarget;
          input.setCustomValidity(
            input.validity.valueMissing && !input.validity.badInput
              ? "Please enter a glucose value."
              : "Value must be a whole number between 40 and 600 mg/dl.",
          );
        }}
        onChange={(e) => {
          e.currentTarget.setCustomValidity("");
          onChange({ ...form, value: e.target.value });
        }}
      />
      <p className="hint">Whole numbers between 40 and 600.</p>
      <button className="primary full" disabled={busy}>
        {busy ? "Saving..." : editing ? "Save changes" : "Add reading"}
      </button>
      {editing && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel edit
        </button>
      )}
    </form>
  );
}

import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReadingForm } from "../../client/components/ReadingForm.jsx";

function Harness({ onSave = vi.fn(), editing = null, onCancel = vi.fn() }) {
  const [form, onChange] = useState({
    date: "2026-11-01",
    slot: "morning_fasting",
    value: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <ReadingForm
        {...{ form, onChange, editing, onCancel, busy }}
        maxDate="2026-11-10"
        onSave={async (payload) => {
          setBusy(true);
          try {
            await onSave(payload);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}

describe("reading form", () => {
  it("requires a whole-number glucose value and rejects future dates", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const input = screen.getByLabelText("Glucose (mg/dl)");
    await userEvent.click(screen.getByRole("button", { name: "Add reading" }));
    expect(input.validationMessage).toBe("Please enter a glucose value.");
    for (const value of ["39", "601", "100.5"]) {
      fireEvent.change(input, { target: { value } });
      await userEvent.click(
        screen.getByRole("button", { name: "Add reading" }),
      );
      expect(input.validationMessage).toBe(
        "Value must be a whole number between 40 and 600 mg/dl.",
      );
    }
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-11-11" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add reading" }));
    expect(screen.getByLabelText("Date").validationMessage).toBe(
      "Date cannot be in the future.",
    );
    expect(onSave).not.toHaveBeenCalled();
  });
  it("submits a numeric create payload with the selected slot", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await userEvent.type(screen.getByLabelText("Glucose (mg/dl)"), "125");
    await userEvent.selectOptions(
      screen.getByLabelText("Meal slot"),
      "after_lunch",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add reading" }));
    expect(onSave).toHaveBeenCalledWith({
      date: "2026-11-01",
      slot: "after_lunch",
      value: 125,
    });
  });
  it("includes the version when editing and supports cancel", async () => {
    const onSave = vi.fn(),
      onCancel = vi.fn();
    render(
      <Harness {...{ onSave, onCancel }} editing={{ id: 4, version: 7 }} />,
    );
    await userEvent.type(screen.getByLabelText("Glucose (mg/dl)"), "99");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave.mock.calls[0][0].version).toBe(7);
    await userEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("keeps input after a rejected save and blocks submissions while pending", async () => {
    let rejectSave;
    const onSave = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    render(<Harness onSave={onSave} />);
    await userEvent.type(screen.getByLabelText("Glucose (mg/dl)"), "155");
    await userEvent.click(screen.getByRole("button", { name: "Add reading" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Saving..." }));
    expect(onSave).toHaveBeenCalledOnce();
    rejectSave(new Error("Duplicate slot"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Duplicate slot"),
    );
    expect(screen.getByLabelText("Glucose (mg/dl)")).toHaveValue(155);
    expect(screen.getByRole("button", { name: "Add reading" })).toBeEnabled();
  });
});

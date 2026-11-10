import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoctorDashboard } from "../../client/components/DoctorDashboard.jsx";

const report = (value) => {
  const daily = {
    start: "2026-02-10",
    end: "2026-02-11",
    count: 1,
    highest: value,
    lowest: value,
    average: value,
    readings: [
      { id: 1, date: "2026-02-10", slot: "after_lunch", value, version: 1 },
    ],
  };
  return {
    daily,
    monthToDate: { ...daily, readings: [] },
    previousMonth: { ...daily, readings: [] },
  };
};
const list = {
  patients: [
    { id: 1, name: "Patient A" },
    { id: 2, name: "Patient B" },
  ],
  pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
};
const props = {
  date: "2026-02-10",
  maxDate: "2026-03-01",
  onDateChange: vi.fn(),
  onSessionExpired: vi.fn(),
};
it("clears summary data if chart access is revoked after the summary loads", async () => {
  const api = vi.fn((path) => {
    if (path.startsWith("/doctor/patients?")) return Promise.resolve(list);
    if (path.includes("/monthly"))
      return Promise.reject(
        Object.assign(new Error("Patient not found."), { status: 404 }),
      );
    return Promise.resolve(report(111));
  });
  render(<DoctorDashboard {...props} api={api} />);
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("heading", { name: "Daily report" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("111", { selector: ".reading-number" }),
  ).not.toBeInTheDocument();
});
it("shows assigned reports without mutation controls and clears old responses on switching", async () => {
  let release;
  const api = vi.fn((path) => {
    if (path.startsWith("/doctor/patients?")) return Promise.resolve(list);
    if (path.includes("/monthly"))
      return Promise.resolve({
        start: "2026-02-01",
        end: "2026-03-01",
        readings: [],
      });
    if (path.includes("/1/"))
      return new Promise((r) => {
        release = r;
      });
    return Promise.resolve(report(222));
  });
  render(<DoctorDashboard {...props} api={api} />);
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await userEvent.selectOptions(screen.getByLabelText("Assigned patient"), "2");
  expect(
    await screen.findByText("222", { selector: ".reading-number" }),
  ).toBeInTheDocument();
  release(report(111));
  await waitFor(() =>
    expect(
      screen.queryByText("111", { selector: ".reading-number" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: /Edit|Delete|Add reading/ }),
  ).not.toBeInTheDocument();
});
it("handles unassigned accounts, revocation, and session expiry", async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce({
      ...list,
      patients: [],
      pagination: { ...list.pagination, total: 0, totalPages: 0 },
    })
    .mockResolvedValueOnce(list)
    .mockRejectedValueOnce(
      Object.assign(new Error("Patient not found."), { status: 404 }),
    )
    .mockRejectedValueOnce(
      Object.assign(new Error("Session expired"), { status: 401 }),
    );
  const expired = vi.fn();
  render(<DoctorDashboard {...props} api={api} onSessionExpired={expired} />);
  expect(
    await screen.findByText("No patients are assigned to you yet."),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh patients" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Patient not found.",
  );
  expect(
    screen.queryByRole("heading", { name: "Daily report" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh patients" }),
  );
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
});

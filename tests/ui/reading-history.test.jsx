import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReadingHistory } from "../../client/components/ReadingHistory.jsx";

const result = (page, total = 21, value = 110) => ({
  readings: [{ id: page, date: "2026-02-26", slot: "after_lunch", value }],
  pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) },
});
it("navigates history pages and changes page size", async () => {
  const api = vi.fn((path) =>
    Promise.resolve(
      result(Number(new URL(path, "http://test").searchParams.get("page"))),
    ),
  );
  render(<ReadingHistory api={api} refresh={0} onSessionExpired={vi.fn()} />);
  await screen.findByText("110 mg/dl");
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith("/readings?page=2&limit=20"),
  );
  expect(
    await screen.findByText("Page 2 of 2 · 21 readings"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  await userEvent.selectOptions(
    screen.getByLabelText("History page size"),
    "50",
  );
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith("/readings?page=1&limit=50"),
  );
});
it("shows retry and clears history on session expiry", async () => {
  const expired = vi.fn();
  const api = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockRejectedValueOnce(
      Object.assign(new Error("Log in again"), { status: 401 }),
    );
  render(<ReadingHistory api={api} refresh={0} onSessionExpired={expired} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  await userEvent.click(screen.getByRole("button", { name: "Retry history" }));
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("ignores a delayed response after refresh and clamps a deleted last page", async () => {
  let release;
  const api = vi
    .fn()
    .mockResolvedValueOnce(result(1))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    )
    .mockResolvedValueOnce(result(2, 1, 222))
    .mockResolvedValueOnce(result(1, 1, 333));
  const { rerender } = render(
    <ReadingHistory api={api} refresh={0} onSessionExpired={vi.fn()} />,
  );
  await screen.findByText("110 mg/dl");
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  rerender(<ReadingHistory api={api} refresh={1} onSessionExpired={vi.fn()} />);
  expect(await screen.findByText("333 mg/dl")).toBeInTheDocument();
  release(result(2, 21, 999));
  await waitFor(() =>
    expect(screen.queryByText("999 mg/dl")).not.toBeInTheDocument(),
  );
});

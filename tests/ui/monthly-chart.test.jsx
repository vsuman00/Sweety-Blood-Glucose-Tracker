import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MonthlyChart,
  chartRows,
} from "../../client/components/MonthlyChart.jsx";

const data = {
  start: "2024-02-01",
  end: "2024-03-01",
  readings: [{ date: "2024-02-29", slot: "after_lunch", value: 123 }],
};
it("includes leap days and preserves missing measurements as null gaps", () => {
  const rows = chartRows(data);
  expect(rows).toHaveLength(29);
  expect(rows[0]).toMatchObject({
    date: "2024-02-01",
    morning_fasting: null,
    after_lunch: null,
  });
  expect(rows.at(-1)).toMatchObject({
    date: "2024-02-29",
    after_lunch: 123,
    after_dinner: null,
  });
});
it("renders measurements in an accessible table and retries failures", async () => {
  const api = vi
    .fn()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce(data);
  render(
    <MonthlyChart
      {...{ api }}
      month="2024-02"
      refresh={0}
      onSessionExpired={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry chart" }));
  await screen.findByText("View monthly readings table");
  await userEvent.click(screen.getByText("View monthly readings table"));
  expect(
    await screen.findByRole("table", {
      name: "Monthly glucose readings in mg/dl",
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "123" })).toBeInTheDocument();
  expect(api).toHaveBeenLastCalledWith("/reports/monthly?month=2024-02");
});
it("ignores old-month responses and handles empty months and expired sessions", async () => {
  let release;
  const expired = vi.fn();
  const api = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    )
    .mockResolvedValueOnce({
      start: "2024-03-01",
      end: "2024-04-01",
      readings: [],
    })
    .mockRejectedValueOnce(
      Object.assign(new Error("Expired"), { status: 401 }),
    );
  const { rerender } = render(
    <MonthlyChart
      api={api}
      month="2024-02"
      refresh={0}
      onSessionExpired={expired}
    />,
  );
  rerender(
    <MonthlyChart
      api={api}
      month="2024-03"
      refresh={0}
      onSessionExpired={expired}
    />,
  );
  expect(
    await screen.findByText("No readings in this month yet."),
  ).toBeInTheDocument();
  release(data);
  await waitFor(() =>
    expect(screen.queryByRole("cell", { name: "123" })).not.toBeInTheDocument(),
  );
  rerender(
    <MonthlyChart
      api={api}
      month="2024-03"
      refresh={1}
      onSessionExpired={expired}
    />,
  );
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
});

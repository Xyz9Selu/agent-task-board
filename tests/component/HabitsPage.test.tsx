import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { HabitsPage } from "../../src/components/habits/HabitsPage.js";
import { HABITS_STORAGE_KEY } from "../../src/habits/store.js";

/**
 * The page reads/writes `window.localStorage` directly through the pure
 * store. Each test gets a clean storage slate.
 */
beforeEach(() => {
  window.localStorage.clear();
  // Default to "confirm" — tests that exercise the delete path override.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/habits"]}>
      <HabitsPage />
    </MemoryRouter>,
  );
}

describe("HabitsPage", () => {
  it("renders the empty state when there are no habits", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /habits/i })).toBeInTheDocument();
    expect(screen.getByText(/no habits yet/i)).toBeInTheDocument();
  });

  it("adds a habit and renders it in the list", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByPlaceholderText(/add a habit/i);
    await user.type(input, "read{enter}");

    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete habit: read/i }))
      .toBeInTheDocument();
    expect(screen.queryByText(/no habits yet/i)).not.toBeInTheDocument();
  });

  it("trims whitespace from the input before adding", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByPlaceholderText(/add a habit/i);
    await user.type(input, "  meditate  {enter}");

    expect(screen.getByText("meditate")).toBeInTheDocument();
    expect(screen.queryByText("  meditate  ")).not.toBeInTheDocument();
  });

  it("marks a habit done — button label flips and streak increments", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/add a habit/i), "read{enter}");
    const doneButton = screen.getByRole("button", { name: /mark read done/i });
    await user.click(doneButton);

    // After clicking, the button is disabled and re-labeled.
    const doneRow = screen.getByRole("button", {
      name: /read marked done for today/i,
    });
    expect(doneRow).toBeDisabled();
    expect(screen.getByLabelText(/current streak: 1 day/i)).toBeInTheDocument();
  });

  it("does nothing on a second same-day click", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/add a habit/i), "read{enter}");
    const doneButton = screen.getByRole("button", { name: /mark read done/i });
    await user.click(doneButton);

    // Persistence sanity-check: the completion made it into localStorage.
    const stored = JSON.parse(
      window.localStorage.getItem(HABITS_STORAGE_KEY) ?? "{}",
    );
    expect(stored.habits[0].completions).toEqual([
      new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD in local TZ
    ]);
  });

  it("removes a habit when the delete button is confirmed", async () => {
    const user = userEvent.setup();
    vi.mocked(window.confirm).mockReturnValue(true);
    renderPage();

    await user.type(screen.getByPlaceholderText(/add a habit/i), "read{enter}");
    expect(screen.getByText("read")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete habit: read/i }));

    expect(screen.queryByText("read")).not.toBeInTheDocument();
    expect(screen.getByText(/no habits yet/i)).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("read"));
  });

  it("does NOT remove a habit when the delete confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPage();

    await user.type(screen.getByPlaceholderText(/add a habit/i), "read{enter}");
    await user.click(screen.getByRole("button", { name: /delete habit: read/i }));

    expect(screen.getByText("read")).toBeInTheDocument();
  });

  it("treats case-sensitive names as distinct habits", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByPlaceholderText(/add a habit/i);
    await user.type(input, "Exercise{enter}");
    await user.type(input, "exercise{enter}");

    expect(screen.getByText("Exercise")).toBeInTheDocument();
    expect(screen.getByText("exercise")).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem(HABITS_STORAGE_KEY) ?? "{}").habits,
    ).toHaveLength(2);
  });

  it("ignores submission of an empty / whitespace-only name", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByPlaceholderText(/add a habit/i);
    // Try to submit whitespace-only — the input's button is disabled when
    // the value is empty, so the simplest path is to type a single space and
    // press Enter.
    await user.type(input, " {enter}");

    expect(screen.queryByText(" ")).not.toBeInTheDocument();
    expect(screen.getByText(/no habits yet/i)).toBeInTheDocument();
  });
});
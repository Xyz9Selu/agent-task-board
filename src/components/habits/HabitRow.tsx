import type { ReactElement } from "react";
import type { HabitRow as HabitRowData } from "../../habits/store";

export interface HabitRowProps {
  row: HabitRowData;
  onDone: (name: string) => void;
  onRemove: (name: string) => void;
}

const REMOVE_CONFIRM = (name: string) =>
  `Delete '${name}'? This removes the habit and all its completions.`;

/**
 * One habit row: name, current streak, "Done for today" toggle, and a small
 * × delete button.
 *
 * The "Done" button is disabled once today is checked — v1 has no "un-mark"
 * affordance (the user can edit `localStorage` by hand). The × button asks
 * for a confirmation so an accidental click can't wipe a streak.
 */
export function HabitRow(props: HabitRowProps): ReactElement {
  const { row, onDone, onRemove } = props;
  const { habit, doneToday, streak } = row;
  const streakLabel = streak === 1 ? "1 day" : `${streak} days`;

  return (
    <li className="habit-row">
      <span className="habit-row__name">{habit.name}</span>
      <span
        className="habit-row__streak"
        data-streak={streak}
        aria-label={`Current streak: ${streakLabel}`}
      >
        {streak > 0 ? (
          <>
            <span className="habit-row__streak-emoji" aria-hidden="true">
              🔥
            </span>
            {streak}
          </>
        ) : (
          "0"
        )}
      </span>
      <button
        type="button"
        className="habit-row__done"
        onClick={() => onDone(habit.name)}
        disabled={doneToday}
        aria-label={
          doneToday
            ? `${habit.name} marked done for today`
            : `Mark ${habit.name} done for today`
        }
      >
        {doneToday ? "Done ✓" : "Done for today"}
      </button>
      <button
        type="button"
        className="habit-row__remove"
        onClick={() => {
          if (window.confirm(REMOVE_CONFIRM(habit.name))) {
            onRemove(habit.name);
          }
        }}
        aria-label={`Delete habit: ${habit.name}`}
        title={`Delete ${habit.name}`}
      >
        ×
      </button>
    </li>
  );
}
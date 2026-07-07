import { type HabitRow as HabitRowData, type HabitRow as _HabitRowUnused } from "../../habits/store";
import { HabitRow } from "./HabitRow";

export interface HabitListProps {
  rows: HabitRowData[];
  onDone: (name: string) => void;
  onRemove: (name: string) => void;
}

/**
 * Semantic `<ul>` wrapper around the rows. Sorts come from the store; this
 * component is a presentational pass-through.
 */
export function HabitList({ rows, onDone, onRemove }: HabitListProps) {
  return (
    <ul className="habit-list" aria-label="Tracked habits">
      {rows.map((row) => (
        <HabitRow key={row.habit.name} row={row} onDone={onDone} onRemove={onRemove} />
      ))}
    </ul>
  );
}
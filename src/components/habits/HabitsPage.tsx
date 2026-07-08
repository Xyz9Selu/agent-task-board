import { useState } from "react";
import { useHabits } from "../../hooks/useHabits";
import {
  EmptyHabitNameError,
  HabitError,
  UnknownHabitError,
} from "../../habits/store";
import { AddHabitForm } from "./AddHabitForm";
import { HabitList } from "./HabitList";
import "./habits.css";

/**
 * Route component for `/habits`.
 *
 * Owns the form-level error message and the local "habits are empty" empty
 * state. All persistence + streak math is delegated to `useHabits` and the
 * pure store modules so this file stays presentational.
 */
export function HabitsPage() {
  const { rows, add, done, remove } = useHabits();
  const [error, setError] = useState<string | null>(null);

  const handleAdd = (name: string) => {
    try {
      add(name);
      setError(null);
    } catch (e) {
      if (e instanceof EmptyHabitNameError) {
        setError("Habit name cannot be empty.");
      } else if (e instanceof HabitError) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  };

  const handleDone = (name: string) => {
    try {
      done(name);
    } catch (e) {
      if (e instanceof UnknownHabitError) {
        setError(e.message);
      } else if (e instanceof HabitError) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  };

  const handleRemove = (name: string) => {
    try {
      remove(name);
    } catch (e) {
      if (e instanceof HabitError) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  };

  return (
    <section className="habits-page">
      <h1>Habits</h1>
      <AddHabitForm onAdd={handleAdd} />
      {error && (
        <p className="habits-page__error" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="habits-page__empty">No habits yet. Add one above.</p>
      ) : (
        <HabitList rows={rows} onDone={handleDone} onRemove={handleRemove} />
      )}
    </section>
  );
}
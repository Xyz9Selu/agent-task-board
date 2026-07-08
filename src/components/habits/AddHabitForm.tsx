import { useState, type FormEvent } from "react";
import { isEmptyName, normalizeName } from "../../habits/normalize";

export interface AddHabitFormProps {
  /**
   * Called with the raw input value when the user submits a non-empty name.
   * The parent is responsible for validating and surfacing errors so the
   * form stays a pure presentational component.
   */
  onAdd: (name: string) => void;
}

/**
 * Controlled input + submit button for adding a habit.
 *
 * Submitting an empty / whitespace-only name is silently ignored — the
 * parent page renders an inline error if it has its own validation needs,
 * but the form itself avoids emitting no-op writes to `localStorage`.
 */
export function AddHabitForm({ onAdd }: AddHabitFormProps) {
  const [value, setValue] = useState("");

  const disabled = isEmptyName(value);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalized = normalizeName(value);
    if (isEmptyName(normalized)) return;
    onAdd(normalized);
    setValue("");
  };

  return (
    <form className="add-habit-form" onSubmit={handleSubmit}>
      <label htmlFor="add-habit-input" className="visually-hidden">
        Add a habit
      </label>
      <input
        id="add-habit-input"
        className="add-habit-form__input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a habit..."
        autoComplete="off"
      />
      <button
        type="submit"
        className="add-habit-form__button"
        disabled={disabled}
      >
        Add
      </button>
    </form>
  );
}
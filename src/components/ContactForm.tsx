import { useRef, useState, type FormEvent } from 'react'
import {
  CONTACT_FORM_FIELD_ORDER,
  EMPTY_CONTACT_FORM_VALUES,
  validateContactForm,
  type ContactFormErrors,
  type ContactFormField,
  type ContactFormValues,
} from './contactValidation'

export type { ContactFormErrors, ContactFormValues, ContactFormField }

export { validateContactForm }

export interface ContactFormProps {
  /** Called once the form passes validation and has been cleared. */
  onSubmitted: () => void
}

/**
 * Contact form. Submits client-side only — the data is dropped after the
 * success toast fires. No fetch, no localStorage, no console write.
 */
export function ContactForm({ onSubmitted }: ContactFormProps) {
  const [values, setValues] = useState<ContactFormValues>(
    EMPTY_CONTACT_FORM_VALUES,
  )
  const [errors, setErrors] = useState<ContactFormErrors>({})

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next = validateContactForm(values)
    setErrors(next)

    const firstInvalid = CONTACT_FORM_FIELD_ORDER.find((f) => next[f])
    if (firstInvalid) {
      // Look up refs at click time — they are null on the first render.
      const ref =
        firstInvalid === 'name'
          ? nameRef
          : firstInvalid === 'email'
            ? emailRef
            : messageRef
      ref.current?.focus()
      return
    }

    // Drop the data entirely per requirements — no fetch, no localStorage,
    // no console. Reset the fields and notify the parent to fire the toast.
    setValues(EMPTY_CONTACT_FORM_VALUES)
    onSubmitted()
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="contact-name">
          Name
        </label>
        <input
          id="contact-name"
          ref={nameRef}
          className="field__input"
          type="text"
          name="name"
          required
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'contact-name-error' : undefined}
        />
        {errors.name && (
          <span id="contact-name-error" className="field__error" role="alert">
            {errors.name}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="contact-email">
          Email
        </label>
        <input
          id="contact-email"
          ref={emailRef}
          className="field__input"
          type="email"
          name="email"
          required
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'contact-email-error' : undefined}
        />
        {errors.email && (
          <span id="contact-email-error" className="field__error" role="alert">
            {errors.email}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          ref={messageRef}
          className="field__input field__input--textarea"
          name="message"
          required
          rows={5}
          value={values.message}
          onChange={(e) => setValues((v) => ({ ...v, message: e.target.value }))}
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? 'contact-message-error' : undefined}
        />
        {errors.message && (
          <span
            id="contact-message-error"
            className="field__error"
            role="alert"
          >
            {errors.message}
          </span>
        )}
      </div>

      <button type="submit" className="contact-form__submit">
        Send
      </button>
    </form>
  )
}
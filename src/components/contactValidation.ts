/**
 * Pure validator for the contact form. Kept in a separate file (no JSX) so
 * it can be unit-tested without a React DOM / jsdom / testing-library setup.
 */

export interface ContactFormValues {
  name: string
  email: string
  message: string
}

export type ContactFormField = keyof ContactFormValues

export type ContactFormErrors = Partial<Record<ContactFormField, string>>

/**
 * Returns a (possibly empty) map of field -> error message. Empty/whitespace
 * values are treated as missing.
 */
export function validateContactForm(values: ContactFormValues): ContactFormErrors {
  const errors: ContactFormErrors = {}

  if (!values.name.trim()) {
    errors.name = 'Name is required.'
  }

  const trimmedEmail = values.email.trim()
  if (!trimmedEmail) {
    errors.email = 'Email is required.'
  } else if (!isPlausibleEmail(trimmedEmail)) {
    errors.email = 'Enter a valid email address.'
  }

  if (!values.message.trim()) {
    errors.message = 'Message is required.'
  }

  return errors
}

// Lightweight email shape check — browser native validation would also catch
// this, but we want a consistent error UI rather than the browser tooltip.
function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export const CONTACT_FORM_FIELD_ORDER: ContactFormField[] = [
  'name',
  'email',
  'message',
]

export const EMPTY_CONTACT_FORM_VALUES: ContactFormValues = {
  name: '',
  email: '',
  message: '',
}
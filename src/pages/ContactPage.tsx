import { useState } from 'react'
import { ContactForm } from '../components/ContactForm'
import { Toast } from '../components/Toast'

interface ToastState {
  message: string
  /** Used as the React `key` so re-triggering resets the auto-dismiss timer. */
  key: number
}

const SUCCESS_MESSAGE = 'Thanks — message sent.'

/**
 * `/contact` page. Renders the page heading, the contact form, and an
 * in-house toast slot. Submissions are dropped client-side — no fetch, no
 * localStorage, no console write.
 */
export function ContactPage() {
  const [toast, setToast] = useState<ToastState | null>(null)

  return (
    <section className="page page--contact">
      <h1>Contact</h1>
      <p className="page__lede">
        Send a message — we&apos;ll get back to you (eventually).
      </p>
      <ContactForm
        onSubmitted={() =>
          setToast({ message: SUCCESS_MESSAGE, key: Date.now() })
        }
      />
      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          onDone={() => setToast(null)}
        />
      )}
    </section>
  )
}
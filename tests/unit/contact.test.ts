import { describe, it, expect } from 'vitest'
import {
  validateContactForm,
  type ContactFormValues,
} from '../../src/components/contactValidation.js'

const valid: ContactFormValues = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  message: 'Hello there.',
}

describe('validateContactForm', () => {
  it('returns errors for all three keys when every field is empty', () => {
    const errors = validateContactForm({ name: '', email: '', message: '' })
    expect(errors.name).toBeDefined()
    expect(errors.email).toBeDefined()
    expect(errors.message).toBeDefined()
  })

  it('treats whitespace-only values as empty', () => {
    const errors = validateContactForm({
      name: '   ',
      email: '\t  ',
      message: '\n',
    })
    expect(errors.name).toBeDefined()
    expect(errors.email).toBeDefined()
    expect(errors.message).toBeDefined()
  })

  it('returns only the name error when only the name is empty', () => {
    const errors = validateContactForm({
      ...valid,
      name: '',
    })
    expect(errors.name).toBeDefined()
    expect(errors.email).toBeUndefined()
    expect(errors.message).toBeUndefined()
  })

  it('returns only the email error when only the email is empty', () => {
    const errors = validateContactForm({
      ...valid,
      email: '',
    })
    expect(errors.email).toBeDefined()
    expect(errors.name).toBeUndefined()
    expect(errors.message).toBeUndefined()
  })

  it('returns only the message error when only the message is empty', () => {
    const errors = validateContactForm({
      ...valid,
      message: '',
    })
    expect(errors.message).toBeDefined()
    expect(errors.name).toBeUndefined()
    expect(errors.email).toBeUndefined()
  })

  it('flags malformed emails', () => {
    const malformed = ['foo', 'foo@bar', 'foo@.com', '@bar.com', 'foo bar@x.com']
    for (const email of malformed) {
      const errors = validateContactForm({ ...valid, email })
      expect(errors.email).toBeDefined()
    }
  })

  it('accepts well-formed emails', () => {
    const ok = ['a@b.co', 'ada.lovelace@example.com', 'x+y@sub.example.io']
    for (const email of ok) {
      const errors = validateContactForm({ ...valid, email })
      expect(errors.email).toBeUndefined()
    }
  })

  it('trims the email before validating', () => {
    const errors = validateContactForm({ ...valid, email: '  ada@example.com  ' })
    expect(errors.email).toBeUndefined()
  })

  it('returns no errors for a fully-valid form', () => {
    expect(validateContactForm(valid)).toEqual({})
  })
})
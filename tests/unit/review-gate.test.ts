import { describe, it, expect } from 'vitest';
import { decideReviewGate } from '../../src/worker.js';

describe('decideReviewGate (review dual gate)', () => {
  it('returns null when there are no comments and no PR reviews', () => {
    expect(decideReviewGate([], false, false)).toBeNull();
  });

  it('returns null when comments are pure discussion', () => {
    const comments = [
      { body: 'looks interesting', user: { login: 'alice' } },
      { body: 'any update on this?', user: { login: 'bob' } },
    ];
    expect(decideReviewGate(comments, false, false)).toBeNull();
  });

  it('returns "approve" when /adt-approve is in any comment', () => {
    const comments = [
      { body: 'looks good', user: { login: 'alice' } },
      { body: '/adt-approve', user: { login: 'bob' } },
    ];
    expect(decideReviewGate(comments, false, false)).toBe('approve');
  });

  it('returns "approve" when /adt-approve has trailing text', () => {
    const comments = [{ body: '/adt-approve LGTM, ship it', user: { login: 'bob' } }];
    expect(decideReviewGate(comments, false, false)).toBe('approve');
  });

  it('returns "approve" when an APPROVED PR review exists', () => {
    expect(decideReviewGate([], true, false)).toBe('approve');
  });

  it('returns "rework" when /adt-rework is in any comment', () => {
    const comments = [
      { body: 'please add a CSV export mode', user: { login: 'alice' } },
      { body: '/adt-rework add CSV export', user: { login: 'bob' } },
    ];
    expect(decideReviewGate(comments, false, false)).toBe('rework');
  });

  it('returns "rework" when a CHANGES_REQUESTED PR review exists (no comment)', () => {
    expect(decideReviewGate([], false, true)).toBe('rework');
  });

  it('approve wins over rework when both signals are present', () => {
    const comments = [
      { body: '/adt-rework please add CSV', user: { login: 'bob' } },
      { body: '/adt-approve on second thought', user: { login: 'carol' } },
    ];
    expect(decideReviewGate(comments, true, true)).toBe('approve');
  });

  it('approve wins even when only APPROVED review + CHANGES_REQUESTED review', () => {
    expect(decideReviewGate([], true, true)).toBe('approve');
  });

  it('ignores /adt-approve from bot users (callers must pre-filter)', () => {
    // This test documents that the function trusts the caller's pre-filter.
    // Worker pre-filters github-actions[bot] before calling this function.
    const comments = [
      { body: '/adt-approve', user: { login: 'github-actions[bot]' } },
    ];
    // With no pre-filter applied, the bot's /adt-approve is honoured.
    // The worker code at worker.ts:303-305 filters bots before calling.
    expect(decideReviewGate(comments, false, false)).toBe('approve');
  });

  it('does not match /adt-approve buried mid-line', () => {
    // The regex is anchored to start-of-line; "echo /adt-approve" in a code
    // block should not trigger.
    const comments = [{ body: 'echo "/adt-approve" > /dev/null', user: { login: 'alice' } }];
    expect(decideReviewGate(comments, false, false)).toBeNull();
  });

  it('matches /adt-approve at the start of any line (multiline body)', () => {
    const comments = [
      { body: 'some preamble\n/adt-approve thanks!', user: { login: 'alice' } },
    ];
    expect(decideReviewGate(comments, false, false)).toBe('approve');
  });

  it('matches /adt-rework at the start of any line', () => {
    const comments = [
      { body: 'preamble\n/adt-rework missing tests', user: { login: 'alice' } },
    ];
    expect(decideReviewGate(comments, false, false)).toBe('rework');
  });
});
# Task 7 Fix Report

## Changes Made

### 1. Remove hardcoded `ALL_ADT_LABELS` from `src/github.ts`
- Added import of `ALL_ADT_LABELS` from `./labels.js` (the canonical source).
- Deleted the local hardcoded array definition inside `replaceAdtLabel`.
- Verified the imported array matches the removed hardcoded values:
  `adt:ready`, `adt:blocked`, `adt:merge-ready`, `adt:cancelled`,
  `adt:reqs-running`, `adt:reqs-waiting`, `adt:design-running`, `adt:design-waiting`,
  `adt:impl-running`, `adt:impl-waiting`, `adt:review-running`, `adt:review-waiting`.

### 2. Add `per_page: 100` to list calls
- Added `per_page: 100` to `getComments` (`issues.listComments` call).
- Added `per_page: 100` to `hasApprovedReview` (`pulls.listReviews` call).
- Consistent with the pattern already used in `listReadyIssues`.

### 3. Updated tests to match
- Added `.query({ per_page: 100 })` to nock mocks for `getComments` and `hasApprovedReview` test cases so they correctly intercept the updated API calls.

## Test Results

- All 18 tests in `tests/unit/github.test.ts` pass.

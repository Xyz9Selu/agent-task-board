import { describe, it, expect } from 'vitest';
import {
  STAGE_LABELS, LABEL_BLOCKED, LABEL_READY, LABEL_MERGE_READY,
  LABEL_CANCELLED, ALL_ADT_LABELS, stageFromLabel, nextStage, labelForStage,
} from '../../src/labels.js';
import type { Stage } from '../../src/config.js';

describe('STAGE_LABELS', () => {
  it('has entries for all 5 stages', () => {
    const stages: Stage[] = ['reqs', 'design', 'impl', 'verify', 'review'];
    for (const s of stages) {
      expect(STAGE_LABELS[s]).toBeDefined();
      expect(STAGE_LABELS[s].running).toBe(`adt:${s}-running`);
      expect(STAGE_LABELS[s].waiting).toBe(`adt:${s}-waiting`);
    }
  });
});

describe('labelForStage', () => {
  it('returns running label for non-waiting status', () => {
    expect(labelForStage('reqs', 'running')).toBe('adt:reqs-running');
    expect(labelForStage('design', 'running')).toBe('adt:design-running');
  });

  it('returns waiting label for waiting-user status', () => {
    expect(labelForStage('reqs', 'waiting-user')).toBe('adt:reqs-waiting');
  });
});

describe('nextStage', () => {
  it('returns design after reqs', () => expect(nextStage('reqs')).toBe('design'));
  it('returns impl after design', () => expect(nextStage('design')).toBe('impl'));
  it('returns verify after impl', () => expect(nextStage('impl')).toBe('verify'));
  it('returns review after verify', () => expect(nextStage('verify')).toBe('review'));
  it('returns null after review', () => expect(nextStage('review')).toBeNull());
});

describe('stageFromLabel', () => {
  it('extracts stage from running label', () => {
    expect(stageFromLabel('adt:reqs-running')).toBe('reqs');
    expect(stageFromLabel('adt:impl-running')).toBe('impl');
  });
  it('extracts stage from waiting label', () => {
    expect(stageFromLabel('adt:design-waiting')).toBe('design');
  });
  it('returns null for non-stage labels', () => {
    expect(stageFromLabel('adt:ready')).toBeNull();
    expect(stageFromLabel('adt:blocked')).toBeNull();
    expect(stageFromLabel('bug')).toBeNull();
  });
});

describe('ALL_ADT_LABELS', () => {
  it('includes all adt: labels', () => {
    expect(ALL_ADT_LABELS).toContain('adt:ready');
    expect(ALL_ADT_LABELS).toContain('adt:blocked');
    expect(ALL_ADT_LABELS).toContain('adt:merge-ready');
    expect(ALL_ADT_LABELS).toContain('adt:cancelled');
    expect(ALL_ADT_LABELS).toContain('adt:reqs-running');
    expect(ALL_ADT_LABELS).toContain('adt:reqs-waiting');
  });
});

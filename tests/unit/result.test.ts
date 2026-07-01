import { describe, it, expect } from 'vitest';
import { parseStageResult, StageResult } from '../../src/result.js';

describe('parseStageResult', () => {
  it('parses waiting-user variant', () => {
    const raw = JSON.stringify({
      status: 'waiting-user',
      summary: 'Need clarification on X',
      artifacts: { questionList: 'What is X?' },
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('waiting-user');
    expect(result.summary).toBe('Need clarification on X');
    expect(result.artifacts).toEqual({ questionList: 'What is X?' });
  });

  it('parses done variant', () => {
    const raw = JSON.stringify({
      status: 'done',
      summary: 'Implemented feature Y',
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('done');
    expect(result.summary).toBe('Implemented feature Y');
    expect(result.artifacts).toBeUndefined();
  });

  it('parses done variant with artifacts', () => {
    const raw = JSON.stringify({
      status: 'done',
      summary: 'Done',
      artifacts: { designPath: 'docs/designs/42.md', commits: '3' },
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('done');
    expect(result.summary).toBe('Done');
    expect(result.artifacts!.designPath).toBe('docs/designs/42.md');
  });

  it('parses blocked variant', () => {
    const raw = JSON.stringify({
      status: 'blocked',
      reason: 'Push rejected: non-fast-forward',
      details: 'Branch adt/issue-42-foo diverged',
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('Push rejected: non-fast-forward');
    expect(result.details).toBe('Branch adt/issue-42-foo diverged');
  });

  it('throws on invalid status', () => {
    expect(() => parseStageResult(JSON.stringify({ status: 'unknown' }))).toThrow();
  });

  it('throws on missing required fields', () => {
    expect(() => parseStageResult(JSON.stringify({ status: 'done' }))).toThrow();
    expect(() => parseStageResult(JSON.stringify({ status: 'blocked' }))).toThrow();
  });

  it('throws on invalid JSON string', () => {
    expect(() => parseStageResult('not json')).toThrow();
  });
});

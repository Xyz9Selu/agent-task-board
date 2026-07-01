import type { Stage } from './config.js';

const STAGE_LABELS: Record<Stage, { running: string; waiting: string }> = {
  reqs:  { running: 'adt:reqs-running',  waiting: 'adt:reqs-waiting' },
  design:{ running: 'adt:design-running',waiting: 'adt:design-waiting' },
  impl:  { running: 'adt:impl-running',  waiting: 'adt:impl-waiting' },
  review:{ running: 'adt:review-running',waiting: 'adt:review-waiting' },
};

const LABEL_BLOCKED = 'adt:blocked';
const LABEL_READY = 'adt:ready';
const LABEL_MERGE_READY = 'adt:merge-ready';
const LABEL_CANCELLED = 'adt:cancelled';

const ALL_ADT_LABELS = [
  LABEL_READY, LABEL_BLOCKED, LABEL_MERGE_READY, LABEL_CANCELLED,
  ...Object.values(STAGE_LABELS).flatMap(v => [v.running, v.waiting]),
];

function labelForStage(stage: Stage, status: string): string {
  if (status === 'waiting-user') return STAGE_LABELS[stage].waiting;
  return STAGE_LABELS[stage].running;
}

function nextStage(current: Stage): Stage | null {
  const order: Stage[] = ['reqs', 'design', 'impl', 'review'];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : null;
}

function stageFromLabel(label: string): Stage | null {
  for (const stage of ['reqs', 'design', 'impl', 'review'] as Stage[]) {
    const entry = STAGE_LABELS[stage];
    if (label === entry.running || label === entry.waiting) return stage;
  }
  return null;
}

export {
  STAGE_LABELS, LABEL_BLOCKED, LABEL_READY, LABEL_MERGE_READY,
  LABEL_CANCELLED, ALL_ADT_LABELS, labelForStage, nextStage, stageFromLabel,
};

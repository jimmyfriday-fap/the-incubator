import type { ModelUse } from '../../api-types.js';

const JOB: Record<ModelUse['job'], string> = {
  planning: 'Questions',
  analysis: 'Analysis',
  'review-summary': 'Summary',
  coding: 'Coding',
};

/** Which tool and model did each kind of work in this run so far. */
export function ModelsUsed({ models }: { models: ModelUse[] }) {
  if (models.length === 0) return null;
  return (
    <p className="muted models-used" data-testid="models-used">
      Models used:{' '}
      {models.map((m, i) => (
        <span key={`${m.job}-${m.tool}-${m.model ?? ''}`}>
          {i > 0 && ' · '}
          {JOB[m.job]}: {m.tool}
          {m.model ? ` (${m.model})` : ' (default model)'}
          {m.costUsd !== null && m.costUsd > 0 ? ` $${m.costUsd.toFixed(2)}` : ''}
        </span>
      ))}
    </p>
  );
}

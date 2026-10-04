import { describe, expect, it } from 'vitest';
import type { Question } from '@incubator/spec';
import { applyAnswers, type AskedInfo, type Draft } from './merge.js';
import { buildUserPrompt } from './prompt-builder.js';
import { questionIssues, questionTarget } from './questions.js';

const q = (key: string, values: string[]): Question => ({
  key,
  question: `Question about ${key}?`,
  impact: 5,
  options: values.map((value, i) => ({
    value,
    label: `Label ${value}`,
    recommended: i === 0,
  })) as Question['options'],
});

describe('questionTarget', () => {
  it('lets a single-value path take the answer', () => {
    for (const key of [
      'deploy.target',
      'project.name',
      'project.visibility',
      'testing.coverageThreshold',
      'security.centralRig.enabled',
      'lanes.environments',
    ])
      expect(questionTarget(key), key).toBe('spec');
  });

  it('treats request.<topic> as context', () => {
    expect(questionTarget('request.dashboardRecords')).toBe('context');
  });

  it('refuses the structured fields a scope question must never overwrite', () => {
    for (const key of [
      'intent',
      'intent.coreFeatures',
      'intent.personas',
      'intent.narrative',
      'decisions',
      'project',
      'not.a.path',
    ])
      expect(questionTarget(key), key).toBeNull();
  });
});

describe('questionIssues', () => {
  const codes = (qs: Question[], enhance = false) =>
    questionIssues(qs, { enhance }).map((i) => i.code);

  it('rejects the keys that corrupted the Dashboard run', () => {
    for (const key of ['intent.coreFeatures', 'intent.personas', 'intent.narrative'])
      expect(codes([q(key, ['a', 'b'])]), key).toContain('question.key');
  });

  it('accepts request.<topic> keys with any option values', () => {
    expect(
      codes([q('request.dashboardRecords', ['events-and-meets', 'events-only'])], true),
    ).toEqual([]);
  });

  it('allows only request.<topic> keys on an update run', () => {
    expect(codes([q('deploy.target', ['docker-host', 'vps-tailscale'])], true)).toContain(
      'question.key',
    );
    expect(codes([q('deploy.target', ['docker-host', 'vps-tailscale'])])).toEqual([]);
  });

  it('rejects options outside the schema enum, a boolean or a number', () => {
    expect(codes([q('deploy.target', ['docker-host', 'mars'])])).toContain('question.options');
    expect(codes([q('security.centralRig.enabled', ['true', 'maybe'])])).toContain(
      'question.options',
    );
    expect(codes([q('testing.coverageThreshold', ['80', 'high'])])).toContain('question.options');
  });

  it('leaves a pack-fixed key to selectQuestions to drop', () => {
    expect(codes([q('lanes.environments', ['all', 'prod'])])).toEqual([]);
  });

  it('still checks the recommended option and a repeated option', () => {
    const bad = q('request.topic', ['x', 'x']);
    bad.options.forEach((o) => (o.recommended = true));
    expect(codes([bad], true)).toEqual(
      expect.arrayContaining(['question.recommended', 'question.options']),
    );
  });
});

describe('applyAnswers', () => {
  const draft = (): Draft => ({
    intent: {
      narrative: 'A landing page called Dashboard.',
      coreFeatures: [{ id: 'dashboard', summary: 'A Dashboard', lane: 'enhancement/new' }],
    },
    decisions: [],
  });
  const asked = (key: string, labels: Record<string, string>): Map<string, AskedInfo> =>
    new Map([[key, { question: `Question about ${key}?`, labels }]]);

  it('writes a single-value answer at its path', () => {
    const out = applyAnswers(
      draft(),
      [{ key: 'deploy.target', value: 'docker-host', source: 'user' }],
      asked('deploy.target', {}),
    );
    expect(out['deploy']).toEqual({ target: 'docker-host' });
    expect(out.decisions).toEqual([
      {
        key: 'deploy.target',
        question: 'Question about deploy.target?',
        answer: 'docker-host',
        source: 'user',
      },
    ]);
  });

  it('keeps a request.<topic> answer as a decision with its label and leaves the spec alone', () => {
    const before = draft();
    const out = applyAnswers(
      before,
      [{ key: 'request.dashboardRecords', value: 'events-and-meets', source: 'user' }],
      asked('request.dashboardRecords', { 'events-and-meets': 'Events and meets' }),
    );
    expect(out['intent']).toEqual(before['intent']);
    expect(out.decisions).toEqual([
      {
        key: 'request.dashboardRecords',
        question: 'Question about request.dashboardRecords?',
        answer: 'Events and meets',
        source: 'user',
      },
    ]);
  });

  it('does not let an answer from an older run overwrite the feature list or the request', () => {
    const before = draft();
    const out = applyAnswers(
      before,
      [
        { key: 'intent.coreFeatures', value: 'events-and-meets', source: 'user' },
        { key: 'intent.narrative', value: 'upcoming-points-invites', source: 'user' },
      ],
      new Map(),
    );
    expect(out['intent']).toEqual(before['intent']);
    expect(out.decisions).toHaveLength(2);
  });
});

describe('buildUserPrompt on an update run', () => {
  const base = {
    round: 2,
    narrative: 'A landing page called Dashboard.',
    analysis: null,
    draft: { intent: { coreFeatures: [] } },
    decisions: [
      {
        key: 'request.dashboardRecords',
        question: 'Which records?',
        answer: 'Events and meets',
        source: 'user' as const,
      },
    ],
  };

  it('prints scope answers with their question and names the request.<topic> keys', () => {
    const text = buildUserPrompt({ ...base, enhance: true });
    expect(text).toContain(
      '- request.dashboardRecords: "Which records?" -> Events and meets (user)',
    );
    expect(text).toContain('key every question "request.<topic>"');
  });

  it('leaves every other prompt unchanged', () => {
    const text = buildUserPrompt(base);
    expect(text).toContain('- request.dashboardRecords = Events and meets (user)');
    expect(text).toContain('question keys are dotted paths into incubator.json');
  });
});

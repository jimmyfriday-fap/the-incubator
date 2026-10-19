import { defaultsFor } from '@incubator/spec';
import { describe, expect, it } from 'vitest';
import { designMarkdown } from './design-doc.js';

describe('design document (plan 065)', () => {
  it('keeps the idea word for word, with the people, the features and the stack', () => {
    const spec = defaultsFor({});
    spec.project.name = 'Stockroom';
    spec.intent.narrative = 'A web app for cafés to track stock.\n\nIt must work on a phone.';
    spec.intent.personas = ['Café owner'];
    spec.intent.coreFeatures = [{ id: 'count-stock', summary: 'Count the stock' }] as never;
    const md = designMarkdown(spec);
    expect(md).toContain('# Stockroom: design');
    expect(md).toContain('> A web app for cafés to track stock.\n>\n> It must work on a phone.');
    expect(md).toContain('- Café owner');
    expect(md).toContain('- **count-stock**: Count the stock');
    expect(md).toContain(`- Stack: ${spec.stack.pack}`);
    expect(md).toContain('`WHAT-NOW.md` and `docs/STAND-UP.md`');
  });

  it('says so when nothing was recorded', () => {
    const md = designMarkdown(defaultsFor({}));
    expect(md).toContain('Not recorded.');
    expect(md).toContain('No core features were recorded.');
  });
});

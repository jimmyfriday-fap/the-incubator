import type { FinishDetail, RunState } from '@incubator/core';
import { ExitCode, PolicyError } from '@incubator/runtime';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

/** How the owner answers the commit and push requests of a folder run (ADR-023). */
export interface FinishFlags {
  commit?: boolean;
  message?: string;
  leave?: boolean;
  push?: boolean;
  skipPush?: boolean;
}

const MAX_LISTED = 25;

function describeChanges(d: FinishDetail): string {
  const shown = d.files.slice(0, MAX_LISTED).map((f) => `    ${f.code.trim().padEnd(2)} ${f.path}`);
  const more = d.files.length > MAX_LISTED ? [`    … and ${d.files.length - MAX_LISTED} more`] : [];
  return [
    `  branch     ${d.branch ?? '(detached)'}`,
    `  folder     ${d.dir}`,
    `  changed    ${d.files.length} file(s)`,
    ...shown,
    ...more,
    ...(d.agent ? [`  agent      ${d.agent.verdict}: ${d.agent.summary ?? '(no summary)'}`] : []),
  ].join('\n');
}

/** Applies --commit/--leave/--push/--skip-push to a parked run. `--yes` never counts as consent. */
export async function answerFinish(
  deps: CliDeps,
  runId: string,
  flags: FinishFlags,
): Promise<boolean> {
  const picked = [flags.commit, flags.leave, flags.push, flags.skipPush].filter(Boolean).length;
  if (picked === 0) {
    if (flags.message !== undefined)
      throw new PolicyError('-m/--message goes with --commit', { code: 'usage' });
    return false;
  }
  if (picked > 1)
    throw new PolicyError('choose one of --commit, --leave, --push, --skip-push', {
      code: 'usage',
    });
  if (flags.message !== undefined && !flags.commit)
    throw new PolicyError('-m/--message goes with --commit', { code: 'usage' });
  if (flags.commit || flags.leave) {
    if (flags.leave) deps.engine.submitCommit(runId, { action: 'leave' });
    else {
      const detail = await deps.engine.finishDetail(runId);
      const message = flags.message ?? detail?.message ?? '';
      deps.engine.submitCommit(runId, { action: 'commit', message });
    }
  } else deps.engine.submitPush(runId, flags.push ? 'push' : 'skip');
  return true;
}

/**
 * On a terminal, asks the commit and the push questions at the end of the coding iteration and
 * resumes in between. Elsewhere (or without answers) the run stays parked and `reportFinish` says how
 * to answer: nothing is ever committed or pushed on the owner's behalf.
 */
export async function finishLoop(
  deps: CliDeps,
  io: Io,
  state: RunState,
  resume: (runId: string) => Promise<RunState>,
): Promise<RunState> {
  let s = state;
  while (
    io.isTTY &&
    io.readLine &&
    s.state === 'PARKED' &&
    (s.parked?.reason === 'needs_commit' || s.parked?.reason === 'needs_push')
  ) {
    const d = await deps.engine.finishDetail(s.runId);
    if (!d) break;
    if (s.parked.reason === 'needs_commit') {
      io.stderr(`\nThe agent has stopped. Review the changes:\n${describeChanges(d)}\n`);
      io.stderr(`\n  commit message:\n${d.message.replace(/^/gm, '    ')}\n`);
      io.stderr(
        d.identity
          ? `  committing as ${d.identity.name} <${d.identity.email}>\n`
          : '  git has no user.name/user.email here: set them, then answer again\n',
      );
      const a = (
        await io.readLine('Commit? [y]es / [e]dit the subject / [l]eave uncommitted')
      ).trim();
      const answer = a.toLowerCase()[0];
      if (answer === 'l') deps.engine.submitCommit(s.runId, { action: 'leave' });
      else if (answer === 'y' || answer === 'e') {
        let message = d.message;
        if (answer === 'e') {
          const subject = (await io.readLine('Subject line')).trim();
          if (subject) message = [subject, ...d.message.split('\n').slice(1)].join('\n');
        }
        deps.engine.submitCommit(s.runId, { action: 'commit', message });
      } else break;
    } else {
      io.stderr(
        d.target.repo
          ? `\nPush ${d.commit?.branch ?? d.branch ?? 'the branch'} to ${d.target.repo.owner}/${d.target.repo.name} and open a pull request.\n`
          : `\nCannot push: ${d.target.reason ?? 'no GitHub repository'}.\n`,
      );
      const a = d.target.repo
        ? (await io.readLine('Push and open a pull request? [y]es / [n]o, keep it local'))
            .trim()
            .toLowerCase()[0]
        : 'n';
      if (a === 'y') deps.engine.submitPush(s.runId, 'push');
      else if (a === 'n') deps.engine.submitPush(s.runId, 'skip');
      else break;
    }
    s = await resume(s.runId);
  }
  return s;
}

/** The parked and finished messages of a folder run. Returns null when this is not one. */
export async function reportFinish(deps: CliDeps, io: Io, state: RunState): Promise<number | null> {
  if (!state.input.dir) return null;
  const id = state.runId;
  if (state.state === 'PARKED' && state.parked?.reason === 'needs_commit') {
    const d = await deps.engine.finishDetail(id);
    if (d) io.stderr(`${describeChanges(d)}\n`);
    io.stderr(
      `⏸ run ${id}: the agent has stopped; nothing is committed\n  commit with: incubator resume ${id} --commit [-m "message"]\n  or keep the changes uncommitted: incubator resume ${id} --leave\n`,
    );
    return ExitCode.Policy;
  }
  if (state.state === 'PARKED' && state.parked?.reason === 'needs_push') {
    io.stderr(
      `⏸ run ${id}: committed locally; nothing is pushed\n  push with: incubator resume ${id} --push\n  or stay local: incubator resume ${id} --skip-push\n`,
    );
    return ExitCode.Policy;
  }
  if (state.state === 'DONE') {
    const d = await deps.engine.finishDetail(id);
    if (!d) return null;
    const lines = d.pr
      ? [`✔ opened ${d.pr.url}`]
      : d.commit?.left
        ? [`✔ left the changes uncommitted in ${d.dir}`]
        : d.commit?.none
          ? ['✔ the agent changed nothing; no commit']
          : [
              `✔ committed ${d.commit?.sha?.slice(0, 12) ?? ''} on ${d.commit?.branch ?? d.branch ?? '?'} in ${d.dir}`,
            ];
    io.stderr(`${lines.join('\n')}\n`);
    return ExitCode.Ok;
  }
  return null;
}

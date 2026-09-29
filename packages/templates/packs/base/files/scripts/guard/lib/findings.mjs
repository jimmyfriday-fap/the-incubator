// Normalizes scanner reports into findings with stable fingerprints (ADR-014).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const rank = (s) => SEVERITIES.indexOf(s);
const sha = (s) => createHash('sha256').update(s).digest('hex');

function snippet(root, file, start, end) {
  try {
    const lines = readFileSync(path.join(root, file), 'utf8')
      .split('\n')
      .slice(start - 1, end);
    return lines.join('\n').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function semgrepFindings(root, report) {
  const sev = { ERROR: 'HIGH', WARNING: 'MEDIUM', INFO: 'LOW' };
  return (report.results ?? []).map((r) => ({
    tool: 'semgrep',
    ruleId: r.check_id,
    path: r.path,
    line: r.start?.line ?? 0,
    severity: sev[r.extra?.severity] ?? 'MEDIUM',
    message: r.extra?.message ?? '',
    fingerprint: sha(
      [
        'semgrep',
        r.check_id,
        r.path,
        snippet(root, r.path, r.start?.line ?? 0, r.end?.line ?? 0),
      ].join('\0'),
    ),
  }));
}

export function trivyFindings(report) {
  const out = [];
  for (const res of report.Results ?? []) {
    for (const v of res.Vulnerabilities ?? []) {
      out.push({
        tool: 'trivy',
        ruleId: v.VulnerabilityID,
        path: res.Target,
        line: 0,
        severity: v.Severity ?? 'MEDIUM',
        message: `${v.PkgName}@${v.InstalledVersion}: ${v.Title ?? ''}`,
        fingerprint: sha(['trivy', v.VulnerabilityID, v.PkgName, res.Target].join('\0')),
      });
    }
    for (const m of res.Misconfigurations ?? []) {
      out.push({
        tool: 'trivy',
        ruleId: m.ID,
        path: res.Target,
        line: m.CauseMetadata?.StartLine ?? 0,
        severity: m.Severity ?? 'MEDIUM',
        message: m.Title ?? '',
        fingerprint: sha(
          [
            'trivy',
            m.ID,
            res.Target,
            m.CauseMetadata?.Code?.Lines?.map((l) => l.Content).join('\n') ?? '',
          ].join('\0'),
        ),
      });
    }
    for (const s of res.Secrets ?? []) {
      out.push({
        tool: 'trivy',
        ruleId: s.RuleID,
        path: res.Target,
        line: s.StartLine ?? 0,
        severity: s.Severity ?? 'HIGH',
        message: s.Title ?? '',
        fingerprint: sha(['trivy', s.RuleID, res.Target, s.Match ?? ''].join('\0')),
      });
    }
  }
  return out;
}

export function gitleaksFindings(report) {
  return (Array.isArray(report) ? report : []).map((g) => ({
    tool: 'gitleaks',
    ruleId: g.RuleID,
    path: g.File,
    line: g.StartLine ?? 0,
    severity: 'HIGH',
    message: g.Description ?? 'secret',
    fingerprint: g.Fingerprint ?? sha(['gitleaks', g.RuleID, g.File, g.Secret ?? ''].join('\0')),
  }));
}

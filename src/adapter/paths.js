import path from 'node:path';
import { hasControlCharacter } from './manifest.js';
import { hasExactMembers, isNonNegativeSafeInteger, sameJson } from './schema-helpers.js';

function refuse(error_code, detail) {
  return { ok: false, error_code, detail };
}

export function isSafeLogicalPath(value) {
  return value === '.' || (typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && !/^[A-Za-z]:/.test(value)
    && !/^volume\{[^}]+\}(?:\/|$)/i.test(value)
    && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'));
}

function cumulativeComponents(logicalPath) {
  if (logicalPath === '.') return [];
  const segments = logicalPath.split('/');
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

function isIdentityMember(value) {
  return (typeof value === 'string' && value.length > 0 && !hasControlCharacter(value))
    || isNonNegativeSafeInteger(value);
}

function isValidIdentity(value) {
  if (typeof value === 'string') return isIdentityMember(value);
  if (hasExactMembers(value, ['dev', 'ino'])) {
    return isIdentityMember(value.dev) && isIdentityMember(value.ino);
  }
  if (hasExactMembers(value, ['volume_id', 'file_id'])) {
    return isIdentityMember(value.volume_id) && isIdentityMember(value.file_id);
  }
  return false;
}

function snapshotIssue(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'missing';
  if (!Object.hasOwn(snapshot, 'kind')) return 'invalid-kind';
  if (snapshot.kind !== 'directory') return snapshot.kind;
  if (!Object.hasOwn(snapshot, 'identity') || !isValidIdentity(snapshot.identity)) return 'invalid-identity';
  if (!hasExactMembers(snapshot, ['kind', 'identity'])) return 'invalid-snapshot';
  return null;
}

function snapshotRefusal(pathRole, component, kind, snapshot) {
  const detail = { path_role: pathRole, component, kind };
  if (kind.startsWith('invalid-')) detail.snapshot = snapshot;
  return refuse('path-rejected', detail);
}

export function resolveInvocationPaths({ workspace_root: workspaceRoot, cwd, ledger, before, after }) {
  for (const [role, logicalPath] of [['cwd', cwd], ['ledger', ledger]]) {
    if (!isSafeLogicalPath(logicalPath)) {
      return refuse('path-rejected', { path_role: role, kind: 'invalid-logical-path' });
    }
  }

  const components = [
    { role: 'workspace', logical: '.' },
    ...cumulativeComponents(cwd).map((logical) => ({ role: 'cwd', logical })),
    ...cumulativeComponents(ledger).map((logical) => ({ role: 'ledger', logical })),
  ];
  const seen = new Set();
  for (const { role, logical } of components) {
    if (seen.has(logical)) continue;
    seen.add(logical);
    const initialIssue = snapshotIssue(before?.[logical]);
    if (initialIssue) return snapshotRefusal(role, logical, initialIssue, 'initial');
    const finalIssue = snapshotIssue(after?.[logical]);
    if (finalIssue) return snapshotRefusal(role, logical, finalIssue, 'final');
    if (!sameJson(before[logical].identity, after[logical].identity)) {
      return refuse('path-replaced', { path_role: role, component: logical });
    }
  }

  return {
    ok: true,
    workspace_root: workspaceRoot,
    cwd: cwd === '.' ? workspaceRoot : path.posix.join(workspaceRoot, cwd),
    ledger: ledger === '.' ? workspaceRoot : path.posix.join(workspaceRoot, ledger),
  };
}

import fs from 'fs';
import path from 'path';
import { spacesHome } from '@/lib/spaces-home';

// What the web app's file viewer may touch. The same rules as the terminal
// client's file browser (bin/lib/runtime/files.js); the two are separate
// copies because the web app cannot import from bin/, and each has tests
// pinning the same cases.

/** Credential stores refused even when an allowed folder contains them. */
const DENIED_IN_HOME = [
  '.spaces', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker',
  '.config/gcloud', '.config/gh', '.netrc', '.npmrc', '.pypirc', '.git-credentials',
];
/** Agent config folders: refused, except their transcript stores. */
const AGENT_DIRS = ['.claude', '.codex', '.gemini'];
const TRANSCRIPT_STORES = ['.claude/projects', '.codex/sessions', '.gemini/tmp'];

// The on-disk spelling: real case, and long names for Windows 8.3 short ones.
const realpath = fs.realpathSync.native || fs.realpathSync;
const realOrNull = (p: string): string | null => {
  try { return realpath(p); } catch { return null; }
};
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
const fold = (p: string) => (CASE_INSENSITIVE ? p.toLowerCase() : p);
const inside = (p: string, root: string) => {
  const a = fold(p);
  const r = fold(root);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
};
/** NTFS streams, trailing dots/spaces (which Windows strips) and UNC paths. */
const windowsTrick = (abs: string) =>
  process.platform === 'win32' &&
  (abs.startsWith('\\\\') || abs.split(/[\\/]/).slice(1).some((part) => part.includes(':') || /[. ]$/.test(part)));

/**
 * Resolve a user-supplied path and verify it stays inside an allowed root —
 * the same rules as the terminal client's file browser
 * (bin/lib/runtime/files.js).
 *
 * Allowed: the user's devDirectories and the agent transcript stores.
 * Always refused, even inside an allowed folder: the credential stores above
 * in both the user's home and the server account's own (its ~/.spaces holds
 * this server's secrets whoever is asking), and the rest of the agent config
 * folders. Paths are checked after resolving symlinks and spelling; a
 * dangling symlink is refused, since writing to it would follow it.
 *
 * Returns the resolved path to operate on, or null when refused. Callers
 * MUST treat null as a 404 with no filesystem access.
 */
/**
 * Resolves `input` and checks it against the rules: inside one of `roots`,
 * and never inside a credential store or agent config folder of any of
 * `homes` (the user's own, and the server account's, whose ~/.spaces holds
 * this server's secrets whoever is asking). Paths are compared after
 * resolving symlinks and spelling; a dangling symlink is refused, since
 * writing to it would follow it. Returns the path to operate on, or null.
 */
export function checkFilePath(input: string, { homes, roots }: { homes: string[]; roots: string[] }): string | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  let head = path.resolve(input);
  if (windowsTrick(head)) return null;
  // Nearest existing ancestor, resolved, with the not-yet-existing rest kept
  // (an upload destination).
  const tail: string[] = [];
  let real = realOrNull(head);
  while (!real) {
    try { fs.lstatSync(head); return null; } catch { /* truly absent */ }
    const parent = path.dirname(head);
    if (parent === head) return null;
    tail.unshift(path.basename(head));
    head = parent;
    real = realOrNull(head);
  }
  const target = tail.length ? path.join(real, ...tail) : real;
  if (windowsTrick(target)) return null;

  const realHomes = [...new Set(homes.map((h) => realOrNull(h) || path.resolve(h)))];
  const transcripts = realHomes.flatMap((h) => TRANSCRIPT_STORES.map((d) => path.join(h, d)));
  // The server's data folder, wherever SPACES_HOME puts it (read per call).
  // Unresolvable (SPACES_HOME is a file): refuse everything.
  let dataHome: string;
  try {
    const data = spacesHome();
    dataHome = realOrNull(data) || data;
  } catch {
    return null;
  }
  if (inside(target, dataHome)) return null;
  for (const h of realHomes) {
    if (DENIED_IN_HOME.some((d) => inside(target, path.join(h, d)))) return null;
    if (AGENT_DIRS.some((d) => inside(target, path.join(h, d))) && !transcripts.some((t) => inside(target, t))) {
      return null;
    }
  }
  for (const root of roots) {
    if (inside(target, realOrNull(root) || path.resolve(root))) return target;
  }
  return null;
}

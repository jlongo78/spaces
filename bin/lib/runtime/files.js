'use strict';

// The terminal client's file browser: list, read, write, create folders,
// move and delete on the machine the runtime runs on.
//
// Confined by the same rules as the web app's file viewer
// (src/app/api/files/route.ts): the user's dev directories plus the agent
// transcript stores, and never the folders holding credentials — ~/.spaces
// (this server's own secrets) above all. The rules are duplicated rather
// than shared because the web app cannot import from bin/; tests pin both.
//
// Every path is checked after resolving symlinks, so a link inside a dev
// directory cannot reach outside it. Delete and move act on a link itself,
// never on what it points to.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spacesHome } = require('../spaces-home');

/** Largest chunk read or written per call; a download or upload is many calls. */
const MAX_CHUNK = 1024 * 1024;
/** Entries returned for one folder; the rest are reported as truncated. */
const MAX_ENTRIES = 5000;

/** Credential stores refused even when a dev directory contains them. */
const DENIED_IN_HOME = [
  '.spaces', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker',
  '.config/gcloud', '.config/gh', '.netrc', '.npmrc', '.pypirc', '.git-credentials',
];
/** Agent config folders: refused, except their transcript stores below. */
const AGENT_DIRS = ['.claude', '.codex', '.gemini'];
const TRANSCRIPT_STORES = ['.claude/projects', '.codex/sessions', '.gemini/tmp'];

// `native` returns the name as it is on disk: the real case, and on Windows
// long names for 8.3 short ones (SPACES~1). The JavaScript implementation
// keeps whatever spelling it was given, which made `.SPACES` and `.spaces`
// look like different folders to the checks below.
const realpath = fs.realpathSync.native || fs.realpathSync;

function realOrNull(p) {
  try { return realpath(p); } catch { return null; }
}

/** Windows and macOS file systems ignore case, so the checks must too. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
const fold = (p) => (CASE_INSENSITIVE ? p.toLowerCase() : p);

const inside = (p, root) => {
  const a = fold(p);
  const r = fold(root);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
};
const samePath = (a, b) => fold(a) === fold(b);

/**
 * Windows spellings that name something other than what they appear to:
 * NTFS streams (`name:stream`, `dir::$INDEX_ALLOCATION`), trailing dots and
 * spaces (stripped by Windows, so `.ssh.` is `.ssh`), and UNC paths.
 */
function windowsTrick(abs) {
  if (process.platform !== 'win32') return false;
  if (abs.startsWith('\\\\')) return true;
  return abs.split(/[\\/]/).slice(1).some(part => part.includes(':') || /[. ]$/.test(part));
}

/**
 * The policy for one call: where the browser may go, and what it may never
 * touch. `devRoots` are already resolved (see readDevRoots in index.js).
 */
function createPolicy({ devRoots, home = os.homedir() }) {
  const realHome = realOrNull(home) || path.resolve(home);
  const transcripts = TRANSCRIPT_STORES.map(d => realOrNull(path.join(realHome, d))).filter(Boolean);
  // Resolved here too, however the caller spelled them, so a root and the
  // paths checked against it always share the on-disk spelling.
  const roots = [...new Set([...devRoots.map(r => realOrNull(r) || r), ...transcripts])];
  const denied = DENIED_IN_HOME.map(d => path.join(realHome, d));
  // The server's data folder, wherever SPACES_HOME puts it. Read per call so a
  // changed environment is honoured. If it cannot be resolved (SPACES_HOME is
  // a file), refuse everything rather than guess.
  let failClosed = false;
  try {
    const data = spacesHome();
    denied.push(realOrNull(data) || data);
  } catch { failClosed = true; }
  const agentDirs = AGENT_DIRS.map(d => path.join(realHome, d));

  /** True when the resolved path `p` may be touched at all. */
  function allowed(p) {
    if (failClosed || windowsTrick(p)) return false;
    if (denied.some(d => inside(p, d))) return false;
    if (agentDirs.some(d => inside(p, d)) && !transcripts.some(t => inside(p, t))) return false;
    return roots.some(r => inside(p, r));
  }

  /**
   * Resolves `input` for reading or writing its contents: symlinks followed,
   * and for a path that does not exist yet, its nearest existing ancestor
   * resolved with the rest appended. Null when refused.
   */
  function resolve(input) {
    if (typeof input !== 'string' || !input) return null;
    let head = path.resolve(input);
    if (windowsTrick(head)) return null;
    const tail = [];
    let real = realOrNull(head);
    while (!real) {
      // Something is there but will not resolve: a dangling symlink. Writing
      // to its name would follow it wherever it points, so refuse it.
      try { fs.lstatSync(head); return null; } catch { /* truly absent */ }
      const parent = path.dirname(head);
      if (parent === head) return null;
      tail.unshift(path.basename(head));
      head = parent;
      real = realOrNull(head);
    }
    const full = tail.length ? path.join(real, ...tail) : real;
    return allowed(full) ? full : null;
  }

  /**
   * Resolves `input` as an entry to delete or move: its folder resolved, its
   * own name kept, so a symlink is acted on and its target left alone.
   */
  function resolveEntry(input) {
    if (typeof input !== 'string' || !input) return null;
    const abs = path.resolve(input);
    if (windowsTrick(abs)) return null;
    const dir = resolve(path.dirname(abs));
    if (!dir) return null;
    const full = path.join(dir, path.basename(abs));
    return allowed(full) && !roots.some(r => samePath(r, full)) ? full : null;
  }

  const isRoot = (p) => roots.some(r => samePath(r, p));

  return { roots, allowed, resolve, resolveEntry, isRoot };
}

function entryOf(dir, dirent) {
  const full = path.join(dir, dirent.name);
  let type = 'other';
  let size = 0;
  let mtime = 0;
  try {
    const l = fs.lstatSync(full);
    mtime = l.mtimeMs;
    if (l.isSymbolicLink()) {
      try {
        const s = fs.statSync(full);
        type = s.isDirectory() ? 'link-dir' : 'link-file';
        size = s.isDirectory() ? 0 : s.size;
      } catch { type = 'link-broken'; }
    } else if (l.isDirectory()) {
      type = 'dir';
    } else if (l.isFile()) {
      type = 'file';
      size = l.size;
    }
  } catch { /* vanished mid-listing */ }
  return { name: dirent.name, path: full, type, size, mtime };
}

const fail = (code, error) => ({ ok: false, code, error });
const done = (result) => ({ ok: true, result });
const refused = (p) => fail('bad_request', `${p} is outside the folders the file browser may use`);
const errno = (e, p) => (e.code === 'ENOENT' ? fail('not_found', `no such file or folder ${p}`)
  : e.code === 'EEXIST' || e.code === 'ENOTEMPTY' ? fail('conflict', `${p} already exists`)
    : fail('bad_request', `${p}: ${e.code || e.message}`));

/** Decodes a base64 chunk, refusing anything not base64 or over MAX_CHUNK. */
function decodeChunk(data) {
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const buf = Buffer.from(data, 'base64');
  return buf.length <= MAX_CHUNK ? buf : null;
}

/** The fs.* methods. `policy` comes from createPolicy for each call. */
const methods = {
  list(policy, { path: dir }) {
    const target = dir === undefined ? policy.roots[0] : policy.resolve(dir);
    if (!target) return dir === undefined ? fail('not_found', 'no folders are available to browse') : refused(dir);
    let dirents;
    try { dirents = fs.readdirSync(target, { withFileTypes: true }); } catch (e) { return errno(e, target); }
    const entries = dirents
      // Resolved, so a link is listed only when where it leads is allowed.
      .filter(d => policy.resolve(path.join(target, d.name)) !== null)
      .map(d => entryOf(target, d))
      .sort((a, b) => {
        const dirA = a.type === 'dir' || a.type === 'link-dir';
        const dirB = b.type === 'dir' || b.type === 'link-dir';
        return dirA !== dirB ? (dirA ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    const parent = path.dirname(target);
    return done({
      current: target,
      parent: policy.isRoot(target) || !policy.allowed(parent) ? null : parent,
      entries: entries.slice(0, MAX_ENTRIES),
      truncated: entries.length > MAX_ENTRIES,
      roots: policy.roots,
    });
  },

  read(policy, { path: file, offset = 0, length = MAX_CHUNK }) {
    if (!Number.isInteger(offset) || offset < 0) return fail('bad_request', 'offset must be a non-negative integer');
    if (!Number.isInteger(length) || length < 1 || length > MAX_CHUNK) {
      return fail('bad_request', `length must be between 1 and ${MAX_CHUNK}`);
    }
    const target = policy.resolve(file);
    if (!target) return refused(file);
    let fd;
    try {
      const st = fs.statSync(target);
      if (!st.isFile()) return fail('bad_request', `${target} is not a file`);
      fd = fs.openSync(target, 'r');
      const buf = Buffer.alloc(Math.min(length, Math.max(0, st.size - offset)));
      const n = buf.length ? fs.readSync(fd, buf, 0, buf.length, offset) : 0;
      return done({
        path: target, size: st.size, mtime: st.mtimeMs, offset,
        data: buf.subarray(0, n).toString('base64'), eof: offset + n >= st.size,
      });
    } catch (e) {
      return errno(e, target);
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ }
    }
  },

  /**
   * mode: 'create' (must not exist), 'truncate' (create or replace),
   * 'append' (must exist). `expectMtime` refuses a save over a file changed
   * since it was opened.
   */
  write(policy, { path: file, data, mode = 'create', expectMtime }) {
    if (!['create', 'truncate', 'append'].includes(mode)) return fail('bad_request', 'mode must be create, truncate or append');
    const buf = decodeChunk(data);
    if (!buf) return fail('bad_request', `data must be base64 of at most ${MAX_CHUNK} bytes`);
    const target = policy.resolve(file);
    if (!target) return refused(file);
    try {
      if (expectMtime !== undefined) {
        const st = fs.statSync(target);
        if (Math.abs(st.mtimeMs - expectMtime) > 1) return fail('conflict', `${target} changed since it was opened`);
      }
      const flag = mode === 'create' ? 'wx' : mode === 'truncate' ? 'w' : 'r+';
      const fd = fs.openSync(target, flag);
      try {
        const at = mode === 'append' ? fs.fstatSync(fd).size : 0;
        fs.writeSync(fd, buf, 0, buf.length, at);
      } finally {
        fs.closeSync(fd);
      }
      const st = fs.statSync(target);
      return done({ path: target, size: st.size, mtime: st.mtimeMs });
    } catch (e) {
      return errno(e, target);
    }
  },

  mkdir(policy, { path: dir }) {
    const target = policy.resolve(dir);
    if (!target) return refused(dir);
    try { fs.mkdirSync(target); } catch (e) { return errno(e, target); }
    return done({ path: target });
  },

  move(policy, { from, to, overwrite = false }) {
    const source = policy.resolveEntry(from);
    if (!source) return refused(from);
    const dest = policy.resolveEntry(to);
    if (!dest) return refused(to);
    try {
      fs.lstatSync(source);
      if (inside(dest, source)) return fail('bad_request', 'cannot move a folder into itself');
      if (fs.existsSync(dest) && !overwrite) return fail('conflict', `${dest} already exists`);
      try {
        fs.renameSync(source, dest);
      } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        fs.cpSync(source, dest, { recursive: true, verbatimSymlinks: true, force: overwrite });
        fs.rmSync(source, { recursive: true });
      }
    } catch (e) {
      return errno(e, source);
    }
    return done({ path: dest });
  },

  delete(policy, { path: entry }) {
    const target = policy.resolveEntry(entry);
    if (!target) return refused(entry);
    try {
      fs.lstatSync(target);
      fs.rmSync(target, { recursive: true });
    } catch (e) {
      return errno(e, target);
    }
    return done({ ok: true });
  },
};

const FILE_METHODS = Object.keys(methods).map(m => `fs.${m}`);

/** Dispatches one fs.* call. `params` was not validated beyond being an object. */
function dispatchFile(method, params, { devRoots, home }) {
  const fn = methods[method.slice(3)];
  const p = params || {};
  for (const key of ['path', 'from', 'to']) {
    if (p[key] !== undefined && (typeof p[key] !== 'string' || !p[key])) {
      return fail('bad_request', `${key} must be a non-empty string`);
    }
  }
  if (method !== 'fs.list' && method !== 'fs.move' && p.path === undefined) {
    return fail('bad_request', 'path is required');
  }
  if (method === 'fs.move' && (p.from === undefined || p.to === undefined)) {
    return fail('bad_request', 'from and to are required');
  }
  return fn(createPolicy({ devRoots, home }), p);
}

module.exports = { dispatchFile, createPolicy, FILE_METHODS, MAX_CHUNK };

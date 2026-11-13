/**
 * An append-only record of what federated peers did.
 *
 * One JSON object per line: greppable, tailable, and parseable without a
 * schema. Written for the moment something has gone wrong and the question is
 * "which machine, when, and what did it ask for".
 *
 * Two properties matter more than completeness:
 *
 *   - **It never writes a secret.** An audit log is precisely the file someone
 *     pastes into a bug report. Fields that could carry key material are
 *     dropped on the way in rather than trusted not to be passed.
 *   - **It never takes the listener down.** A full disk or an unwritable path
 *     degrades to no logging, not to a refused connection.
 */

const fs = require('fs');
const path = require('path');
const { spacesHome } = require('../spaces-home');

const DEFAULT_PATH = path.join(spacesHome(), 'federation.log');

/**
 * Field names never written, whatever a caller passes.
 *
 * A denied list rather than an allowed one because audit records grow new
 * descriptive fields often, and having to add each to an allow-list would push
 * people toward logging less. The trade is deliberate and narrow: these names
 * cover everything in this codebase that holds key material.
 */
const REDACTED = new Set([
  'apiKey',
  'api_key',
  'apiKeyEncrypted',
  'api_key_encrypted',
  'privateKey',
  'privateKeyPem',
  'signature',
  'signatureB64',
  'token',
  'terminalToken',
  'nonce',
  'secret',
  'password',
]);

function createAuditLog({ path: logPath = DEFAULT_PATH, now = Date.now } = {}) {
  let broken = false;

  return {
    record(entry) {
      if (broken) return;
      try {
        const safe = { ts: new Date(now()).toISOString() };
        for (const [key, value] of Object.entries(entry || {})) {
          if (REDACTED.has(key)) continue;
          safe[key] = value;
        }
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify(safe) + '\n');
      } catch {
        // Log once by giving up quietly: a listener that refuses connections
        // because it cannot write a log file has turned an observability
        // problem into an outage.
        broken = true;
      }
    },
    get path() {
      return logPath;
    },
  };
}

module.exports = { createAuditLog, REDACTED, DEFAULT_PATH };

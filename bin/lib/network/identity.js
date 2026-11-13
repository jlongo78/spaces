/**
 * This node's cryptographic identity.
 *
 * A node used to be a bare UUID in `~/.spaces/node.json`, which is a name, not
 * a credential: it lets a peer say who it is and gives nobody any way to check.
 * Federation authenticates a channel that can spawn PTYs, so identity has to be
 * something a peer can *prove*. Hence an Ed25519 keypair.
 *
 * Ed25519 rather than RSA or ECDSA: small keys, small signatures, no parameter
 * choices to get wrong, deterministic signing (no per-signature entropy to leak
 * a key when an RNG misbehaves), and it is native to Node's crypto — federation
 * adds no dependency to reach it.
 *
 * The private key lives in its own file with 0600, never in `node.json`, which
 * several call sites read, copy and print. That split follows the pattern
 * already set by `~/.spaces/terminal_secret` and `~/.spaces/service_key`.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spacesHome } = require('../spaces-home');

const DEFAULT_DIR = spacesHome();
const NODE_JSON = 'node.json';
const NODE_KEY = 'node_key';

/**
 * Loads this node's identity, creating whatever part of it is missing.
 *
 * Handles three states: nothing yet (generate everything), a pre-keypair
 * `node.json` from an older install (keep its nodeId and name, add a key), and
 * a complete identity (load it). The upgrade case matters — a node's id is
 * already recorded in peers' databases and in mDNS advertisements, so
 * regenerating it would silently orphan every existing pairing.
 */
function loadOrCreateIdentity({ dir = DEFAULT_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, NODE_JSON);
  const keyPath = path.join(dir, NODE_KEY);

  let record = {};
  try {
    if (fs.existsSync(jsonPath)) {
      record = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) || {};
    }
  } catch {
    // A corrupt node.json is replaced rather than fatal: it holds no secret,
    // and refusing to start over an unparseable name file would be worse than
    // minting a new id.
    record = {};
  }

  if (!record.nodeId) record.nodeId = crypto.randomUUID();
  if (!record.nodeName) record.nodeName = os.hostname();
  if (!record.createdAt) record.createdAt = new Date().toISOString();

  let privateKeyPem = null;
  if (fs.existsSync(keyPath)) {
    privateKeyPem = fs.readFileSync(keyPath, 'utf-8');
  }

  // The public key is only trustworthy if it matches the private key we hold;
  // a node.json edited by hand must not be able to make us advertise a key we
  // cannot sign with.
  let publicKey = null;
  if (privateKeyPem) {
    try {
      publicKey = derivePublicKey(privateKeyPem);
    } catch {
      privateKeyPem = null;
    }
  }

  if (!privateKeyPem) {
    const pair = crypto.generateKeyPairSync('ed25519');
    privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    writeSecret(keyPath, privateKeyPem);
    publicKey = derivePublicKey(privateKeyPem);
  }

  record.publicKey = publicKey;
  // Belt and braces: a private key must never end up in the readable file,
  // however a caller mangled the record it passed through here.
  delete record.privateKey;
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2));

  return {
    nodeId: record.nodeId,
    nodeName: record.nodeName,
    createdAt: record.createdAt,
    publicKey,
    privateKeyPem,
  };
}

/** The raw Ed25519 public key, base64 — what a peer records at pair time. */
function derivePublicKey(privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const pub = crypto.createPublicKey(key);
  // 'der'/'spki' then base64 rather than PEM: one line, no header noise, and
  // it round-trips through JSON and a SQLite column unchanged.
  return pub.export({ type: 'spki', format: 'der' }).toString('base64');
}

/** Writes `contents` readable only by this user, on both platform families. */
function writeSecret(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o600 });
  if (process.platform === 'win32') {
    // POSIX mode bits are advisory on Windows; the ACL is what actually
    // restricts access, the same treatment ensureServiceKeyAtRuntime gives
    // the SSH service key in bin/terminal-server.js.
    try {
      const { spawnSync } = require('child_process');
      spawnSync(
        'icacls',
        [
          file,
          '/inheritance:r',
          '/grant:r',
          `${os.userInfo().username}:(F)`,
          '/grant',
          'NT AUTHORITY\\SYSTEM:(F)',
        ],
        { stdio: 'pipe', timeout: 5000 }
      );
    } catch {
      // Best effort — a failed ACL tightening must not stop the node starting.
    }
  }
}

function publicKeyB64(identity) {
  return identity.publicKey;
}

/** Signs `message` with this node's private key. Returns base64. */
function sign(identity, message) {
  const key = crypto.createPrivateKey(identity.privateKeyPem);
  return crypto.sign(null, Buffer.from(message), key).toString('base64');
}

/**
 * Verifies `signatureB64` over `message` under `publicKeyB64`.
 *
 * Returns `false` for anything malformed rather than throwing. Every argument
 * here arrives from the network in a later phase, and a verifier that throws on
 * a bad key is a denial of service wearing a stack trace.
 */
function verify(publicKeyB64Value, message, signatureB64) {
  if (!publicKeyB64Value || !signatureB64) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64Value, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      null,
      Buffer.from(message),
      key,
      Buffer.from(signatureB64, 'base64')
    );
  } catch {
    return false;
  }
}

module.exports = {
  loadOrCreateIdentity,
  publicKeyB64,
  sign,
  verify,
  DEFAULT_DIR,
};

/**
 * mDNS service: advertises this Spaces node on the LAN and discovers peers.
 * Required by terminal-server.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE_JSON_PATH = path.join(os.homedir(), '.spaces', 'node.json');
const NETWORK_DB_PATH = path.join(os.homedir(), '.spaces', 'network.db');

function getNodeIdentity() {
  try {
    if (fs.existsSync(NODE_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(NODE_JSON_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }

  // Create lazily
  const crypto = require('crypto');
  const identity = {
    nodeId: crypto.randomUUID(),
    nodeName: os.hostname(),
    createdAt: new Date().toISOString(),
  };
  const dir = path.dirname(NODE_JSON_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(NODE_JSON_PATH, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

function getVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

let _networkDbRW = null;

function getNetworkDbRW() {
  if (_networkDbRW) return _networkDbRW;
  try {
    const Database = require('better-sqlite3');
    const dir = path.dirname(NETWORK_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(NETWORK_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL DEFAULT '',
        api_key_hint TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unknown',
        last_seen TEXT,
        last_error TEXT,
        session_count INTEGER DEFAULT 0,
        version TEXT,
        discovered_via TEXT DEFAULT 'manual',
        created TEXT DEFAULT (datetime('now')),
        updated TEXT DEFAULT (datetime('now'))
      );
    `);
    _networkDbRW = db;
    return db;
  } catch (err) {
    console.error('[mDNS] Failed to open network DB:', err.message);
    return null;
  }
}

function upsertDiscoveredNode(info) {
  const db = getNetworkDbRW();
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO nodes (id, name, url, api_key_encrypted, api_key_hint, status, version, discovered_via, last_seen)
      VALUES (?, ?, ?, '', '', 'online', ?, 'mdns', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        version = excluded.version,
        status = 'online',
        last_seen = datetime('now'),
        updated = datetime('now')
    `).run(info.nodeId, info.nodeName, info.url, info.version);
    console.log(`[mDNS] Discovered: ${info.nodeName} at ${info.url}`);
  } catch (err) {
    console.error('[mDNS] DB upsert error:', err.message);
  }
}

function markNodeOffline(nodeId) {
  const db = getNetworkDbRW();
  if (!db) return;
  try {
    db.prepare(`
      UPDATE nodes SET status = 'offline', updated = datetime('now')
      WHERE id = ? AND discovered_via = 'mdns'
    `).run(nodeId);
  } catch { /* ignore */ }
}

function startMdns(port) {
  let Bonjour;
  try {
    Bonjour = require('bonjour-service').Bonjour;
  } catch (err) {
    console.log('[mDNS] bonjour-service not available, skipping discovery:', err.message);
    return;
  }

  const identity = getNodeIdentity();
  const version = getVersion();
  const bonjour = new Bonjour();

  // Advertise this node
  const service = bonjour.publish({
    name: identity.nodeName,
    type: 'spaces-agent',
    port: port,
    txt: {
      nodeId: identity.nodeId,
      version: version,
      protocol: 'http',
    },
  });

  console.log(`[mDNS] Advertising as "${identity.nodeName}" (${identity.nodeId.slice(0, 8)}) on port ${port}`);

  // Browse for peers
  const browser = bonjour.find({ type: 'spaces-agent' });

  browser.on('up', (svc) => {
    const remoteNodeId = svc.txt?.nodeId;
    if (!remoteNodeId || remoteNodeId === identity.nodeId) return; // Skip self

    const protocol = svc.txt?.protocol || 'http';
    const host = svc.host || svc.referer?.address;
    if (!host) return;

    const url = `${protocol}://${host}:${svc.port}`;
    upsertDiscoveredNode({
      nodeId: remoteNodeId,
      nodeName: svc.name || host,
      url,
      version: svc.txt?.version || '',
    });
  });

  browser.on('down', (svc) => {
    const remoteNodeId = svc.txt?.nodeId;
    if (remoteNodeId && remoteNodeId !== identity.nodeId) {
      markNodeOffline(remoteNodeId);
      console.log(`[mDNS] Node went down: ${svc.name}`);
    }
  });

  return { bonjour, service, browser };
}

module.exports = { startMdns };

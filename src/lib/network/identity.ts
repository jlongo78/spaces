import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { NodeIdentity } from '../../types/network';
import { spacesHome } from '@/lib/spaces-home';

const NODE_JSON_PATH = path.join(spacesHome(), 'node.json');

let _cached: NodeIdentity | null = null;

function getVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function getNodeIdentity(): NodeIdentity {
  if (_cached) {
    return { ..._cached, version: getVersion() };
  }

  const dir = path.dirname(NODE_JSON_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(NODE_JSON_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(NODE_JSON_PATH, 'utf-8'));
      _cached = {
        nodeId: data.nodeId,
        nodeName: data.nodeName || os.hostname(),
        version: getVersion(),
        createdAt: data.createdAt,
      };
      return _cached;
    } catch {
      // Corrupt file, recreate below
    }
  }

  const identity: NodeIdentity = {
    nodeId: crypto.randomUUID(),
    nodeName: os.hostname(),
    version: getVersion(),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(NODE_JSON_PATH, JSON.stringify({
    nodeId: identity.nodeId,
    nodeName: identity.nodeName,
    createdAt: identity.createdAt,
  }, null, 2), { mode: 0o600 });

  _cached = identity;
  return identity;
}

export function setNodeName(name: string): void {
  const identity = getNodeIdentity();
  const data = {
    nodeId: identity.nodeId,
    nodeName: name,
    createdAt: identity.createdAt,
  };
  fs.writeFileSync(NODE_JSON_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
  _cached = { ...data, version: getVersion() };
}

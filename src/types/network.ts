export interface NodeRecord {
  id: string;
  name: string;
  url: string;
  apiKeyHint: string;
  status: 'online' | 'offline' | 'error' | 'unknown';
  lastSeen: string | null;
  lastError: string | null;
  sessionCount: number;
  version: string | null;
  discoveredVia: 'manual' | 'mdns';
  created: string;
  updated: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string;
  lastUsed: string | null;
  created: string;
  expires: string | null;
  username: string | null;
}

export interface NodeIdentity {
  nodeId: string;
  nodeName: string;
  version: string;
  createdAt: string;
}

export interface DiscoveredNode {
  nodeId: string;
  nodeName: string;
  host: string;
  port: number;
  version: string;
}

export interface HandshakeResponse {
  nodeId: string;
  nodeName: string;
  version: string;
  sessionCount: number;
  projectCount: number;
  workspaceCount: number;
}

import type { Workspace } from '@/types/claude';

export interface RemoteNode {
  nodeId: string;
  nodeName: string;
  workspaces: Workspace[];
}

export interface RemoteError {
  nodeId: string;
  nodeName: string;
  error: string;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  color: string;
  paneCount: number;
  category?: string;
}

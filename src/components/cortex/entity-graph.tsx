'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { EntityDetail } from './entity-detail';

interface GraphEntity {
  id: string;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
}

interface GraphNode extends GraphEntity {
  x?: number;
  y?: number;
  // Cluster fields
  _cluster?: boolean;
  _clusterType?: string;
  _clusterCount?: number;
  _clusterNodes?: string[];
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

type GraphInstance = {
  graphData: (data: { nodes: GraphNode[]; links: GraphLink[] }) => GraphInstance;
  nodeCanvasObject: (cb: (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => void) => GraphInstance;
  nodePointerAreaPaint: (cb: (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => void) => GraphInstance;
  linkColor: (cb: (link: GraphLink) => string) => GraphInstance;
  linkWidth: (cb: (link: GraphLink) => number) => GraphInstance;
  linkVisibility: (cb: (link: GraphLink) => boolean) => GraphInstance;
  nodeVisibility: (cb: (node: GraphNode) => boolean) => GraphInstance;
  onNodeClick: (cb: (node: GraphNode) => void) => GraphInstance;
  onBackgroundClick: (cb: () => void) => GraphInstance;
  onZoom: (cb: (zoom: { k: number }) => void) => GraphInstance;
  width: (w: number) => GraphInstance;
  height: (h: number) => GraphInstance;
  zoom: () => number;
  zoomToFit: (ms?: number, px?: number) => GraphInstance;
  d3Force: (name: string, force?: any) => any;
  _destructor: () => void;
};

const NODE_COLORS: Record<string, string> = {
  person: '#7c3aed',
  team: '#10b981',
  project: '#10b981',
  system: '#f59e0b',
  module: '#f59e0b',
  topic: '#06b6d4',
  department: '#3b82f6',
  organization: '#3b82f6',
};

function getNodeColor(type: string): string {
  return NODE_COLORS[type] ?? '#6b7280';
}

// ─── Clustering logic ────────────────────────────────────────

const CLUSTER_ZOOM_THRESHOLD = 1.2; // below this zoom level, cluster nodes

function buildClusteredGraph(
  allNodes: GraphNode[],
  allLinks: GraphLink[],
  hiddenTypes: Set<string>,
  zoomLevel: number,
): { nodes: GraphNode[]; links: GraphLink[] } {
  // Filter by hidden types
  const visibleNodes = allNodes.filter(n => !hiddenTypes.has(n.type));
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  const visibleLinks = allLinks.filter(l => visibleIds.has(l.source) && visibleIds.has(l.target));

  if (zoomLevel >= CLUSTER_ZOOM_THRESHOLD || visibleNodes.length <= 20) {
    return { nodes: visibleNodes, links: visibleLinks };
  }

  // Group by type for clustering
  const typeGroups = new Map<string, GraphNode[]>();
  const important = new Set<string>(); // nodes with many connections stay unclustered

  // Count connections per node
  const connectionCount = new Map<string, number>();
  for (const link of visibleLinks) {
    connectionCount.set(link.source, (connectionCount.get(link.source) ?? 0) + 1);
    connectionCount.set(link.target, (connectionCount.get(link.target) ?? 0) + 1);
  }

  // Nodes with 3+ connections or type person/project stay individual
  for (const node of visibleNodes) {
    const conns = connectionCount.get(node.id) ?? 0;
    if (conns >= 3 || node.type === 'person' || node.type === 'project') {
      important.add(node.id);
    } else {
      const group = typeGroups.get(node.type) ?? [];
      group.push(node);
      typeGroups.set(node.type, group);
    }
  }

  const clusteredNodes: GraphNode[] = [];
  const clusteredLinks: GraphLink[] = [];
  const nodeToCluster = new Map<string, string>();

  // Add important nodes as-is
  for (const node of visibleNodes) {
    if (important.has(node.id)) {
      clusteredNodes.push(node);
    }
  }

  // Create cluster nodes for each type group
  for (const [type, group] of typeGroups) {
    if (group.length <= 2) {
      // Too few to cluster — keep individual
      clusteredNodes.push(...group);
    } else {
      const clusterId = `_cluster_${type}`;
      const clusterNode: GraphNode = {
        id: clusterId,
        name: `${group.length} ${type}s`,
        type,
        metadata: {},
        _cluster: true,
        _clusterType: type,
        _clusterCount: group.length,
        _clusterNodes: group.map(n => n.id),
      };
      clusteredNodes.push(clusterNode);
      for (const n of group) {
        nodeToCluster.set(n.id, clusterId);
      }
    }
  }

  // Remap links: if source or target is clustered, point to cluster node
  const linkSet = new Set<string>();
  for (const link of visibleLinks) {
    const src = nodeToCluster.get(link.source) ?? link.source;
    const tgt = nodeToCluster.get(link.target) ?? link.target;
    if (src === tgt) continue; // skip self-links within cluster
    const key = `${src}→${tgt}`;
    if (linkSet.has(key)) continue;
    linkSet.add(key);
    clusteredLinks.push({ ...link, source: src, target: tgt });
  }

  return { nodes: clusteredNodes, links: clusteredLinks };
}

// ─── Node rendering ──────────────────────────────────────────

function drawNode(
  node: GraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  selected: boolean,
) {
  const color = getNodeColor(node.type);
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  ctx.save();

  if (selected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }

  // Cluster bubble
  if (node._cluster) {
    const count = node._clusterCount ?? 0;
    const r = Math.max(10, Math.sqrt(count) * 4) / Math.sqrt(globalScale);

    // Outer glow
    ctx.beginPath();
    ctx.arc(x, y, r * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = color + '10';
    ctx.fill();

    // Main bubble
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color + '25';
    ctx.fill();
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 1.5 / globalScale;
    ctx.setLineDash([3 / globalScale, 3 / globalScale]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Count label
    const fontSize = Math.max(3, 11 / globalScale);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color + 'cc';
    ctx.fillText(String(count), x, y);

    // Type label below
    const smallFont = Math.max(2, 8 / globalScale);
    ctx.font = `${smallFont}px sans-serif`;
    ctx.fillStyle = color + '88';
    ctx.textBaseline = 'top';
    ctx.fillText(node._clusterType + 's', x, y + r + 2 / globalScale);

    ctx.restore();
    return;
  }

  const type = node.type;
  const r = Math.max(4, 8 / Math.sqrt(globalScale));

  if (type === 'person' || type === 'topic') {
    const radius = type === 'topic' ? r * 0.7 : r;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 / globalScale : 1.5 / globalScale;
    ctx.stroke();
  } else if (type === 'system' || type === 'module') {
    const size = r * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 / globalScale : 1.5 / globalScale;
    ctx.stroke();
  } else {
    const w = r * 2.2;
    const h = r * 1.5;
    const rx = 3 / globalScale;
    const lx = x - w / 2;
    const ly = y - h / 2;
    ctx.beginPath();
    ctx.moveTo(lx + rx, ly);
    ctx.lineTo(lx + w - rx, ly);
    ctx.quadraticCurveTo(lx + w, ly, lx + w, ly + rx);
    ctx.lineTo(lx + w, ly + h - rx);
    ctx.quadraticCurveTo(lx + w, ly + h, lx + w - rx, ly + h);
    ctx.lineTo(lx + rx, ly + h);
    ctx.quadraticCurveTo(lx, ly + h, lx, ly + h - rx);
    ctx.lineTo(lx, ly + rx);
    ctx.quadraticCurveTo(lx, ly, lx + rx, ly);
    ctx.closePath();
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 / globalScale : 1.5 / globalScale;
    ctx.stroke();
  }

  // Label — hide at very low zoom to reduce clutter
  if (globalScale > 0.4) {
    const fontSize = Math.max(2, 10 / globalScale);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e5e7eb';
    const label = node.name.length > 16 ? node.name.slice(0, 15) + '\u2026' : node.name;
    ctx.fillText(label, x, y + r * 1.4);
  }

  ctx.restore();
}

// ─── Legend / filter items ───────────────────────────────────

const LEGEND_ITEMS = [
  { label: 'Person', color: '#7c3aed', shape: 'circle', types: ['person'] },
  { label: 'Team / Project', color: '#10b981', shape: 'rect', types: ['team', 'project'] },
  { label: 'System / Module', color: '#f59e0b', shape: 'diamond', types: ['system', 'module'] },
  { label: 'Topic', color: '#06b6d4', shape: 'circle-sm', types: ['topic'] },
  { label: 'Dept / Org', color: '#3b82f6', shape: 'rect', types: ['department', 'organization'] },
];

// ─── Main component ─────────────────────────────────────────

export function EntityGraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allLinks, setAllLinks] = useState<GraphLink[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [zoomLevel, setZoomLevel] = useState(1);
  const selectedRef = useRef<GraphNode | null>(null);
  const zoomRef = useRef(1);
  const hiddenRef = useRef<Set<string>>(new Set());

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { hiddenRef.current = hiddenTypes; }, [hiddenTypes]);

  // Fetch graph data
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(api('/api/cortex/graph/entities')).then(r => r.json()),
      fetch(api('/api/cortex/graph/edges?all=true')).then(r => r.json()),
    ])
      .then(([entityData, edgeData]) => {
        setAllNodes((entityData.entities ?? []).map((e: GraphEntity) => ({ ...e })));
        setAllLinks((edgeData.edges ?? []).map((e: GraphEdge) => ({
          source: e.source_id, target: e.target_id, relation: e.relation, weight: e.weight ?? 1,
        })));
      })
      .catch(() => { setAllNodes([]); setAllLinks([]); })
      .finally(() => setLoading(false));
  }, []);

  // Rebuild graph when data/filters/zoom change
  const updateGraph = useCallback(() => {
    if (!graphRef.current) return;
    const { nodes, links } = buildClusteredGraph(allNodes, allLinks, hiddenRef.current, zoomRef.current);
    graphRef.current.graphData({ nodes, links });
  }, [allNodes, allLinks]);

  // Build the force-graph
  useEffect(() => {
    if (loading || !containerRef.current) return;
    if (graphRef.current) { graphRef.current._destructor?.(); graphRef.current = null; }
    if (allNodes.length === 0) return;

    const el = containerRef.current;
    const width = el.clientWidth || 800;
    const height = el.clientHeight || 600;
    if (width < 10 || height < 10) return;

    import('force-graph').then(({ default: ForceGraph2D }) => {
      if (!containerRef.current) return;

      const { nodes, links } = buildClusteredGraph(allNodes, allLinks, hiddenTypes, zoomLevel);
      const builder = ForceGraph2D as unknown as () => (el: HTMLElement) => GraphInstance;
      const graph = builder()(containerRef.current)
        .graphData({ nodes, links })
        .width(width)
        .height(height)
        .nodeCanvasObject((node, ctx, globalScale) => {
          drawNode(node, ctx, globalScale, selectedRef.current?.id === node.id);
        })
        .nodePointerAreaPaint((node, color, ctx) => {
          const r = node._cluster ? Math.max(14, Math.sqrt(node._clusterCount ?? 1) * 5) : 12;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        })
        .linkColor(() => 'rgba(124, 58, 237, 0.15)')
        .linkWidth((link) => Math.max(0.3, Math.min(3, Math.sqrt(link.weight ?? 1) * 0.6)))
        .onNodeClick((node) => {
          if (node._cluster) {
            // Zoom into cluster — show its children
            setHiddenTypes(new Set()); // clear filters
            zoomRef.current = CLUSTER_ZOOM_THRESHOLD + 0.1;
            setZoomLevel(zoomRef.current);
          } else {
            setSelected(node);
          }
        })
        .onBackgroundClick(() => setSelected(null))
        .onZoom(({ k }) => {
          const prev = zoomRef.current;
          zoomRef.current = k;
          // Only rebuild when crossing the cluster threshold
          const crossedThreshold =
            (prev < CLUSTER_ZOOM_THRESHOLD && k >= CLUSTER_ZOOM_THRESHOLD) ||
            (prev >= CLUSTER_ZOOM_THRESHOLD && k < CLUSTER_ZOOM_THRESHOLD);
          if (crossedThreshold) {
            setZoomLevel(k);
          }
        });

      graphRef.current = graph;
      setTimeout(() => graph.zoomToFit(400, 40), 300);
    });

    return () => { if (graphRef.current) { graphRef.current._destructor?.(); graphRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, allNodes, allLinks, hiddenTypes, zoomLevel]);

  const handleRecenter = useCallback(() => graphRef.current?.zoomToFit(400, 40), []);
  const handleClose = useCallback(() => setSelected(null), []);

  const toggleType = (types: string[]) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      const allHidden = types.every(t => next.has(t));
      for (const t of types) {
        if (allHidden) next.delete(t); else next.add(t);
      }
      return next;
    });
  };

  const nodeCount = allNodes.length;
  const visibleCount = allNodes.filter(n => !hiddenTypes.has(n.type)).length;

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading graph\u2026</div>;
  }

  if (allNodes.length === 0) {
    const handlePopulate = async () => {
      setLoading(true);
      try {
        await fetch(api('/api/cortex/graph/populate'), { method: 'POST' });
        const [entityData, edgeData] = await Promise.all([
          fetch(api('/api/cortex/graph/entities')).then(r => r.json()),
          fetch(api('/api/cortex/graph/edges?all=true')).then(r => r.json()),
        ]);
        setAllNodes((entityData.entities ?? []).map((e: GraphEntity) => ({ ...e })));
        setAllLinks((edgeData.edges ?? []).map((e: GraphEdge) => ({
          source: e.source_id, target: e.target_id, relation: e.relation, weight: e.weight ?? 1,
        })));
      } catch { /* */ }
      finally { setLoading(false); }
    };

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
        <div className="text-4xl opacity-20">{'\u25C8'}</div>
        <div className="text-sm">No entities in the graph yet.</div>
        <div className="text-xs text-gray-600 text-center max-w-xs">
          Build the graph from your workspaces, projects, and sessions.
        </div>
        <button
          onClick={handlePopulate}
          className="mt-1 px-3 py-1.5 text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-md hover:bg-purple-500/30 transition-colors"
        >
          Populate graph
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden h-full">
      <div className="relative flex-1 min-w-0">
        <div ref={containerRef} className="w-full h-full" />

        {/* Legend + filter — top-right */}
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg p-2.5 text-[10px]">
          <div className="text-gray-400 uppercase tracking-wider mb-1.5 font-medium">
            Filter
            {hiddenTypes.size > 0 && (
              <span className="ml-1.5 text-gray-600 normal-case">
                {visibleCount}/{nodeCount}
              </span>
            )}
          </div>
          {LEGEND_ITEMS.map((item) => {
            const isHidden = item.types.every(t => hiddenTypes.has(t));
            return (
              <button
                key={item.label}
                onClick={() => toggleType(item.types)}
                className={`flex items-center gap-1.5 mb-1 w-full text-left transition-opacity ${isHidden ? 'opacity-30' : 'opacity-100'} hover:opacity-100`}
              >
                <LegendShape shape={item.shape} color={item.color} />
                <span className="text-gray-300">{item.label}</span>
                {!isHidden && (
                  <span className="ml-auto text-gray-600">
                    {allNodes.filter(n => item.types.includes(n.type)).length}
                  </span>
                )}
              </button>
            );
          })}
          {hiddenTypes.size > 0 && (
            <button
              onClick={() => setHiddenTypes(new Set())}
              className="mt-1 text-[9px] text-gray-500 hover:text-gray-300 w-full text-center"
            >
              Show all
            </button>
          )}
        </div>

        {/* Cluster hint */}
        {zoomRef.current < CLUSTER_ZOOM_THRESHOLD && allNodes.length > 20 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1 text-[10px] text-gray-400">
            Zoom in to expand clusters
          </div>
        )}

        {/* Bottom buttons */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2">
          <button
            onClick={handleRecenter}
            className="bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-gray-300 hover:text-white hover:border-white/20 transition-colors"
            title="Recenter graph"
          >
            {'\u2295'} Recenter
          </button>
          <button
            onClick={async () => {
              setLoading(true);
              try {
                await fetch(api('/api/cortex/graph/populate'), { method: 'POST' });
                const [entityData, edgeData] = await Promise.all([
                  fetch(api('/api/cortex/graph/entities')).then(r => r.json()),
                  fetch(api('/api/cortex/graph/edges?all=true')).then(r => r.json()),
                ]);
                setAllNodes((entityData.entities ?? []).map((e: GraphEntity) => ({ ...e })));
                setAllLinks((edgeData.edges ?? []).map((e: GraphEdge) => ({
                  source: e.source_id, target: e.target_id, relation: e.relation, weight: e.weight ?? 1,
                })));
              } catch { /* */ }
              finally { setLoading(false); }
            }}
            className="bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-gray-300 hover:text-white hover:border-white/20 transition-colors"
            title="Re-scan workspaces, projects, branches, and topics"
          >
            {'\u21BB'} Rebuild
          </button>
        </div>
      </div>

      {/* Detail panel */}
      <div className="w-72 border-l border-white/[0.06] bg-black/20 overflow-y-auto">
        <EntityDetail node={selected} onClose={handleClose} />
      </div>
    </div>
  );
}

function LegendShape({ shape, color }: { shape: string; color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      {shape === 'circle' && (
        <circle cx="7" cy="7" r="5" fill={color + '44'} stroke={color} strokeWidth="1.5" />
      )}
      {shape === 'circle-sm' && (
        <circle cx="7" cy="7" r="3.5" fill={color + '44'} stroke={color} strokeWidth="1.5" />
      )}
      {shape === 'rect' && (
        <rect x="1" y="3" width="12" height="8" rx="2" fill={color + '44'} stroke={color} strokeWidth="1.5" />
      )}
      {shape === 'diamond' && (
        <polygon points="7,1 13,7 7,13 1,7" fill={color + '44'} stroke={color} strokeWidth="1.5" />
      )}
    </svg>
  );
}

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
  onNodeClick: (cb: (node: GraphNode) => void) => GraphInstance;
  onBackgroundClick: (cb: () => void) => GraphInstance;
  width: (w: number) => GraphInstance;
  height: (h: number) => GraphInstance;
  zoomToFit: (ms?: number, px?: number) => GraphInstance;
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

function drawNode(
  node: GraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  selected: boolean,
) {
  const color = getNodeColor(node.type);
  const type = node.type;
  const r = Math.max(4, 8 / Math.sqrt(globalScale));
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  ctx.save();

  if (selected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }

  if (type === 'person' || type === 'topic') {
    // Circle
    const radius = type === 'topic' ? r * 0.7 : r;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 / globalScale : 1.5 / globalScale;
    ctx.stroke();
  } else if (type === 'system' || type === 'module') {
    // Diamond
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
    // Rounded rect for team, project, department, organization
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

  // Label
  const fontSize = Math.max(2, 10 / globalScale);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e5e7eb';
  const label =
    node.name.length > 16 ? node.name.slice(0, 15) + '…' : node.name;
  ctx.fillText(label, x, y + r * 1.4);

  ctx.restore();
}

const LEGEND_ITEMS = [
  { label: 'Person', color: '#7c3aed', shape: 'circle' },
  { label: 'Team / Project', color: '#10b981', shape: 'rect' },
  { label: 'System / Module', color: '#f59e0b', shape: 'diamond' },
  { label: 'Topic', color: '#06b6d4', shape: 'circle-sm' },
  { label: 'Dept / Org', color: '#3b82f6', shape: 'rect' },
];

export function EntityGraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const selectedRef = useRef<GraphNode | null>(null);

  // Keep ref in sync so nodeCanvasObject closure can read it
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Fetch graph data
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(api('/api/cortex/graph/entities')).then(r => r.json()),
      fetch(api('/api/cortex/graph/edges?all=true')).then(r => r.json()),
    ])
      .then(([entityData, edgeData]) => {
        const entityNodes: GraphNode[] = (entityData.entities ?? []).map(
          (e: GraphEntity) => ({ ...e }),
        );
        const graphLinks: GraphLink[] = (edgeData.edges ?? []).map(
          (e: GraphEdge) => ({
            source: e.source_id,
            target: e.target_id,
            relation: e.relation,
            weight: e.weight ?? 1,
          }),
        );
        setNodes(entityNodes);
        setLinks(graphLinks);
      })
      .catch(() => {
        setNodes([]);
        setLinks([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Build/update the graph
  useEffect(() => {
    if (loading || !containerRef.current) return;

    // Destroy previous instance
    if (graphRef.current) {
      graphRef.current._destructor?.();
      graphRef.current = null;
    }

    if (nodes.length === 0) return;

    const el = containerRef.current;
    const width = el.clientWidth;
    const height = el.clientHeight;

    // Dynamically import to avoid SSR issues
    import('force-graph').then(({ default: ForceGraph2D }) => {
      if (!containerRef.current) return;

      const graph = (ForceGraph2D as unknown as (el: HTMLElement) => GraphInstance)(
        containerRef.current,
      )
        .graphData({ nodes, links })
        .width(width)
        .height(height)
        .nodeCanvasObject((node, ctx, globalScale) => {
          drawNode(node, ctx, globalScale, selectedRef.current?.id === node.id);
        })
        .nodePointerAreaPaint((node, color, ctx) => {
          const r = 12;
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        })
        .linkColor(() => 'rgba(124, 58, 237, 0.2)')
        .linkWidth((link) => Math.max(0.5, (link.weight ?? 1) * 1.5))
        .onNodeClick((node) => {
          setSelected(node);
        })
        .onBackgroundClick(() => {
          setSelected(null);
        });

      graphRef.current = graph;

      // Fit to view after a short settle time
      setTimeout(() => {
        graph.zoomToFit(400, 40);
      }, 300);
    });

    return () => {
      if (graphRef.current) {
        graphRef.current._destructor?.();
        graphRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, nodes, links]);

  const handleRecenter = useCallback(() => {
    graphRef.current?.zoomToFit(400, 40);
  }, []);

  const handleClose = useCallback(() => setSelected(null), []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Loading graph…
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2">
        <div className="text-4xl opacity-20">◈</div>
        <div className="text-sm">No entities in the knowledge graph yet.</div>
        <div className="text-xs text-gray-600">
          Create entities via the API or let Cortex ingest them automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Graph canvas area */}
      <div className="relative flex-1 min-w-0">
        <div ref={containerRef} className="w-full h-full" />

        {/* Legend — top-right */}
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg p-2.5 text-[10px]">
          <div className="text-gray-400 uppercase tracking-wider mb-1.5 font-medium">Legend</div>
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 mb-1">
              <LegendShape shape={item.shape} color={item.color} />
              <span className="text-gray-300">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Recenter button — bottom-left */}
        <button
          onClick={handleRecenter}
          className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-gray-300 hover:text-white hover:border-white/20 transition-colors"
          title="Recenter graph"
        >
          ⊕ Recenter
        </button>
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

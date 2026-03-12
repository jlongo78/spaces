'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Search, Plus, X, Loader2, AlertCircle } from 'lucide-react';
import { Cluster } from './universe-cluster';
import { matchesSearch } from './universe-utils';
import type { RemoteNode, RemoteError } from './universe-types';
import type { Workspace } from '@/types/claude';

// ─── Props ─────────────────────────────────────────────────

export interface UniverseViewProps {
  workspaces: Workspace[];
  wsLoading: boolean;
  hasNetwork: boolean;
  remoteNodes: RemoteNode[];
  remoteErrors: RemoteError[];
  remoteLoading: boolean;
  filterSource: 'all' | 'local' | 'network';
  onSwitchWorkspace: (wsId: number) => void;
  onCreateWorkspace: () => void;
  onOpenRemote: (nodeId: string, wsId: number) => void;
}

// ─── Camera Rig (fly-to on click) ──────────────────────────

function CameraRig({
  target,
  onArrived,
  reducedMotion,
}: {
  target: THREE.Vector3 | null;
  onArrived: () => void;
  reducedMotion: boolean;
}) {
  const { camera } = useThree();
  const arriving = useRef(false);

  useFrame((_, delta) => {
    if (!target) return;

    if (reducedMotion) {
      camera.position.set(target.x, target.y, target.z + 3);
      camera.lookAt(target);
      onArrived();
      return;
    }

    const dest = new THREE.Vector3(target.x, target.y, target.z + 3);
    camera.position.lerp(dest, delta * 2.5);
    camera.lookAt(
      THREE.MathUtils.lerp(camera.position.x, target.x, delta * 3),
      THREE.MathUtils.lerp(camera.position.y, target.y, delta * 3),
      THREE.MathUtils.lerp(camera.position.z, target.z, delta * 3),
    );

    if (camera.position.distanceTo(dest) < 0.5 && !arriving.current) {
      arriving.current = true;
      setTimeout(onArrived, 200);
    }
  });

  return null;
}

// ─── Main Component ────────────────────────────────────────

export default function UniverseView({
  workspaces,
  wsLoading,
  hasNetwork,
  remoteNodes,
  remoteErrors,
  remoteLoading,
  filterSource,
  onSwitchWorkspace,
  onCreateWorkspace,
  onOpenRemote,
}: UniverseViewProps) {
  const [search, setSearch] = useState('');
  const [hoveredWs, setHoveredWs] = useState<Workspace | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [flyTarget, setFlyTarget] = useState<{
    position: THREE.Vector3;
    ws: Workspace;
    nodeId?: string;
  } | null>(null);
  const [fadeOut, setFadeOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Detect prefers-reduced-motion
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Track mouse for tooltip positioning
  useEffect(() => {
    const handler = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  // Keyboard: / or Ctrl+K to search, Escape to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearch('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Filter workspaces by source
  const filteredLocal = useMemo(
    () => (filterSource === 'network' ? [] : workspaces),
    [workspaces, filterSource],
  );

  const filteredRemoteNodes = useMemo(
    () => (filterSource === 'local' || !hasNetwork ? [] : remoteNodes),
    [remoteNodes, filterSource, hasNetwork],
  );

  // Compute remote cluster positions (circle around origin)
  const remotePositions = useMemo((): Map<string, [number, number, number]> => {
    const map = new Map<string, [number, number, number]>();
    if (filteredRemoteNodes.length === 0) return map;
    if (filteredRemoteNodes.length === 1) {
      map.set(filteredRemoteNodes[0].nodeId, [15, 0, 0]);
      return map;
    }
    filteredRemoteNodes.forEach((node, i) => {
      const angle = (i / filteredRemoteNodes.length) * Math.PI * 2 - Math.PI / 2;
      map.set(node.nodeId, [
        Math.cos(angle) * 15,
        0,
        Math.sin(angle) * 15,
      ]);
    });
    return map;
  }, [filteredRemoteNodes]);

  // Click handler: start fly-to animation
  const handleOrbClick = useCallback(
    (ws: Workspace, nodeId?: string) => {
      if (flyTarget) return;
      let pos: THREE.Vector3;
      if (nodeId) {
        const cp = remotePositions.get(nodeId) || [0, 0, 0];
        pos = new THREE.Vector3(cp[0], cp[1], cp[2]);
      } else {
        pos = new THREE.Vector3(0, 0, 0);
      }
      setFlyTarget({ position: pos, ws, nodeId });
      setTimeout(() => setFadeOut(true), 600);
    },
    [flyTarget, remotePositions],
  );

  // When camera arrives at target
  const handleArrived = useCallback(() => {
    if (!flyTarget) return;
    const { ws, nodeId } = flyTarget;
    if (nodeId) {
      onOpenRemote(nodeId, ws.id);
    } else {
      onSwitchWorkspace(ws.id);
    }
    setFlyTarget(null);
    setFadeOut(false);
  }, [flyTarget, onSwitchWorkspace, onOpenRemote]);

  // Total counts for aria-label
  const localCount = filteredLocal.length;
  const networkCount = filteredRemoteNodes.reduce((s, n) => s + n.workspaces.length, 0);

  return (
    <div className="relative w-full h-full bg-[#07070f]" style={{ minHeight: '100%' }}>
      {/* R3F Canvas */}
      <Canvas
        camera={{ position: [0, 5, 20], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#07070f' }}
        role="img"
        aria-label={`Workspace universe: ${localCount} local space${localCount !== 1 ? 's' : ''}${
          networkCount > 0 ? `, ${networkCount} network space${networkCount !== 1 ? 's' : ''}` : ''
        }`}
      >
        <ambientLight intensity={0.15} />
        <pointLight position={[10, 10, 10]} intensity={0.3} />

        <Stars
          radius={100}
          depth={50}
          count={200}
          factor={2}
          saturation={0}
          fade
          speed={reducedMotion ? 0 : 0.3}
        />

        {/* Local cluster */}
        {!wsLoading && filteredLocal.length > 0 && (
          <Cluster
            workspaces={filteredLocal}
            position={[0, 0, 0]}
            label="Local"
            clusterColor="#6366f1"
            reducedMotion={reducedMotion}
            searchQuery={search}
            onHover={setHoveredWs}
            onClick={(ws) => handleOrbClick(ws)}
          />
        )}

        {/* Remote clusters */}
        {filteredRemoteNodes.map((node) => {
          const pos = remotePositions.get(node.nodeId) || [15, 0, 0];
          return (
            <Cluster
              key={node.nodeId}
              workspaces={node.workspaces}
              position={pos}
              label={node.nodeName}
              clusterColor="#10b981"
              remote
              nodeId={node.nodeId}
              reducedMotion={reducedMotion}
              searchQuery={search}
              onHover={setHoveredWs}
              onClick={(ws) => handleOrbClick(ws, node.nodeId)}
            />
          );
        })}

        <OrbitControls
          enablePan={false}
          minDistance={5}
          maxDistance={60}
          enableDamping
          dampingFactor={0.05}
          enabled={!flyTarget}
        />

        {flyTarget && (
          <CameraRig
            target={flyTarget.position}
            onArrived={handleArrived}
            reducedMotion={reducedMotion}
          />
        )}

        <EffectComposer>
          <Bloom
            luminanceThreshold={0.8}
            luminanceSmoothing={0.9}
            intensity={0.3}
            radius={0.5}
          />
        </EffectComposer>
      </Canvas>

      {/* ─── HTML Overlay ──────────────────────────────────── */}

      {/* Fade-out overlay for fly-in transition */}
      {fadeOut && (
        <div
          className="absolute inset-0 bg-[#07070f] z-30 pointer-events-none"
          style={{ animation: 'universe-fade-in 300ms ease-in forwards' }}
        />
      )}

      {/* Search bar */}
      <div className="absolute top-4 right-4 z-20">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search spaces..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 pl-9 pr-8 py-2 text-xs bg-black/40 backdrop-blur-sm border border-white/[0.08] rounded-lg focus:outline-none focus:border-white/20 text-white placeholder:text-zinc-600"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Control hints */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 text-[10px] text-zinc-600 select-none">
        <span>scroll to zoom</span>
        <span className="text-zinc-800">&middot;</span>
        <span>drag to orbit</span>
        <span className="text-zinc-800">&middot;</span>
        <span>click orb to enter</span>
      </div>

      {/* New Space button */}
      <div className="absolute bottom-4 right-4 z-20">
        <button
          onClick={onCreateWorkspace}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-zinc-500 border border-white/[0.08] rounded-lg bg-black/30 backdrop-blur-sm hover:text-white hover:border-white/[0.15] transition-colors"
        >
          <Plus className="w-3 h-3" />
          New Space
        </button>
      </div>

      {/* Loading indicator */}
      {(wsLoading || remoteLoading) && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          <span className="text-xs text-zinc-500">Discovering spaces...</span>
        </div>
      )}

      {/* Remote errors */}
      {remoteErrors.length > 0 && (
        <div className="absolute bottom-12 left-4 z-20 space-y-1">
          {remoteErrors.map((err) => (
            <div key={err.nodeId} className="flex items-center gap-1.5 text-[9px] text-zinc-600">
              <AlertCircle className="w-2.5 h-2.5 text-red-500/40" />
              <span>{err.nodeName}: {err.error}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredWs && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: mousePos.x + 16, top: mousePos.y - 10 }}
        >
          <div className="bg-black/80 backdrop-blur-sm border border-white/10 rounded-md px-3 py-2 shadow-xl">
            <div className="text-xs font-medium text-white">{hoveredWs.name}</div>
            <div className="text-[10px] text-zinc-400 mt-0.5">
              {hoveredWs.paneCount ?? 0} pane{(hoveredWs.paneCount ?? 0) !== 1 ? 's' : ''}
            </div>
            {hoveredWs.isActive && (
              <div className="text-[10px] text-indigo-400 mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                active
              </div>
            )}
          </div>
        </div>
      )}

      {/* Screen reader accessible list */}
      <div className="sr-only" role="list" aria-label="Workspaces">
        {workspaces.map((ws) => (
          <div key={ws.id} role="listitem">
            {ws.name} — {ws.paneCount ?? 0} panes{ws.isActive ? ' (active)' : ''}
          </div>
        ))}
        {remoteNodes.flatMap((node) =>
          node.workspaces.map((ws) => (
            <div key={`${node.nodeId}-${ws.id}`} role="listitem">
              {ws.name} on {node.nodeName} — {ws.paneCount ?? 0} panes
            </div>
          )),
        )}
      </div>

      {/* Fade keyframe */}
      <style>{`
        @keyframes universe-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import { Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Orb } from './universe-orb';
import { seededRandom, matchesSearch } from './universe-utils';
import type { Workspace } from '@/types/claude';

interface ClusterProps {
  workspaces: Workspace[];
  position: [number, number, number];
  label: string;
  clusterColor: string;
  remote?: boolean;
  nodeId?: string;
  reducedMotion: boolean;
  searchQuery: string;
  onHover: (ws: Workspace | null) => void;
  onClick: (ws: Workspace) => void;
}

// Arrange orbs in a loose sphere around center
function computeOrbPositions(
  workspaces: Workspace[],
  center: [number, number, number],
): [number, number, number][] {
  if (workspaces.length === 0) return [];
  if (workspaces.length === 1) return [center];

  // Sort by pane count descending — largest at center
  const sorted = [...workspaces].sort(
    (a, b) => (b.paneCount ?? 0) - (a.paneCount ?? 0),
  );

  return sorted.map((ws, i) => {
    if (i === 0) return center; // Largest at center

    const ring = Math.ceil(i / 6);
    const posInRing = (i - 1) % 6;
    const ringCount = Math.min(6, workspaces.length - 1 - (ring - 1) * 6);
    const angle = (posInRing / ringCount) * Math.PI * 2;
    const dist = ring * 2.5;

    // Deterministic jitter
    const jx = (seededRandom(ws.id * 3) - 0.5) * 0.6;
    const jy = (seededRandom(ws.id * 7) - 0.5) * 0.6;
    const jz = (seededRandom(ws.id * 11) - 0.5) * 0.6;

    return [
      center[0] + Math.cos(angle) * dist + jx,
      center[1] + jy,
      center[2] + Math.sin(angle) * dist + jz,
    ] as [number, number, number];
  });
}

export function Cluster({
  workspaces,
  position,
  label,
  clusterColor,
  remote,
  nodeId,
  reducedMotion,
  searchQuery,
  onHover,
  onClick,
}: ClusterProps) {
  const orbPositions = useMemo(
    () => computeOrbPositions(workspaces, position),
    [workspaces, position],
  );

  // Sort same way as computeOrbPositions for index alignment
  const sorted = useMemo(
    () =>
      [...workspaces].sort(
        (a, b) => (b.paneCount ?? 0) - (a.paneCount ?? 0),
      ),
    [workspaces],
  );

  if (workspaces.length === 0) return null;

  return (
    <group>
      {/* Connection lines between center orb and satellites */}
      {orbPositions.length > 1 &&
        orbPositions.slice(1).map((pos, i) => (
          <Line
            key={`line-${i}`}
            points={[orbPositions[0], pos]}
            color={clusterColor}
            transparent
            opacity={0.06}
            lineWidth={0.5}
          />
        ))}

      {/* Orbs */}
      {sorted.map((ws, i) => (
        <Orb
          key={ws.id}
          ws={ws}
          position={orbPositions[i]}
          remote={remote}
          nodeId={nodeId}
          reducedMotion={reducedMotion}
          searchMatch={matchesSearch(ws.name, searchQuery)}
          onHover={onHover}
          onClick={onClick}
        />
      ))}

      {/* Cluster label */}
      <Text
        position={[position[0], position[1] - 3, position[2]]}
        fontSize={0.5}
        color={clusterColor}
        anchorX="center"
        anchorY="top"
        fillOpacity={0.3}
        letterSpacing={0.2}
        font={undefined}
      >
        {label.toUpperCase()}
      </Text>
    </group>
  );
}

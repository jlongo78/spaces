'use client';

import { useState, useEffect } from 'react';
import { Text } from '@react-three/drei';
import { useVR } from './vr-app';
import { VRPane } from './vr-pane';
import { VREnvironment } from './vr-environment';
import { computePanePositions } from './vr-layout';
import type { PaneData } from '@/lib/db/queries';

export function VRRoom() {
  const { workspace, returnToLobby } = useVR();
  const [panes, setPanes] = useState<PaneData[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedPane, setFocusedPane] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    fetch(`/api/panes?workspace_id=${workspace.id}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPanes(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    return () => {
      setPanes([]);
    };
  }, [workspace]);

  const positions = computePanePositions(panes.length);
  const wsColor = workspace?.color || '#6366f1';

  return (
    <group>
      <VREnvironment variant="room" accentColor={wsColor} />

      {/* Back button behind the user */}
      <group position={[0, 1.2, -2]} rotation={[0, Math.PI, 0]}>
        <mesh onClick={returnToLobby}>
          <planeGeometry args={[1.2, 0.3]} />
          <meshStandardMaterial color="#1a1a2e" emissive="#6366f1" emissiveIntensity={0.1} />
        </mesh>
        <Text position={[0, 0, 0.01]} fontSize={0.1} color="white" anchorX="center">
          ← Back to Lobby
        </Text>
      </group>

      {/* Loading / empty states */}
      {loading && (
        <Text position={[0, 1.6, 5]} fontSize={0.15} color="#888" anchorX="center">
          Loading panes...
        </Text>
      )}
      {!loading && panes.length === 0 && (
        <Text position={[0, 1.6, 5]} fontSize={0.15} color="#888" anchorX="center">
          No panes in this workspace.
        </Text>
      )}

      {/* Terminal panes */}
      {panes.map((pane, i) => {
        const pos = positions[i];
        if (!pos) return null;
        return (
          <VRPane
            key={pane.id}
            pane={pane}
            position={[pos.x, pos.y, pos.z]}
            workspaceColor={wsColor}
            isFocused={focusedPane === pane.id}
            onFocus={() => setFocusedPane(pane.id)}
          />
        );
      })}
    </group>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Text } from '@react-three/drei';
import { useVR } from './vr-app';
import { VRDoor } from './vr-door';
import { VREnvironment } from './vr-environment';
import type { WorkspaceData } from './vr-app';

export function VRLobby() {
  const { enterWorkspace } = useVR();
  const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setWorkspaces(data);
        } else {
          setError('Unexpected response');
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces]);

  const doorRadius = 4;

  return (
    <group>
      <VREnvironment variant="lobby" />

      {/* Title */}
      <Text position={[0, 3, 0]} fontSize={0.8} color="#9985e0" anchorX="center" anchorY="middle">
        SPACES
      </Text>

      {/* Status text */}
      {loading && (
        <Text position={[0, 1.6, 3]} fontSize={0.15} color="#888" anchorX="center">
          Loading workspaces...
        </Text>
      )}

      {error && (
        <group position={[0, 1.6, 3]}>
          <Text position={[0, 0.15, 0]} fontSize={0.15} color="#f66" anchorX="center">
            {error}
          </Text>
          <mesh position={[0, -0.15, 0]} onClick={fetchWorkspaces}>
            <planeGeometry args={[0.8, 0.2]} />
            <meshStandardMaterial color="#1a1a2e" emissive="#6366f1" emissiveIntensity={0.15} />
          </mesh>
          <Text position={[0, -0.15, 0.01]} fontSize={0.1} color="white" anchorX="center">
            Retry
          </Text>
        </group>
      )}

      {!loading && !error && workspaces.length === 0 && (
        <Text position={[0, 1.6, 3]} fontSize={0.15} color="#888" anchorX="center">
          No workspaces. Create one from the desktop app.
        </Text>
      )}

      {/* Workspace doors in circle */}
      {workspaces.map((ws, i) => {
        const angle = ((Math.PI * 2) / workspaces.length) * i;
        const x = Math.sin(angle) * doorRadius;
        const z = Math.cos(angle) * doorRadius;
        const rotY = Math.atan2(x, z);

        return (
          <VRDoor
            key={ws.id}
            name={ws.name}
            paneCount={ws.paneCount}
            color={ws.color}
            position={[x, 1.2, z]}
            rotation={[0, rotY + Math.PI, 0]}
            onSelect={() => enterWorkspace(ws)}
          />
        );
      })}
    </group>
  );
}

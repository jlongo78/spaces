'use client';

import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { useVRTerminal } from './vr-terminal';
import { useVR } from './vr-app';
import type { PaneData } from '@/lib/db/queries';

interface VRPaneProps {
  pane: PaneData;
  position: [number, number, number];
  workspaceColor: string;
  isFocused: boolean;
  onFocus: () => void;
}

const PANE_WIDTH = 4;
const PANE_HEIGHT = 2.5;

export function VRPane({ pane, position, workspaceColor, isFocused, onFocus }: VRPaneProps) {
  const { terminalToken } = useVR();
  const { texture, textureReady, focus, scroll } = useVRTerminal({
    paneId: pane.id,
    cwd: pane.cwd || '~',
    agentType: pane.agentType || 'shell',
    terminalToken,
    isFocused,
  });

  const paneColor = useMemo(() => new THREE.Color(pane.color || workspaceColor || '#6366f1'), [pane.color, workspaceColor]);
  const darkPaneColor = useMemo(() => paneColor.clone().multiplyScalar(0.3), [paneColor]);

  // Face center (0, eyeHeight, 0)
  const rotation = useMemo(() => {
    const lookTarget = new THREE.Vector3(0, position[1], 0);
    const panePos = new THREE.Vector3(...position);
    const direction = new THREE.Vector3().subVectors(lookTarget, panePos).normalize();
    return new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    );
  }, [position]);

  const handleClick = () => {
    onFocus();
    focus();
  };

  return (
    <group position={position} rotation={rotation}>
      {/* Background quad */}
      <mesh onClick={handleClick}>
        <planeGeometry args={[PANE_WIDTH, PANE_HEIGHT]} />
        <meshStandardMaterial color="#0b0b0f" roughness={0.7} />
      </mesh>

      {/* Terminal content texture */}
      {textureReady && texture.current && (
        <mesh position={[0, -0.15, 0.005]}>
          <planeGeometry args={[PANE_WIDTH - 0.1, PANE_HEIGHT - 0.35]} />
          <meshBasicMaterial map={texture.current} toneMapped={false} />
        </mesh>
      )}

      {/* Title bar */}
      <mesh position={[0, PANE_HEIGHT / 2 - 0.06, 0.005]}>
        <planeGeometry args={[PANE_WIDTH, 0.12]} />
        <meshStandardMaterial color={darkPaneColor} emissive={paneColor} emissiveIntensity={0.08} />
      </mesh>

      {/* Accent line */}
      <mesh position={[0, PANE_HEIGHT / 2 - 0.13, 0.005]}>
        <planeGeometry args={[PANE_WIDTH, 0.015]} />
        <meshStandardMaterial color={paneColor} emissive={paneColor} emissiveIntensity={0.6} toneMapped={false} />
      </mesh>

      {/* Focus highlight border */}
      {isFocused && (
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[PANE_WIDTH + 0.06, PANE_HEIGHT + 0.06]} />
          <meshStandardMaterial color={paneColor} emissive={paneColor} emissiveIntensity={0.3} toneMapped={false} />
        </mesh>
      )}

      {/* Title text */}
      <Text
        position={[-PANE_WIDTH / 2 + 0.15, PANE_HEIGHT / 2 - 0.06, 0.01]}
        fontSize={0.08}
        color="white"
        anchorX="left"
        anchorY="middle"
      >
        {pane.title || pane.agentType} — {pane.agentType}
      </Text>
    </group>
  );
}

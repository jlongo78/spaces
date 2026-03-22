'use client';

import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

interface VRDoorProps {
  name: string;
  paneCount: number;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
  onSelect: () => void;
}

export function VRDoor({ name, paneCount, color, position, rotation, onSelect }: VRDoorProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const [hovered, setHovered] = useState(false);
  const gazeTimer = useRef(0);
  const wsColor = useMemo(() => new THREE.Color(color || '#6366f1'), [color]);
  const darkColor = useMemo(() => wsColor.clone().multiplyScalar(0.3), [wsColor]);

  // Gaze-to-enter: 1.5s hold while hovered
  useFrame((_, delta) => {
    if (hovered) {
      gazeTimer.current += delta;
      if (gazeTimer.current >= 1.5) {
        gazeTimer.current = 0;
        onSelect();
      }
    } else {
      gazeTimer.current = 0;
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* Door frame */}
      <mesh onClick={onSelect} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        <planeGeometry args={[1.2, 2.4]} />
        <meshStandardMaterial color="#1a1a1e" roughness={0.5} emissive={wsColor} emissiveIntensity={hovered ? 0.15 : 0.05} />
      </mesh>

      {/* Portal glow */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[0.95, 2.0]} />
        <meshStandardMaterial color={darkColor} emissive={wsColor} emissiveIntensity={hovered ? 0.25 : 0.1} toneMapped={false} />
      </mesh>

      {/* Accent strips */}
      <AccentStrip position={[0, 1.1, 0.02]} scale={[1.1, 0.015, 1]} color={wsColor} intensity={0.5} />
      <AccentStrip position={[0, -1.1, 0.02]} scale={[1.1, 0.015, 1]} color={wsColor} intensity={0.5} />
      <AccentStrip position={[-0.55, 0, 0.02]} scale={[0.015, 2.2, 1]} color={wsColor} intensity={0.3} />
      <AccentStrip position={[0.55, 0, 0.02]} scale={[0.015, 2.2, 1]} color={wsColor} intensity={0.3} />

      {/* Workspace name */}
      <Text position={[0, 1.5, 0.02]} fontSize={0.18} color="white" anchorX="center" anchorY="middle" maxWidth={2}>
        {name}
      </Text>

      {/* Pane count */}
      <Text position={[0, -1.35, 0.02]} fontSize={0.12} color={color || '#6366f1'} anchorX="center" anchorY="middle">
        {paneCount} pane{paneCount !== 1 ? 's' : ''}
      </Text>
    </group>
  );
}

function AccentStrip({ position, scale, color, intensity }: {
  position: [number, number, number];
  scale: [number, number, number];
  color: THREE.Color;
  intensity: number;
}) {
  return (
    <mesh position={position} scale={scale}>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} toneMapped={false} />
    </mesh>
  );
}

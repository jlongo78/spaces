'use client';

import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Workspace } from '@/types/claude';

interface OrbProps {
  ws: Workspace;
  position: [number, number, number];
  remote?: boolean;
  nodeId?: string;
  reducedMotion: boolean;
  searchMatch: boolean;
  onHover: (ws: Workspace | null) => void;
  onClick: (ws: Workspace) => void;
}

export function Orb({
  ws,
  position,
  remote,
  nodeId,
  reducedMotion,
  searchMatch,
  onHover,
  onClick,
}: OrbProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const dotRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const mountTime = useRef(Date.now());

  // Deterministic phase offset from workspace ID for float animation
  const phase = useMemo(() => (ws.id * 2.39996) % (Math.PI * 2), [ws.id]);

  // Orb radius: 0.3 + (paneCount * 0.15), clamped [0.3, 1.2]
  const radius = useMemo(() => {
    const r = 0.3 + ((ws.paneCount ?? 0) * 0.15);
    return Math.min(Math.max(r, 0.3), 1.2);
  }, [ws.paneCount]);

  // Parse workspace color
  const color = useMemo(() => new THREE.Color(ws.color), [ws.color]);

  // Emissive intensity — brighter for active, dimmer for remote
  const emissiveIntensity = ws.isActive ? 0.4 : remote ? 0.15 : 0.25;

  // Opacity based on search match
  const opacity = searchMatch ? 0.75 : 0.1;

  // Float animation + hover scale + entrance animation
  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Entrance animation: scale from 0 over 600ms
    const age = Date.now() - mountTime.current;
    const entranceScale = reducedMotion ? 1 : Math.min(age / 600, 1);

    // Float bob
    const bobY = reducedMotion
      ? 0
      : Math.sin(Date.now() * 0.001 + phase) * 0.15;
    meshRef.current.position.y = position[1] + bobY;

    // Hover scale (spring-like lerp)
    const targetScale = (hovered ? 1.15 : 1) * entranceScale;
    const currentScale = meshRef.current.scale.x;
    const newScale = reducedMotion
      ? targetScale
      : THREE.MathUtils.lerp(currentScale, targetScale, delta * 8);
    meshRef.current.scale.setScalar(newScale);

    // Active dot floats with the orb
    if (dotRef.current) {
      dotRef.current.position.y = position[1] + bobY + radius + 0.25;
    }
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={position}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          onHover(ws);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          onHover(null);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(ws);
        }}
      >
        <sphereGeometry args={[radius, 32, 32]} />
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          transparent
          opacity={opacity}
          roughness={0.1}
          metalness={0.1}
          clearcoat={1}
          clearcoatRoughness={0.1}
          envMapIntensity={0.5}
        />
      </mesh>

      {/* Active workspace indicator dot */}
      {ws.isActive && (
        <mesh
          ref={dotRef}
          position={[position[0] + radius + 0.2, position[1] + radius + 0.25, position[2]]}
        >
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#818cf8" />
        </mesh>
      )}
    </group>
  );
}

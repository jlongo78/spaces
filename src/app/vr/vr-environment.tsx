'use client';

import { useMemo } from 'react';
import * as THREE from 'three';

interface VREnvironmentProps {
  variant: 'lobby' | 'room';
  accentColor?: string;
}

export function VREnvironment({ variant, accentColor = '#6366f1' }: VREnvironmentProps) {
  const color = useMemo(() => new THREE.Color(accentColor), [accentColor]);

  return (
    <group>
      <ambientLight intensity={0.04} color="#0a0a1a" />
      <pointLight position={[0, 4.5, 0]} intensity={0.6} distance={15} color="#c8b0ff" />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <cylinderGeometry args={[6, 6, 0.1, 32]} />
        <meshStandardMaterial color="#0d0d0f" roughness={0.2} />
      </mesh>

      {/* Center platform */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <cylinderGeometry args={[1, 1, 0.02, 32]} />
        <meshStandardMaterial color="#141418" roughness={0.1} />
      </mesh>

      {/* Ceiling */}
      <mesh position={[0, 5, 0]}>
        <cylinderGeometry args={[6, 6, 0.1, 32]} />
        <meshStandardMaterial color="#050508" roughness={0.9} />
      </mesh>

      {/* Glow rings */}
      <GlowRing radius={1.02} y={0.03} color={color} intensity={0.15} />
      <GlowRing radius={variant === 'lobby' ? 4.1 : 6.1} y={0.02} color={color} intensity={0.08} />

      {/* Fog */}
      <fog attach="fog" args={['#04040a', 5, 30]} />
    </group>
  );
}

function GlowRing({ radius, y, color, intensity }: {
  radius: number; y: number; color: THREE.Color; intensity: number;
}) {
  const tubeGeo = useMemo(() => {
    const segments = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
    }
    const curve = new THREE.CatmullRomCurve3(points, true);
    return new THREE.TubeGeometry(curve, segments, 0.015, 8, true);
  }, [radius, y]);

  return (
    <mesh geometry={tubeGeo}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={intensity}
        toneMapped={false}
      />
    </mesh>
  );
}

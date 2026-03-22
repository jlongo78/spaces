'use client';

import { useState, useRef, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { Text } from '@react-three/drei';
import { VRLobby } from './vr-lobby';
import { VRRoom } from './vr-room';
import { VRControls } from './vr-controls';
import * as THREE from 'three';

export interface WorkspaceData {
  id: number;
  name: string;
  color: string;
  paneCount: number;
}

interface VRContextType {
  scene: 'lobby' | 'room';
  workspace: WorkspaceData | null;
  terminalToken: string;
  enterWorkspace: (ws: WorkspaceData) => void;
  returnToLobby: () => void;
  playerYRef: React.MutableRefObject<number>;
}

export const VRContext = createContext<VRContextType>(null!);
export const useVR = () => useContext(VRContext);

const xrStore = createXRStore();

interface VRAppProps {
  terminalToken: string;
}

export function VRApp({ terminalToken }: VRAppProps) {
  const [scene, setScene] = useState<'lobby' | 'room'>('lobby');
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const playerYRef = useRef(0);

  const enterWorkspace = (ws: WorkspaceData) => {
    setWorkspace(ws);
    setScene('room');
    playerYRef.current = 0;
  };

  const returnToLobby = () => {
    setScene('lobby');
    setWorkspace(null);
    playerYRef.current = 0;
  };

  const ctx: VRContextType = {
    scene, workspace, terminalToken,
    enterWorkspace, returnToLobby, playerYRef,
  };

  return (
    <VRContext.Provider value={ctx}>
      <div style={{ width: '100vw', height: '100vh', background: '#07070f' }}>
        <button
          onClick={() => xrStore.enterVR()}
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            padding: '8px 16px', background: '#6366f1', color: 'white',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
          }}
        >
          Enter VR
        </button>
        <Canvas
          camera={{ position: [0, 1.6, 0], fov: 75 }}
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#07070f' }}
        >
          <XR store={xrStore}>
            <PlayerRig>
              {scene === 'lobby' && <VRLobby />}
              {scene === 'room' && workspace && <VRRoom />}
            </PlayerRig>
            <FlyButtons />
            <VRControls />
          </XR>
        </Canvas>
      </div>
    </VRContext.Provider>
  );
}

/** Moves scene content vertically based on playerYRef (fly up/down) */
function PlayerRig({ children }: { children: React.ReactNode }) {
  const { playerYRef } = useVR();
  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.y = playerYRef.current;
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

/** Floating fly up/down buttons — always visible, follow camera */
function FlyButtons() {
  const { playerYRef } = useVR();
  const groupRef = useRef<THREE.Group>(null!);
  const { camera } = useThree();
  const flySpeed = 0.5;

  // Keep buttons at a fixed position relative to camera
  useFrame(() => {
    if (groupRef.current) {
      // Position to the left of camera view, at hip level
      const offset = new THREE.Vector3(-0.8, -0.5, -1.2);
      offset.applyQuaternion(camera.quaternion);
      groupRef.current.position.copy(camera.position).add(offset);
      groupRef.current.quaternion.copy(camera.quaternion);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Up button */}
      <mesh
        position={[0, 0.12, 0]}
        onPointerDown={() => { playerYRef.current += flySpeed; }}
      >
        <planeGeometry args={[0.15, 0.1]} />
        <meshStandardMaterial color="#1a2a1a" emissive="#22c55e" emissiveIntensity={0.3} toneMapped={false} />
      </mesh>
      <Text position={[0, 0.12, 0.005]} fontSize={0.05} color="white" anchorX="center" anchorY="middle">
        ▲ UP
      </Text>

      {/* Down button */}
      <mesh
        position={[0, -0.02, 0]}
        onPointerDown={() => { playerYRef.current -= flySpeed; }}
      >
        <planeGeometry args={[0.15, 0.1]} />
        <meshStandardMaterial color="#2a1a1a" emissive="#ef4444" emissiveIntensity={0.3} toneMapped={false} />
      </mesh>
      <Text position={[0, -0.02, 0.005]} fontSize={0.05} color="white" anchorX="center" anchorY="middle">
        ▼ DN
      </Text>
    </group>
  );
}

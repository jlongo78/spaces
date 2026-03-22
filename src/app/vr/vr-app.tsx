'use client';

import { useState, useRef, createContext, useContext } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
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

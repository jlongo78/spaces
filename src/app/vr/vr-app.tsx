'use client';

import { useState, createContext, useContext } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { VRLobby } from './vr-lobby';
import { VRRoom } from './vr-room';
import { VRControls } from './vr-controls';

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
}

export const VRContext = createContext<VRContextType>(null!);
export const useVR = () => useContext(VRContext);

const xrStore = createXRStore({
  onSessionEnd: () => {
    console.log('[VR] XR session ended, falling back to desktop mode');
  },
});

interface VRAppProps {
  terminalToken: string;
}

export function VRApp({ terminalToken }: VRAppProps) {
  const [scene, setScene] = useState<'lobby' | 'room'>('lobby');
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);

  const enterWorkspace = (ws: WorkspaceData) => {
    setWorkspace(ws);
    setScene('room');
  };

  const returnToLobby = () => {
    setScene('lobby');
    setWorkspace(null);
  };

  const ctx: VRContextType = {
    scene, workspace, terminalToken,
    enterWorkspace, returnToLobby,
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
            {scene === 'lobby' && <VRLobby />}
            {scene === 'room' && workspace && <VRRoom />}
            <VRControls />
          </XR>
        </Canvas>
      </div>
    </VRContext.Provider>
  );
}

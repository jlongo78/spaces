'use client';

import { useState, useRef, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { Text, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { VRLobby } from './vr-lobby';
import { VRRoom } from './vr-room';
import { VRControls } from './vr-controls';
import { VRGaze } from './vr-gaze';
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
  const [entered, setEntered] = useState(false);
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
      <div style={{ width: '100vw', height: '100vh', background: '#07070f', position: 'relative' }}>

        {/* Landing overlay — shown before entering */}
        {!entered && <LandingOverlay onEnter={() => setEntered(true)} onEnterVR={() => { setEntered(true); xrStore.enterVR(); }} />}

        <Canvas
          camera={{ position: [0, 1.6, 0], fov: 75 }}
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#07070f' }}
        >
          <Stars radius={100} depth={50} count={300} factor={2} saturation={0} speed={0.3} />

          <XR store={xrStore}>
            <PlayerRig>
              {scene === 'lobby' && <VRLobby />}
              {scene === 'room' && workspace && <VRRoom />}
            </PlayerRig>
            <VRControls />
            <VRGaze />
          </XR>

          <EffectComposer>
            <Bloom luminanceThreshold={0.6} luminanceSmoothing={0.9} intensity={0.3} />
          </EffectComposer>
        </Canvas>
      </div>
    </VRContext.Provider>
  );
}

/** Polished landing page overlay */
function LandingOverlay({ onEnter, onEnterVR }: { onEnter: () => void; onEnterVR: () => void }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.06) 0%, transparent 70%)',
      fontFamily: "'Geist Sans', system-ui, sans-serif",
    }}>
      {/* Logo */}
      <img
        src="/spaces_logo.png"
        alt="Spaces"
        style={{ width: 240, marginBottom: 8, opacity: 0.9 }}
      />

      {/* Tagline */}
      <p style={{
        color: '#a1a1aa', fontSize: 16, letterSpacing: '0.15em',
        textTransform: 'uppercase', marginBottom: 48, fontWeight: 300,
      }}>
        Immersive Development
      </p>

      {/* Buttons */}
      <div className="flex gap-3 mb-12">
        <button
          onClick={onEnterVR}
          className="px-6 py-2.5 text-sm font-medium tracking-wide text-white border border-indigo-500/50 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 hover:border-indigo-400/70 transition-all duration-200 shadow-[0_0_20px_rgba(99,102,241,0.15)] hover:shadow-[0_0_30px_rgba(99,102,241,0.25)]"
        >
          Enter VR
        </button>
        <button
          onClick={onEnter}
          className="px-6 py-2.5 text-sm font-medium tracking-wide text-zinc-500 border border-zinc-800 rounded-md hover:text-zinc-300 hover:border-zinc-600 transition-all duration-200"
        >
          Desktop 3D View
        </button>
      </div>

      {/* Controls hint */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 32px',
        color: '#52525b', fontSize: 12, lineHeight: 1.8,
      }}>
        <span><span style={{ color: '#818cf8' }}>L Stick</span> Move</span>
        <span><span style={{ color: '#818cf8' }}>R Stick X</span> Turn</span>
        <span><span style={{ color: '#818cf8' }}>R Stick Y</span> Fly</span>
        <span><span style={{ color: '#818cf8' }}>Gaze 1.5s</span> Select</span>
        <span><span style={{ color: '#818cf8' }}>Trigger</span> Click</span>
        <span><span style={{ color: '#818cf8' }}>⌨ Button</span> Keyboard</span>
      </div>

      {/* Version */}
      <p style={{ position: 'absolute', bottom: 16, color: '#27272a', fontSize: 11 }}>
        Spaces VR — WebXR
      </p>
    </div>
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

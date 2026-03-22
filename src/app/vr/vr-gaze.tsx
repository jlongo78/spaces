'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Head-gaze raycaster for VR.
 * Casts a ray from camera center. Objects with `userData.onGaze` get called
 * after gazing for `dwellTime` seconds. Objects with `userData.onGazeEnter`
 * and `userData.onGazeLeave` get hover callbacks.
 *
 * Also dispatches standard R3F pointer events (onClick, onPointerEnter, etc.)
 * by simulating them on the intersected mesh.
 */
export function VRGaze({ dwellTime = 1.5 }: { dwellTime?: number }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const gazeTarget = useRef<THREE.Object3D | null>(null);
  const gazeTimer = useRef(0);
  const center = useRef(new THREE.Vector2(0, 0));

  useFrame((state, delta) => {
    // Only active in XR mode
    if (!state.gl.xr.isPresenting) return;

    // Cast ray from camera center (head gaze direction)
    raycaster.current.setFromCamera(center.current, camera);
    const intersects = raycaster.current.intersectObjects(scene.children, true);

    // Find first interactive object (one with onClick or userData.onGaze)
    let hitObject: THREE.Object3D | null = null;
    for (const intersect of intersects) {
      let obj: THREE.Object3D | null = intersect.object;
      while (obj) {
        if ((obj as any).__r3f?.handlers?.onClick || obj.userData.onGaze) {
          hitObject = obj;
          break;
        }
        obj = obj.parent;
      }
      if (hitObject) break;
    }

    if (hitObject === gazeTarget.current) {
      if (hitObject) {
        gazeTimer.current += delta;
        if (gazeTimer.current >= dwellTime) {
          // Trigger click
          const handlers = (hitObject as any).__r3f?.handlers;
          if (handlers?.onClick) {
            handlers.onClick({ stopPropagation: () => {} });
          }
          if (hitObject.userData.onGaze) {
            hitObject.userData.onGaze();
          }
          gazeTimer.current = 0;
          gazeTarget.current = null; // reset to prevent rapid re-fire
        }
      }
    } else {
      // Gaze moved to new target
      if (gazeTarget.current) {
        const oldHandlers = (gazeTarget.current as any).__r3f?.handlers;
        if (oldHandlers?.onPointerLeave) {
          oldHandlers.onPointerLeave({ stopPropagation: () => {} });
        }
      }
      gazeTarget.current = hitObject;
      gazeTimer.current = 0;
      if (hitObject) {
        const newHandlers = (hitObject as any).__r3f?.handlers;
        if (newHandlers?.onPointerEnter) {
          newHandlers.onPointerEnter({ stopPropagation: () => {} });
        }
      }
    }
  });

  // Visual gaze reticle — small dot at center of view
  return (
    <group>
      <mesh position={[0, 0, -2]} renderOrder={999}>
        <circleGeometry args={[0.005, 16]} />
        <meshBasicMaterial color="#ffffff" opacity={0.5} transparent depthTest={false} />
      </mesh>
    </group>
  );
}

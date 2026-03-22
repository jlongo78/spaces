'use client';

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { useVR } from './vr-app';

export function VRControls() {
  return (
    <>
      <VRLocomotion />
      <DesktopControls />
    </>
  );
}

function VRLocomotion() {
  const { camera } = useThree();
  const { playerYRef } = useVR();
  const moveSpeed = 3;

  useFrame((state, delta) => {
    const xrManager = state.gl.xr;
    if (!xrManager.isPresenting) return;

    const session = xrManager.getSession();
    const inputSources = session?.inputSources;
    if (!inputSources) return;

    for (const source of inputSources) {
      const gp = source.gamepad;
      if (!gp) continue;

      // Left controller: thumbstick for horizontal movement
      if (source.handedness === 'left' && gp.axes.length >= 4) {
        const moveX = gp.axes[2];
        const moveY = gp.axes[3];

        if (Math.abs(moveX) > 0.1 || Math.abs(moveY) > 0.1) {
          // Normal horizontal movement
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          forward.y = 0;
          forward.normalize();
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          right.y = 0;
          right.normalize();

          const move = new THREE.Vector3()
            .addScaledVector(forward, -moveY * moveSpeed * delta)
            .addScaledVector(right, moveX * moveSpeed * delta);

          const refSpace = xrManager.getReferenceSpace();
          if (refSpace) {
            const offset = new XRRigidTransform({ x: -move.x, y: 0, z: -move.z, w: 1 });
            xrManager.setReferenceSpace(refSpace.getOffsetReferenceSpace(offset));
          }
        }
      }

      // Right controller: smooth turn X, fly up/down Y
      if (source.handedness === 'right' && gp.axes.length >= 4) {
        const turnX = gp.axes[2];
        const flyY = gp.axes[3];
        const turnSpeed = 2; // radians per second

        // Smooth turn — right thumbstick X
        if (Math.abs(turnX) > 0.1) {
          const refSpace = xrManager.getReferenceSpace();
          if (refSpace) {
            const angle = turnX * turnSpeed * delta;
            const rot = new XRRigidTransform(
              { x: 0, y: 0, z: 0, w: 1 },
              DOMPointReadOnly.fromPoint({
                x: 0,
                y: Math.sin(angle / 2),
                z: 0,
                w: Math.cos(angle / 2),
              }),
            );
            xrManager.setReferenceSpace(refSpace.getOffsetReferenceSpace(rot));
          }
        }

        // Fly up/down — right thumbstick Y
        if (Math.abs(flyY) > 0.1) {
          playerYRef.current += flyY * moveSpeed * delta;
        }
      }
    }
  });

  return null;
}

function DesktopControls() {
  const { camera, gl } = useThree();
  const keys = useRef<Set<string>>(new Set());
  const speed = 5;

  useFrame((state, delta) => {
    if (state.gl.xr.isPresenting) return;

    let moveX = 0, moveZ = 0, moveY = 0;
    if (keys.current.has('w') || keys.current.has('arrowup')) moveZ -= 1;
    if (keys.current.has('s') || keys.current.has('arrowdown')) moveZ += 1;
    if (keys.current.has('a') || keys.current.has('arrowleft')) moveX -= 1;
    if (keys.current.has('d') || keys.current.has('arrowright')) moveX += 1;
    if (keys.current.has('e') || keys.current.has(' ')) moveY += 1;
    if (keys.current.has('q') || keys.current.has('shift')) moveY -= 1;

    if (moveY !== 0) camera.position.y += moveY * speed * delta;

    if (moveX !== 0 || moveZ !== 0) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      right.y = 0;
      right.normalize();

      camera.position.addScaledVector(forward, moveZ * -speed * delta);
      camera.position.addScaledVector(right, moveX * speed * delta);
    }
  });

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase());
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  return <PointerLockControls />;
}

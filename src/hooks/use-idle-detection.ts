import { useRef, useState, useCallback } from 'react';

export type IdleState = 'initializing' | 'busy' | 'idle';

const IDLE_TIMEOUT = 1500;   // 1.5s of silence → idle
const GRACE_PERIOD = 3000;   // 3s grace after connection (ignore buffer replay)

interface UseIdleDetectionOptions {
  paneId: string;
  onIdleChange?: (paneId: string, state: IdleState) => void;
}

export function useIdleDetection({ paneId, onIdleChange }: UseIdleDetectionOptions) {
  const [idleState, setIdleState] = useState<IdleState>('initializing');
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inGracePeriodRef = useRef(false);
  const stateRef = useRef<IdleState>('initializing');
  const onIdleChangeRef = useRef(onIdleChange);
  onIdleChangeRef.current = onIdleChange;
  const paneIdRef = useRef(paneId);
  paneIdRef.current = paneId;

  const transition = useCallback((next: IdleState) => {
    if (stateRef.current === next) return;
    stateRef.current = next;
    setIdleState(next);
    onIdleChangeRef.current?.(paneIdRef.current, next);
  }, []);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
  }, []);

  const startIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      transition('idle');
    }, IDLE_TIMEOUT);
  }, [transition]);

  const markConnected = useCallback(() => {
    clearTimers();
    inGracePeriodRef.current = true;
    transition('initializing');
    graceTimerRef.current = setTimeout(() => {
      inGracePeriodRef.current = false;
      // If no data arrived during grace period, start idle timer
      if (stateRef.current === 'initializing') {
        startIdleTimer();
      }
    }, GRACE_PERIOD);
  }, [clearTimers, transition, startIdleTimer]);

  const markDataReceived = useCallback(() => {
    if (inGracePeriodRef.current) {
      // During grace period, just note we're getting data but don't transition
      return;
    }
    transition('busy');
    startIdleTimer();
  }, [transition, startIdleTimer]);

  const markUserInput = useCallback(() => {
    if (inGracePeriodRef.current) return;
    transition('busy');
    // Don't start idle timer on user input — wait for response data
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
  }, [transition]);

  const markDisconnected = useCallback(() => {
    clearTimers();
    inGracePeriodRef.current = false;
    transition('initializing');
  }, [clearTimers, transition]);

  return { idleState, markConnected, markDataReceived, markUserInput, markDisconnected };
}

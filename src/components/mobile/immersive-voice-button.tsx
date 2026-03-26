'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImmersiveVoiceButtonProps {
  onSend: (data: string) => void;
  size?: 'sm' | 'md';
}

/**
 * Immersive voice button using Web Speech API.
 * When active: continuous listen → auto-send each phrase with \r → repeat.
 * Works on desktop and mobile browsers that support SpeechRecognition.
 */
export function ImmersiveVoiceButton({ onSend, size = 'md' }: ImmersiveVoiceButtonProps) {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  const isSupported = typeof window !== 'undefined' &&
    !(/Quest|Oculus|Pacific/i.test(navigator.userAgent)) &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startListening = useCallback(() => {
    if (!activeRef.current) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false; // only final results → auto-send
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      if (!activeRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text) onSend(text + '\r');
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        activeRef.current = false;
        setActive(false);
        return;
      }
      if (activeRef.current) setTimeout(startListening, 500);
    };

    recognition.onend = () => {
      if (activeRef.current && document.visibilityState === 'visible') {
        setTimeout(startListening, 100);
      } else if (activeRef.current) {
        // Tab hidden — wait for visibility change to restart
        setActive(true); // keep button green
      } else {
        setActive(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onSend]);

  // Restart when tab regains focus (mobile browsers kill audio in background)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeRef.current) {
        // Tab came back — restart listening
        if (!recognitionRef.current) {
          startListening();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [startListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
    };
  }, []);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      activeRef.current = false;
      setActive(false);
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }
    } else {
      activeRef.current = true;
      setActive(true);
      startListening();
    }
  }, [startListening]);

  if (!isSupported) return null;

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const padding = size === 'sm' ? 'p-1' : 'p-2.5';

  return (
    <button
      onClick={toggle}
      className={cn(
        `${padding} rounded-full flex-shrink-0 transition-all`,
        active
          ? 'bg-green-600 text-white shadow-[0_0_12px_rgba(34,197,94,0.5)] animate-pulse'
          : 'bg-zinc-800 text-zinc-400 hover:text-green-400 hover:bg-zinc-700'
      )}
      title={active ? 'Exit immersive voice' : 'Immersive voice (auto-send)'}
    >
      <AudioLines className={iconSize} />
    </button>
  );
}

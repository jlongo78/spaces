'use client';

import { useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { cn } from '@/lib/utils';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
}

export function VoiceInput({ onTranscript }: VoiceInputProps) {
  const {
    isListening,
    isSupported,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeechRecognition();

  // Send final transcript to parent
  useEffect(() => {
    if (transcript) {
      onTranscript(transcript);
    }
  }, [transcript, onTranscript]);

  if (!isSupported) return null;

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={isListening ? stopListening : startListening}
        className={cn(
          'p-2.5 rounded-xl transition-colors',
          isListening
            ? 'bg-red-500 text-white animate-pulse'
            : 'bg-zinc-800 text-zinc-400 hover:text-white'
        )}
      >
        {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>

      {/* Interim transcript tooltip */}
      {isListening && interimTranscript && (
        <div className="absolute bottom-full left-0 mb-2 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 whitespace-nowrap max-w-[200px] truncate shadow-xl">
          {interimTranscript}
        </div>
      )}
    </div>
  );
}

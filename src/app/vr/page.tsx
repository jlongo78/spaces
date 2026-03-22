'use client';

import dynamic from 'next/dynamic';
import { TotpGate } from '@/components/auth/totp-gate';

const VRApp = dynamic(() => import('./vr-app').then(m => ({ default: m.VRApp })), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
      Loading VR...
    </div>
  ),
});

export default function VRPage() {
  return (
    <TotpGate>
      {(terminalToken: string) => <VRApp terminalToken={terminalToken} />}
    </TotpGate>
  );
}

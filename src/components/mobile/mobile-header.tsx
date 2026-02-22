'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  backHref?: string;
  right?: React.ReactNode;
  className?: string;
}

export function MobileHeader({ title, showBack, backHref, right, className }: MobileHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (backHref) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <header className={cn(
      'sticky top-0 z-40 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800',
      'flex items-center gap-3 px-4 h-14 flex-shrink-0',
      className
    )}>
      {showBack && (
        <button
          onClick={handleBack}
          className="p-1 -ml-1 text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}
      <h1 className="text-base font-semibold truncate flex-1">{title}</h1>
      {right && <div className="flex items-center gap-2 flex-shrink-0">{right}</div>}
    </header>
  );
}

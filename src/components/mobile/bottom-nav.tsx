'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers, LayoutDashboard, MessageSquare, FolderOpen, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/m/terminal', label: 'Spaces', icon: Layers },
  { href: '/m', label: 'Home', icon: LayoutDashboard, exact: true },
  { href: '/m/sessions', label: 'Sessions', icon: MessageSquare },
  { href: '/m/projects', label: 'Projects', icon: FolderOpen },
  { href: '/m/settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-950 border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16">
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact
            ? pathname === href
            : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-2 min-w-0 flex-1',
                isActive
                  ? 'text-indigo-400'
                  : 'text-zinc-500'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  FolderOpen,
  Layers,
  BarChart3,
  Settings,
  Search,
  Users,
  Activity,
  LogOut,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { trackPageView } from '@/lib/telemetry';
import { api } from '@/lib/api';
import { HAS_AUTH, HAS_ADMIN, HAS_NETWORK } from '@/lib/tier';

const nav = [
  { href: '/terminal', label: 'Spaces', icon: Layers },
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/network', label: 'Network', icon: Globe },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const routeNames: Record<string, string> = {
  '/': 'dashboard',
  '/terminal': 'terminal',
  '/sessions': 'sessions',
  '/projects': 'projects',
  '/analytics': 'analytics',
  '/network': 'network',
  '/settings': 'settings',
  '/admin/users': 'admin_users',
  '/admin/analytics': 'admin_analytics',
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const page = routeNames[pathname]
      || (pathname.startsWith('/sessions/') ? 'session_detail' : pathname.slice(1));
    trackPageView(page);
  }, [pathname]);

  useEffect(() => {
    if (!HAS_AUTH) return;
    fetch(api('/api/auth/me'))
      .then(r => r.json())
      .then(data => setUserRole(data.role))
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch(api('/api/auth/logout'), { method: 'POST' });
    router.push('/login');
  };

  return (
    <aside className="w-56 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/spaces_logo.png`}
            alt="Spaces"
            width={180}
            height={60}
          />
        </Link>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {nav.filter(({ href }) => {
          if (href === '/network') return HAS_NETWORK ;
          return true;
        }).map(({ href, label, icon: Icon }) => {
          const isActive = href === '/'
            ? pathname === '/'
            : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-medium'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}

        {/* Admin-only: Users + Activity links */}
        {HAS_ADMIN  && userRole === 'admin' && (
          <>
            <Link
              href="/admin/users"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                pathname.startsWith('/admin/users')
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-medium'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
              )}
            >
              <Users className="w-4 h-4" />
              Users
            </Link>
            <Link
              href="/admin/analytics"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                pathname.startsWith('/admin/analytics')
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-medium'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
              )}
            >
              <Activity className="w-4 h-4" />
              Activity
            </Link>
          </>
        )}
      </nav>

      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-1">
        <Link
          href="/sessions?search=true"
          className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md"
        >
          <Search className="w-4 h-4" />
          <span>Search</span>
          <kbd className="ml-auto text-[10px] bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
            Ctrl+K
          </kbd>
        </Link>

        {HAS_AUTH  && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md w-full"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </aside>
  );
}

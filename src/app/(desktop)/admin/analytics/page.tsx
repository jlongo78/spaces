'use client';

import { useState, useEffect } from 'react';
import { Activity, Loader2, LogIn, Clock, Users, Zap } from 'lucide-react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';

interface AnalyticsData {
  activeSessions: number;
  totalLogins: number;
  totalSessionMinutes: number;
  recentLogins: { username: string; timestamp: string; ip_address: string; user_agent: string }[];
  dailyLogins: { date: string; count: number }[];
  dailySessionTime: { date: string; minutes: number }[];
  userSummary: { username: string; session_count: number; total_minutes: number; last_login: string }[];
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetch(api(`/api/admin/analytics?days=${days}`))
      .then(r => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Forbidden' : 'Failed to load analytics');
        return r.json();
      })
      .then(d => { setData(d); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading activity data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const uniqueUsers = new Set(data.userSummary.map(u => u.username)).size;

  const loginChartData = data.dailyLogins.map(d => ({
    date: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    logins: d.count,
  }));

  const sessionChartData = data.dailySessionTime.map(d => ({
    date: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    hours: Math.round(d.minutes / 6) / 10,
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6" />
            Team Activity
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Login and terminal session analytics across all users</p>
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                days === d
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Zap className="w-4 h-4 text-green-500" />}
          label="Active Now"
          value={data.activeSessions}
        />
        <StatCard
          icon={<LogIn className="w-4 h-4 text-indigo-500" />}
          label="Total Logins"
          value={data.totalLogins}
        />
        <StatCard
          icon={<Clock className="w-4 h-4 text-violet-500" />}
          label="Total Vibe Time"
          value={formatDuration(data.totalSessionMinutes)}
        />
        <StatCard
          icon={<Users className="w-4 h-4 text-amber-500" />}
          label="Unique Users"
          value={uniqueUsers}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
          <h3 className="font-semibold mb-4">Daily Logins</h3>
          {loginChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground h-[200px] flex items-center justify-center">No login data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={loginChartData}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="logins" fill="#6366f1" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
          <h3 className="font-semibold mb-4">Daily Vibe Time</h3>
          {sessionChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground h-[200px] flex items-center justify-center">No session data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={sessionChartData}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                <Tooltip
                  formatter={(value) => [`${value}h`, 'Time']}
                  contentStyle={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                    fontSize: '12px',
                  }}
                />
                <Area type="monotone" dataKey="hours" fill="#8b5cf6" fillOpacity={0.2} stroke="#8b5cf6" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* User Leaderboard */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="font-semibold">User Leaderboard</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Username</th>
              <th className="text-right px-4 py-3 font-medium text-zinc-500">Sessions</th>
              <th className="text-right px-4 py-3 font-medium text-zinc-500">Total Time</th>
              <th className="text-right px-4 py-3 font-medium text-zinc-500">Last Login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.userSummary.map(user => (
              <tr key={user.username} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                <td className="px-4 py-3 font-mono">{user.username}</td>
                <td className="px-4 py-3 text-right text-zinc-400">{user.session_count}</td>
                <td className="px-4 py-3 text-right text-zinc-400">{formatDuration(Math.round(user.total_minutes))}</td>
                <td className="px-4 py-3 text-right text-zinc-400 text-xs">
                  {user.last_login ? formatTimestamp(user.last_login) : '-'}
                </td>
              </tr>
            ))}
            {data.userSummary.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No session data yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent Logins */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="font-semibold">Recent Logins</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Username</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Time</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.recentLogins.slice(0, 25).map((login, i) => (
              <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                <td className="px-4 py-3 font-mono">{login.username}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{formatTimestamp(login.timestamp)}</td>
                <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{login.ip_address || '-'}</td>
              </tr>
            ))}
            {data.recentLogins.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">No login events yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts.includes('T') ? ts : ts + 'Z');
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

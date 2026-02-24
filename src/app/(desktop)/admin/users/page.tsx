'use client';

import { useState, useEffect } from 'react';
import { Users, Plus, Pencil, Trash2, Loader2, KeyRound, X } from 'lucide-react';
import { api } from '@/lib/api';

interface User {
  id: string;
  username: string;
  displayName: string;
  shellUser: string;
  role: string;
  totpEnabled: boolean;
  created: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add user form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ username: '', password: '', displayName: '', shellUser: '', role: 'user' });
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // Edit user
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', shellUser: '', role: '', password: '' });
  const [editError, setEditError] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch(api('/api/admin/users'));
      if (!res.ok) throw new Error('Failed to load users');
      setUsers(await res.json());
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddLoading(true);
    setAddError('');

    const res = await fetch(api('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    });
    const data = await res.json();
    setAddLoading(false);

    if (!res.ok) {
      setAddError(data.error);
      return;
    }

    setUsers([...users, data]);
    setShowAdd(false);
    setAddForm({ username: '', password: '', displayName: '', shellUser: '', role: 'user' });
  };

  const openEdit = (user: User) => {
    setEditUser(user);
    setEditForm({
      displayName: user.displayName,
      shellUser: user.shellUser,
      role: user.role,
      password: '',
    });
    setEditError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditLoading(true);
    setEditError('');

    const body: Record<string, string> = {
      displayName: editForm.displayName,
      shellUser: editForm.shellUser,
      role: editForm.role,
    };
    if (editForm.password) body.password = editForm.password;

    const res = await fetch(api(`/api/admin/users/${editUser.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setEditLoading(false);

    if (!res.ok) {
      setEditError(data.error);
      return;
    }

    setUsers(users.map(u => u.id === editUser.id ? data : u));
    setEditUser(null);
  };

  const handleResetTotp = async (user: User) => {
    if (!confirm(`Reset 2FA for ${user.username}? They will need to set up TOTP again on next login.`)) return;

    const res = await fetch(api(`/api/admin/users/${user.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totpReset: true }),
    });
    const data = await res.json();
    if (res.ok) {
      setUsers(users.map(u => u.id === user.id ? data : u));
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;

    const res = await fetch(api(`/api/admin/users/${user.id}`), { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      setUsers(users.filter(u => u.id !== user.id));
    } else {
      alert(data.error || 'Failed to delete user');
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading users...
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            User Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage users and their OS shell user mappings
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {/* Add User Form */}
      {showAdd && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 mb-6">
          <h3 className="font-semibold mb-4">New User</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Username</label>
              <input
                type="text"
                value={addForm.username}
                onChange={e => setAddForm({ ...addForm, username: e.target.value })}
                required
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Password</label>
              <input
                type="password"
                value={addForm.password}
                onChange={e => setAddForm({ ...addForm, password: e.target.value })}
                required
                minLength={8}
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Display Name</label>
              <input
                type="text"
                value={addForm.displayName}
                onChange={e => setAddForm({ ...addForm, displayName: e.target.value })}
                placeholder="Optional"
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Shell User (OS user)</label>
              <input
                type="text"
                value={addForm.shellUser}
                onChange={e => setAddForm({ ...addForm, shellUser: e.target.value })}
                required
                placeholder="e.g. devuser"
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Role</label>
              <select
                value={addForm.role}
                onChange={e => setAddForm({ ...addForm, role: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={addLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50"
              >
                {addLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
            {addError && <p className="text-red-400 text-sm col-span-2">{addError}</p>}
          </form>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Edit: {editUser.username}</h3>
            <button onClick={() => setEditUser(null)} className="text-zinc-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleEdit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Display Name</label>
              <input
                type="text"
                value={editForm.displayName}
                onChange={e => setEditForm({ ...editForm, displayName: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Shell User</label>
              <input
                type="text"
                value={editForm.shellUser}
                onChange={e => setEditForm({ ...editForm, shellUser: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Role</label>
              <select
                value={editForm.role}
                onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">New Password (leave empty to keep)</label>
              <input
                type="password"
                value={editForm.password}
                onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="Unchanged"
                minLength={8}
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex items-end gap-2 col-span-2">
              <button
                type="submit"
                disabled={editLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50"
              >
                {editLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
            {editError && <p className="text-red-400 text-sm col-span-2">{editError}</p>}
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Username</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Display Name</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Shell User</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Role</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">2FA</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-500">Created</th>
              <th className="text-right px-4 py-3 font-medium text-zinc-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                <td className="px-4 py-3 font-mono">{user.username}</td>
                <td className="px-4 py-3">{user.displayName}</td>
                <td className="px-4 py-3 font-mono text-zinc-400">{user.shellUser}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    user.role === 'admin'
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${user.totpEnabled ? 'text-green-500' : 'text-zinc-500'}`}>
                    {user.totpEnabled ? 'Enabled' : 'Not set'}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400 text-xs">
                  {user.created ? new Date(user.created + 'Z').toLocaleDateString() : ''}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => openEdit(user)}
                      className="p-1.5 text-zinc-400 hover:text-indigo-400 rounded"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {user.totpEnabled && (
                      <button
                        onClick={() => handleResetTotp(user)}
                        className="p-1.5 text-zinc-400 hover:text-amber-400 rounded"
                        title="Reset 2FA"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(user)}
                      className="p-1.5 text-zinc-400 hover:text-red-400 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No users yet. Run <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-xs">npm run setup-admin</code> to create the first admin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

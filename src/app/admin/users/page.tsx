'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';

interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  claudeLinked: boolean;
  createdAt: string;
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => {
        if (res.status === 403) {
          setError('Forbidden');
          return [];
        }
        if (!res.ok) throw new Error('Failed to fetch users');
        return res.json();
      })
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const currentUserId = (session?.user as any)?.id;

  const toggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole }),
    });
    if (!res.ok) return;
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    );
  };

  const deleteUser = async (userId: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This will also delete their conversations.`)) return;
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return;
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  if (error === 'Forbidden') {
    redirect('/');
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-4xl rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Users</h1>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="pb-3 pr-4 font-medium">Name</th>
                <th className="pb-3 pr-4 font-medium">Email</th>
                <th className="pb-3 pr-4 font-medium">Role</th>
                <th className="pb-3 pr-4 font-medium">Claude</th>
                <th className="pb-3 pr-4 font-medium">Joined</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                return (
                  <tr key={user.id} className="border-b border-gray-100">
                    <td className="py-3 pr-4 text-gray-900">{user.name}</td>
                    <td className="py-3 pr-4 text-gray-500">{user.email}</td>
                    <td className="py-3 pr-4">
                      {isSelf ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                          {user.role}
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleRole(user.id, user.role)}
                          className={
                            user.role === 'admin'
                              ? 'rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-200'
                              : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200'
                          }
                          title={`Click to change to ${user.role === 'admin' ? 'user' : 'admin'}`}
                        >
                          {user.role}
                        </button>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          user.claudeLinked
                            ? 'inline-block h-2 w-2 rounded-full bg-green-500'
                            : 'inline-block h-2 w-2 rounded-full bg-gray-300'
                        }
                      />
                    </td>
                    <td className="py-3 pr-4 text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      {!isSelf && (
                        <button
                          onClick={() => deleteUser(user.id, user.name)}
                          className="text-xs text-gray-400 hover:text-red-500"
                          title="Delete user"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4">
          <a href="/" className="text-sm text-blue-600 hover:text-blue-700">
            &larr; Back to chat
          </a>
        </div>
      </div>
    </div>
  );
}

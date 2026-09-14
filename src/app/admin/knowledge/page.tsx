'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format-date';

interface Item {
  id: string; subject: string; category: string; content: string; tags: string; kind: string;
  hitCount: number; lastRetrievedAt: string | null; correctionCount: number; updatedAt: string;
  sourceCount: number; lastVerifiedAt: string | null; changedPaths: string[];
}
interface Review { id: string; type: string; payload: Record<string, unknown>; createdAt: string; entry: { id: string; subject: string; kind: string; content: string } }
interface Sync { id: string; repositoryName: string | null; gitlabProjectId: number; fromSha: string; toSha: string; changedFileCount: number; reason: string; wouldStaleCount: number; syncedAt: string }
interface Attention { stale: Item[]; unverified: Item[]; reviews: Review[]; syncs: Sync[] }

type Tab = 'stale' | 'unverified' | 'reviews' | 'syncs';
const CATEGORIES = ['terminology', 'product_insight', 'process', 'developer'];

export default function AdminKnowledgePage() {
  const { status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Attention | null>(null);
  const [tab, setTab] = useState<Tab>('stale');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: '', content: '', category: 'process', tags: '' });

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/knowledge');
    if (res.status === 403 || res.status === 401) { router.push('/'); return; }
    if (res.ok) setData(await res.json());
  }, [router]);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated') load();
  }, [status, router, load]);

  async function act(key: string, fn: () => Promise<Response>, okMessage?: (body: Record<string, unknown>) => string) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      setNotice(res.ok ? (okMessage ? okMessage(body) : 'Done') : `Error: ${body.error || res.status}`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const patch = (id: string, body: Record<string, string>) =>
    fetch(`/api/admin/knowledge/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const verify = (id: string, tier: 1 | 2) =>
    fetch(`/api/admin/knowledge/${id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) });
  const review = (id: string, action: 'accept' | 'dismiss') =>
    fetch(`/api/admin/knowledge/reviews/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });

  if (status === 'loading' || !data) {
    return <div className="p-8 dark:text-gray-300">Loading…</div>;
  }

  const counts: Record<Tab, number> = { stale: data.stale.length, unverified: data.unverified.length, reviews: data.reviews.length, syncs: data.syncs.length };

  function renderItems(items: Item[], stale: boolean) {
    if (items.length === 0) return <p className="p-4 text-sm text-gray-500">Nothing here.</p>;
    return (
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b dark:border-gray-700">
            <th className="p-3 dark:text-gray-300">Subject</th>
            <th className="p-3 dark:text-gray-300">{stale ? 'Changed files' : 'Sources'}</th>
            <th className="p-3 dark:text-gray-300">Hits</th>
            <th className="p-3 dark:text-gray-300">Last verified</th>
            <th className="p-3 dark:text-gray-300">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b align-top dark:border-gray-700">
              <td className="p-3 dark:text-white">
                <div className="font-medium">{it.subject || <span className="italic text-gray-400">(no subject)</span>}</div>
                <div className="mt-1 max-w-xl text-xs text-gray-500 dark:text-gray-400">{it.content}</div>
                <div className="mt-1 text-xs text-gray-400">{it.category} · {it.tags}{it.correctionCount > 0 && ` · corrected ${it.correctionCount}×`}</div>
              </td>
              <td className="p-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                {stale ? it.changedPaths.map((p) => <div key={p}>{p}</div>) : `${it.sourceCount} files`}
              </td>
              <td className="p-3 dark:text-gray-300">{it.hitCount}</td>
              <td className="p-3 text-xs dark:text-gray-300">{it.lastVerifiedAt ? formatDateTime(it.lastVerifiedAt) : '—'}</td>
              <td className="p-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  {stale && (
                    <button disabled={busy !== null} onClick={() => act(it.id, () => verify(it.id, 1), (b) => `Quick check: ${b.outcome} — ${b.reason}`)} className="text-blue-500 disabled:opacity-50">
                      {busy === it.id ? 'Working…' : 'Quick check'}
                    </button>
                  )}
                  <button disabled={busy !== null} onClick={() => act(it.id, () => verify(it.id, 2), (b) => `Full verification: ${b.outcome} — ${b.reason}${b.costUsd ? ` ($${Number(b.costUsd).toFixed(2)})` : ''}`)} className="text-blue-500 disabled:opacity-50">
                    Full verification
                  </button>
                  <button disabled={busy !== null} onClick={() => setEditing(it)} className="text-gray-500">Edit</button>
                  <button disabled={busy !== null} onClick={() => act(it.id, () => patch(it.id, { kind: 'pinned' }), () => 'Pinned')} className="text-amber-600">Pin</button>
                  <button disabled={busy !== null} onClick={() => { if (confirm(`Retire "${it.subject}"?`)) act(it.id, () => patch(it.id, { status: 'retired' }), () => 'Retired'); }} className="text-red-500">Retire</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function describeReview(r: Review): string {
    if (r.type === 'pinned_conflict') return `Claude found code contradicting the pinned rule. Proposed: "${String(r.payload.proposedContent ?? '')}" (${String(r.payload.reason ?? '')})`;
    if (r.type === 'supersedes') return `A fresh page "${String(r.payload.newSubject ?? '')}" was created next to this stale page. Accept retires the stale page.`;
    if (r.type === 'proposed_update') return `Quick check suggests: "${String(r.payload.suggestedContent ?? '')}" (${String(r.payload.reason ?? '')})`;
    return r.type;
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-blue-500 hover:text-blue-400">&larr; Back to chat</Link>
          <h1 className="text-2xl font-bold dark:text-white">Knowledge Attention</h1>
        </div>
        <button onClick={() => setCreating(true)} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">New pinned rule</button>
      </div>

      {notice && <div className="mb-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">{notice}</div>}

      <div className="mb-4 flex gap-2">
        {(['stale', 'unverified', 'reviews', 'syncs'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
            {t[0].toUpperCase() + t.slice(1)} ({counts[t]})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-gray-800">
        {tab === 'stale' && renderItems(data.stale, true)}
        {tab === 'unverified' && renderItems(data.unverified, false)}
        {tab === 'reviews' && (
          data.reviews.length === 0 ? <p className="p-4 text-sm text-gray-500">No open reviews.</p> : (
            <ul>
              {data.reviews.map((r) => (
                <li key={r.id} className="border-b p-4 text-sm dark:border-gray-700">
                  <div className="font-medium dark:text-white">{r.entry.subject} <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{r.type}</span></div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Current: {r.entry.content}</div>
                  <div className="mt-1 text-gray-700 dark:text-gray-300">{describeReview(r)}</div>
                  <div className="mt-2 flex gap-3 text-xs">
                    <button disabled={busy !== null} onClick={() => act(r.id, () => review(r.id, 'accept'), () => 'Accepted')} className="text-green-600">Accept</button>
                    <button disabled={busy !== null} onClick={() => act(r.id, () => review(r.id, 'dismiss'), () => 'Dismissed')} className="text-gray-500">Dismiss</button>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
        {tab === 'syncs' && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700">
                <th className="p-3 dark:text-gray-300">When</th>
                <th className="p-3 dark:text-gray-300">Repository</th>
                <th className="p-3 dark:text-gray-300">Commits</th>
                <th className="p-3 dark:text-gray-300">Files changed</th>
                <th className="p-3 dark:text-gray-300">Entries affected</th>
                <th className="p-3 dark:text-gray-300">Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.syncs.map((s) => (
                <tr key={s.id} className="border-b dark:border-gray-700">
                  <td className="p-3 text-xs dark:text-gray-300">{formatDateTime(s.syncedAt)}</td>
                  <td className="p-3 dark:text-white">{s.repositoryName ?? `project ${s.gitlabProjectId}`}</td>
                  <td className="p-3 font-mono text-xs dark:text-gray-300">{s.fromSha.slice(0, 7)} → {s.toSha.slice(0, 7)}</td>
                  <td className="p-3 dark:text-gray-300">{s.changedFileCount}</td>
                  <td className="p-3 dark:text-gray-300">{s.wouldStaleCount}</td>
                  <td className="p-3 text-xs dark:text-gray-300">{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(editing || creating) && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40" onClick={() => { setEditing(null); setCreating(false); }}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold dark:text-white">{creating ? 'New pinned rule' : 'Edit entry'}</h2>
            <EntryForm
              initial={creating ? form : { subject: editing!.subject, content: editing!.content, category: editing!.category, tags: editing!.tags }}
              onCancel={() => { setEditing(null); setCreating(false); }}
              onSubmit={async (values) => {
                if (creating) {
                  await act('create', () => fetch('/api/admin/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }), () => 'Pinned rule created');
                  setForm({ subject: '', content: '', category: 'process', tags: '' });
                  setCreating(false);
                } else if (editing) {
                  await act(editing.id, () => patch(editing.id, values), () => 'Saved');
                  setEditing(null);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EntryForm({ initial, onSubmit, onCancel }: {
  initial: { subject: string; content: string; category: string; tags: string };
  onSubmit: (values: { subject: string; content: string; category: string; tags: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const field = 'w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white';
  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); setSaving(true); try { await onSubmit(values); } finally { setSaving(false); } }}
      className="space-y-3"
    >
      <input className={field} placeholder="Subject" value={values.subject} onChange={(e) => setValues({ ...values, subject: e.target.value })} required />
      <textarea className={field} rows={5} placeholder="Content (plain language)" value={values.content} onChange={(e) => setValues({ ...values, content: e.target.value })} required />
      <select className={field} value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className={field} placeholder="tags, comma, separated" value={values.tags} onChange={(e) => setValues({ ...values, tags: e.target.value })} />
      <div className="flex justify-end gap-3 text-sm">
        <button type="button" onClick={onCancel} className="text-gray-500">Cancel</button>
        <button type="submit" disabled={saving} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

import { useMutation } from '@tanstack/react-query';
import { ClipboardList, SlidersHorizontal } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api, tokens } from '../api/client';
import { cx } from '../lib/format';
import { Button, Card, ErrorNote } from './ui';

/** Renders staff pages only for a signed-in admin, with a sign-in form otherwise. */
export function AdminGate({ children }: { children: (logout: () => void) => ReactNode }) {
  const [authed, setAuthed] = useState(() => !!tokens.get('admin'));
  if (!authed) return <AdminLogin onDone={() => setAuthed(true)} />;
  return (
    <>
      {children(() => {
        tokens.set('admin', null);
        setAuthed(false);
      })}
    </>
  );
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('reviewer');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<{ token: string }>('/auth/admin/login', { method: 'POST', body: { username, password } }),
    onSuccess: (r) => {
      tokens.set('admin', r.token);
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <Card>
        <form onSubmit={submit} className="space-y-4 p-6">
          <div>
            <h1 className="text-lg font-semibold">Support console</h1>
            <p className="text-sm text-slate-500">Sign in to review refund decisions and manage the policy.</p>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">Name</span>
            <input className="mt-1 w-full rounded-lg px-3 py-2 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Password</span>
            <input type="password" className="mt-1 w-full rounded-lg px-3 py-2 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          <ErrorNote error={login.error} />
          <Button type="submit" className="w-full" loading={login.isPending}>
            Sign in
          </Button>
          <p className="text-center text-xs text-slate-400">Demo password: set by ADMIN_PASSWORD (default in README)</p>
        </form>
      </Card>
    </div>
  );
}

/** Switches between the case queue and the Policy Studio. */
export function ConsoleTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
      isActive ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900',
    );
  return (
    <nav className="inline-flex gap-1 rounded-lg bg-slate-100 p-1" aria-label="Console sections">
      <NavLink to="/console" end className={tab}>
        <ClipboardList className="size-4" aria-hidden /> Cases
      </NavLink>
      <NavLink to="/console/policy" className={tab}>
        <SlidersHorizontal className="size-4" aria-hidden /> Policy studio
      </NavLink>
    </nav>
  );
}

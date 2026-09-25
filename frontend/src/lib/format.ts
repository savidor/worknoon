export const money = (cents: number | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100);

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'n/a';

export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function relative(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

export const humanize = (s: string) =>
  s.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase()).replace(/\bai\b/gi, 'AI');

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

/** Decision time in the unit a person would say: "340 ms" or "2.6 sec". */
export const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sec`);


/** Message time: just the time for today, with the date for anything older. */
export const stamp = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time(iso) : `${shortDate(iso)}, ${time(iso)}`;
};

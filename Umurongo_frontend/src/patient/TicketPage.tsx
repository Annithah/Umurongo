// Patient ticket page at /t/:token. No login: the random token in the link is the key.
// Live: the server pushes "something changed" and we refetch. Offline: the last known position
// is kept on the phone and shown with a notice.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PublicTicketView } from '@umurongo/shared';
import { ApiError, api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useLiveRefetch, useLiveState, useRooms } from '../lib/socket';
import { Spinner } from '../components/ui';
import TicketView from './TicketView';

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const cacheKey = (token: string) => `umurongo.ticket.${token}`;

/** Last known ticket, kept on this phone only (number, status, position; never a phone number). */
function readCache(token: string): { data: PublicTicketView; at: number } | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey(token));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(token: string, data: PublicTicketView) {
  try {
    window.localStorage.setItem(cacheKey(token), JSON.stringify({ data, at: Date.now() }));
  } catch {
    // Storage full or blocked: the page still works, just not offline after a reload.
  }
}

function useBrowserOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** true only after `value` has stayed true for `ms` (avoids a flash of "offline" while connecting). */
function useSustained(value: boolean, ms: number) {
  const [sustained, setSustained] = useState(false);
  useEffect(() => {
    if (!value) return setSustained(false);
    const timer = setTimeout(() => setSustained(true), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return sustained;
}

export default function TicketPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { t, lang, setLang } = useI18n();
  const valid = TOKEN.test(token);
  const cached = valid ? readCache(token) : undefined;

  const query = useQuery({
    queryKey: ['ticket', token],
    queryFn: () => api.publicTicket(token),
    enabled: valid,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at ?? 0,
    staleTime: 0,
    retry: (count, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 400)) && count < 3,
    refetchInterval: 30_000,
  });
  const ticket = query.data;

  useEffect(() => {
    if (query.isSuccess && query.fetchStatus === 'idle' && query.dataUpdatedAt > (cached?.at ?? 0)) writeCache(token, query.data);
  }, [query.isSuccess, query.fetchStatus, query.dataUpdatedAt, query.data, token, cached?.at]);

  useRooms([valid && `ticket:${token}`, ticket && `department:${ticket.department.id}`]);
  useLiveRefetch(['ticket:update', 'queue:update', 'staff:status', 'config:changed'], [['ticket', token]]);

  // Use the language chosen at reception, unless the patient already picked one on this phone.
  useEffect(() => {
    if (!ticket) return;
    let chosen = false;
    try {
      chosen = !!window.localStorage.getItem('umurongo.lang');
    } catch {
      chosen = false;
    }
    if (!chosen && ticket.language !== lang) setLang(ticket.language);
    // Only when a ticket first loads, not on every refetch.
  }, [ticket?.token]);

  useEffect(() => {
    if (ticket) document.title = `${ticket.number} · Umurongo`;
  }, [ticket]);

  const browserOnline = useBrowserOnline();
  const socketDown = useSustained(useLiveState() === 'reconnecting', 5000);
  const online = browserOnline && !query.isError && !socketDown;

  if (!valid || (query.error instanceof ApiError && query.error.status === 404 && !ticket)) {
    return (
      <Centered>
        <h1 className="text-2xl font-black text-navy">{t.ticket.notFoundTitle}</h1>
        <p className="text-muted">{t.ticket.notFoundText}</p>
      </Centered>
    );
  }
  if (!ticket && query.isError) {
    return (
      <Centered>
        <p className="text-muted">{t.ticket.loadError}</p>
        <button className="btn-secondary" onClick={() => query.refetch()}>
          {t.ticket.retry}
        </button>
      </Centered>
    );
  }
  if (!ticket) return <Spinner label={t.ticket.loading} />;

  return <TicketView ticket={ticket} online={online} updatedAt={new Date(query.dataUpdatedAt || Date.now())} onOpenNext={(next) => navigate(`/t/${next}`)} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">{children}</main>;
}

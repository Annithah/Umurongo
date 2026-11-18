// Waiting-room TV at /tv/:hospitalId. Designed at 1920x1080 and scaled to fit any screen.
// Bilingual, high contrast, read-only. Shows ticket numbers, rooms and staff names only.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Volume2, VolumeX } from 'lucide-react';
import { en, rw, type CallView } from '@umurongo/shared';
import { api } from '../lib/api';
import { clock } from '../lib/format';
import { chime, unlockAudio } from '../lib/chime';
import { useLiveRefetch, useLiveState, useRooms, useSocketEvent } from '../lib/socket';
import { StaffStatusChip } from '../components/StatusChip';
import { callToAnnounce, fitScale, messageIndex } from './tvLogic';

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function useFitScale() {
  const [scale, setScale] = useState(() => fitScale(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const onResize = () => setScale(fitScale(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

export default function TvPage() {
  const { hospitalId = '' } = useParams();
  const { data, isError } = useQuery({ queryKey: ['tv', hospitalId], queryFn: () => api.tv(hospitalId), refetchInterval: 30_000, retry: true, retryDelay: 5000 });
  useRooms([`tv:${hospitalId}`]);
  useLiveRefetch(['queue:update', 'call:new', 'staff:status', 'config:changed'], [['tv', hospitalId]]);
  const live = useLiveState() === 'live';
  const scale = useFitScale();
  const now = useNow();

  // Sound needs one click on the TV (browser rule). Until then the page shows the button.
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  soundRef.current = sound;
  const [flashKey, setFlashKey] = useState(0);
  const lastAnnounced = useRef<string | null>(null);

  // Reads refs only, so it is safe to call from effects and socket handlers.
  const announce = useRef((call: CallView) => {
    lastAnnounced.current = call.at;
    setFlashKey((k) => k + 1);
    if (soundRef.current) chime(0.5);
  }).current;

  // A live call event: flash and chime at once.
  useSocketEvent<CallView>('call:new', (call) => {
    if (callToAnnounce([call], lastAnnounced.current)) announce(call);
  });
  // After loading or reconnecting: announce a recent call we missed, but not old ones.
  useEffect(() => {
    if (!data) return;
    if (lastAnnounced.current === null) {
      lastAnnounced.current = data.calls[0]?.at ?? new Date(0).toISOString();
      return;
    }
    const missed = callToAnnounce(data.calls, lastAnnounced.current);
    if (missed) announce(missed);
  }, [data, announce]);

  useEffect(() => {
    document.title = `TV · ${data?.hospital.name ?? 'Umurongo'}`;
  }, [data?.hospital.name]);

  const current = data?.calls[0];
  const msg = messageIndex(rw.tv.messages.length, now);

  return (
    <div className="fixed inset-0 overflow-hidden bg-navy-dark">
      <div className="absolute left-1/2 top-1/2 flex h-[1080px] w-[1920px] flex-col bg-bg text-ink" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {/* Top bar */}
        <header className="flex h-[120px] items-center justify-between bg-navy px-12 text-white">
          <div className="flex items-center gap-5">
            <img src="/logo-320.png" alt="" width={72} height={72} className="rounded-2xl bg-white" />
            <div>
              <p className="font-heading text-5xl font-black">{data?.hospital.name ?? 'Umurongo'}</p>
              <p className="text-2xl text-white/80">
                {rw.tagline} · {en.tagline}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <span className={`flex items-center gap-3 rounded-full px-5 py-2 text-2xl font-bold ${live && !isError ? 'bg-white/15' : 'bg-amber-bg text-amber'}`} role="status">
              <span className={`h-4 w-4 rounded-full ${live && !isError ? 'bg-green' : 'bg-amber'}`} aria-hidden />
              {live && !isError ? `${rw.tv.live} · ${en.tv.live}` : `${rw.tv.reconnecting} · ${en.tv.reconnecting}`}
            </span>
            <button
              className="flex min-h-touch items-center gap-3 rounded-2xl border-2 border-white/40 px-5 py-2 text-2xl font-bold"
              onClick={async () => {
                if (sound) return setSound(false);
                const ok = await unlockAudio();
                setSound(ok);
                if (ok) chime(0.5);
              }}
            >
              {sound ? <Volume2 size={32} aria-hidden /> : <VolumeX size={32} aria-hidden />}
              {sound ? `${rw.tv.soundOn} · ${en.tv.soundOn}` : `${rw.tv.turnOnSound} · ${en.tv.turnOnSound}`}
            </button>
            <p className="font-heading text-6xl font-black tabular-nums">{clock(new Date(now))}</p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 gap-8 p-10">
          {/* Now calling */}
          <section key={flashKey} className={`flex w-[1040px] flex-col justify-between rounded-[28px] border-4 border-green bg-white p-12 ${flashKey ? 'animate-callflash' : ''}`} aria-live="assertive">
            <p className="font-heading text-5xl font-black text-navy">
              {rw.tv.nowCalling} <span className="text-muted">· {en.tv.nowCalling}</span>
            </p>
            {current ? (
              <>
                <p className="ticket-number text-center text-[220px] leading-none" data-testid="now-calling">
                  {current.ticketNumber}
                </p>
                <div className="flex items-end justify-between gap-6">
                  <div>
                    <p className="text-3xl font-bold text-muted">
                      {rw.tv.room} · {en.tv.room}
                    </p>
                    <p className="font-heading text-7xl font-black text-ink">{current.room}</p>
                  </div>
                  <p className="text-right text-4xl font-bold text-navy">{current.staffName}</p>
                </div>
              </>
            ) : (
              <p className="py-24 text-center text-5xl font-bold text-muted">
                {rw.tv.noCalls}
                <br />
                <span className="text-4xl">{en.tv.noCalls}</span>
              </p>
            )}
          </section>

          {/* Last calls */}
          <section className="flex flex-1 flex-col rounded-[28px] bg-white p-8">
            <p className="font-heading text-4xl font-black text-navy">
              {rw.tv.lastCalls} <span className="text-muted">· {en.tv.lastCalls}</span>
            </p>
            <ul className="mt-6 flex flex-col gap-4">
              {(data?.calls.slice(1, 6) ?? []).map((c) => (
                <li key={`${c.ticketNumber}-${c.at}`} className="flex items-center justify-between rounded-2xl bg-sky px-6 py-4">
                  <span className="ticket-number text-6xl">{c.ticketNumber}</span>
                  <span className="text-right">
                    <span className="block text-3xl font-black text-ink">{c.room}</span>
                    <span className="text-2xl text-muted">{clock(c.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Next per department */}
        <section className="grid grid-cols-4 gap-6 px-10">
          {(data?.departments ?? []).slice(0, 4).map((d) => (
            <div key={d.code} className="rounded-3xl bg-white p-6">
              <p className="truncate font-heading text-3xl font-black text-navy">{d.nameRw}</p>
              <p className="truncate text-2xl text-muted">{d.nameEn}</p>
              <p className="mt-3 text-2xl font-bold text-muted">
                {rw.tv.next} · {en.tv.next}
              </p>
              <div className="mt-2 flex min-h-[64px] flex-wrap gap-3">
                {d.next.length ? (
                  d.next.map((n) => (
                    <span key={n} className="ticket-number rounded-xl bg-mint px-3 py-1 text-4xl">
                      {n}
                    </span>
                  ))
                ) : (
                  <span className="text-2xl text-muted">
                    {rw.tv.nobodyWaiting} · {en.tv.nobodyWaiting}
                  </span>
                )}
              </div>
              <p className="mt-3 text-xl font-semibold text-muted">
                {rw.tv.waiting(d.waitingCount)} · {en.tv.waiting(d.waitingCount)}
              </p>
            </div>
          ))}
        </section>

        {/* Staff strip and rotating message */}
        <footer className="mt-6 flex h-[150px] flex-col justify-center gap-3 bg-navy px-10 text-white">
          <div className="flex items-center gap-4 overflow-hidden">
            <span className="shrink-0 text-2xl font-bold text-white/80">
              {rw.tv.staffTitle} · {en.tv.staffTitle}
            </span>
            {(data?.staff ?? []).slice(0, 8).map((s) => (
              <span key={s.id} className="flex shrink-0 items-center gap-2 rounded-2xl bg-white/10 px-3 py-1.5">
                <span className="text-xl font-bold">{s.fullName}</span>
                <StaffStatusChip status={s.status} label={`${rw.staffStatus[s.status]} · ${en.staffStatus[s.status]}`} />
              </span>
            ))}
          </div>
          <p key={msg} className="animate-fadein truncate text-3xl font-bold">
            {rw.tv.messages[msg]} <span className="font-semibold text-white/70">· {en.tv.messages[msg]}</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

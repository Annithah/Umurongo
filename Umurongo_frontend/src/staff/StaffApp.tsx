// Staff app: sign-in, then a shell with a navy sidebar and a top bar. Menu and home page depend on the role.
import { Suspense, lazy, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  ClipboardPlus,
  DoorOpen,
  History,
  ListOrdered,
  LogOut,
  Menu,
  MessageSquareText,
  MonitorPlay,
  Settings,
  Stethoscope,
  Timer,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { StaffMe, StaffRole } from '@umurongo/shared';
import { session } from '../lib/api';
import { longDate } from '../lib/format';
import { useLiveRefetch, useRooms } from '../lib/socket';
import { ErrorState, LiveBadge, Spinner } from '../components/ui';
import { StaffStatusChip } from '../components/StatusChip';
import { ROLE_LABEL, initials, useMe, useSession } from './common';
import Login from './Login';
import Invite from './Invite';

const Reception = lazy(() => import('./Reception'));
const QueueBoard = lazy(() => import('./QueueBoard'));
const TeamBoard = lazy(() => import('./TeamBoard'));
const MyQueue = lazy(() => import('./MyQueue'));
const Analytics = lazy(() => import('./Analytics'));
const SmsPanel = lazy(() => import('./SmsPanel'));
const Departments = lazy(() => import('./admin/Departments'));
const Rooms = lazy(() => import('./admin/Rooms'));
const StaffAccounts = lazy(() => import('./admin/StaffAccounts'));
const SmsTemplates = lazy(() => import('./admin/SmsTemplates'));
const SettingsPage = lazy(() => import('./admin/Settings'));
const Jobs = lazy(() => import('./admin/Jobs'));
const Audit = lazy(() => import('./admin/Audit'));

type Item = { to: string; label: string; icon: LucideIcon; roles: StaffRole[]; group?: 'admin' };
const R: StaffRole[] = ['RECEPTIONIST', 'HOSPITAL_ADMIN'];
const S: StaffRole[] = ['CLINICIAN', 'COUNTER'];
const ALL: StaffRole[] = ['RECEPTIONIST', 'CLINICIAN', 'COUNTER', 'HOSPITAL_ADMIN'];
const A: StaffRole[] = ['HOSPITAL_ADMIN'];

const MENU: Item[] = [
  { to: 'reception', label: 'Reception desk', icon: ClipboardPlus, roles: R },
  { to: 'my-queue', label: 'My queue', icon: Stethoscope, roles: S },
  { to: 'queue', label: 'Queue board', icon: ListOrdered, roles: ALL },
  { to: 'team', label: 'Doctors and staff', icon: UsersRound, roles: ALL },
  { to: 'analytics', label: 'Analytics', icon: BarChart3, roles: A },
  { to: 'sms', label: 'SMS messages', icon: MessageSquareText, roles: R },
  { to: 'admin/departments', label: 'Departments', icon: Building2, roles: A, group: 'admin' },
  { to: 'admin/rooms', label: 'Rooms', icon: DoorOpen, roles: A, group: 'admin' },
  { to: 'admin/staff', label: 'Staff accounts', icon: Users, roles: A, group: 'admin' },
  { to: 'admin/sms-templates', label: 'SMS templates', icon: MessageSquareText, roles: A, group: 'admin' },
  { to: 'admin/settings', label: 'Queue settings', icon: Settings, roles: A, group: 'admin' },
  { to: 'admin/jobs', label: 'Background jobs', icon: Timer, roles: A, group: 'admin' },
  { to: 'admin/audit', label: 'Audit log', icon: History, roles: A, group: 'admin' },
];

const HOME: Record<StaffRole, string> = { RECEPTIONIST: 'reception', CLINICIAN: 'my-queue', COUNTER: 'my-queue', HOSPITAL_ADMIN: 'analytics' };

export default function StaffApp() {
  const token = useSession();
  const location = useLocation();
  if (location.pathname.startsWith('/staff/invite/')) {
    return (
      <Routes>
        <Route path="invite/:token" element={<Invite />} />
      </Routes>
    );
  }
  if (!token) return <Login />;
  return <SignedIn />;
}

function SignedIn() {
  const { data: me, isLoading, error, refetch } = useMe();
  if (isLoading) return <Spinner label="Loading..." />;
  if (error || !me)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState text="Could not load your account." onRetry={() => refetch()} />
      </div>
    );
  return <Shell me={me} />;
}

function Shell({ me }: { me: StaffMe }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  useRooms([`hospital:${me.hospital.id}`]);
  useLiveRefetch(['staff:status', 'config:changed'], [['me']]);

  const menu = MENU.filter((m) => m.roles.includes(me.role));
  const current = menu.find((m) => location.pathname.startsWith(`/staff/${m.to}`));

  function signOut() {
    session.set(null);
    queryClient.clear();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4" aria-label="Staff">
      {menu
        .filter((m) => !m.group)
        .map((m) => (
          <NavItem key={m.to} item={m} onClick={() => setNavOpen(false)} />
        ))}
      {menu.some((m) => m.group === 'admin') && <p className="mt-5 px-3 text-xs font-bold uppercase tracking-wider text-white/50">Administration</p>}
      {menu
        .filter((m) => m.group === 'admin')
        .map((m) => (
          <NavItem key={m.to} item={m} onClick={() => setNavOpen(false)} />
        ))}
      <a href={`/tv/${me.hospital.id}`} target="_blank" rel="noreferrer" className="mt-4 flex min-h-touch items-center gap-3 rounded-xl px-3 text-white/80 hover:bg-white/10">
        <MonitorPlay size={20} aria-hidden /> Open waiting-room TV
      </a>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-navy-dark text-white lg:flex">
        <Brand />
        {nav}
      </aside>

      {/* Sidebar (small screens) */}
      {navOpen && (
        <div className="no-print fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex w-72 flex-col bg-navy-dark text-white">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button className="rounded-lg p-2 hover:bg-white/10" onClick={() => setNavOpen(false)} aria-label="Close menu">
                <X size={22} />
              </button>
            </div>
            {nav}
          </div>
          <button className="flex-1 bg-ink/40" aria-label="Close menu" onClick={() => setNavOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-lg p-2 text-navy hover:bg-sky lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Menu size={22} />
            </button>
            <div className="min-w-0">
              <p className="truncate font-heading text-lg font-black text-navy">{me.hospital.name}</p>
              <p className="hidden truncate text-sm text-muted sm:block">
                {current?.label ?? 'Umurongo'} · {longDate()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LiveBadge />
            <div className="hidden items-center gap-3 border-l border-line pl-3 md:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky font-bold text-navy" aria-hidden>
                {initials(me.fullName)}
              </span>
              <div className="leading-tight">
                <p className="font-bold">{me.fullName}</p>
                <p className="flex items-center gap-2 text-xs text-muted">
                  {ROLE_LABEL[me.role]}
                  {me.roomName ? ` · ${me.roomName}` : ''}
                  {(me.role === 'CLINICIAN' || me.role === 'COUNTER') && <StaffStatusChip status={me.status} />}
                </p>
              </div>
            </div>
            <button className="btn-secondary btn-sm" onClick={signOut}>
              <LogOut size={16} aria-hidden /> Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 lg:p-8">
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route index element={<Navigate to={HOME[me.role]} replace />} />
              {menu.some((m) => m.to === 'reception') && <Route path="reception" element={<Reception me={me} />} />}
              {menu.some((m) => m.to === 'my-queue') && <Route path="my-queue" element={<MyQueue />} />}
              <Route path="queue" element={<QueueBoard me={me} />} />
              <Route path="team" element={<TeamBoard me={me} />} />
              {menu.some((m) => m.to === 'sms') && <Route path="sms" element={<SmsPanel me={me} />} />}
              {me.role === 'HOSPITAL_ADMIN' && (
                <>
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="admin/departments" element={<Departments />} />
                  <Route path="admin/rooms" element={<Rooms />} />
                  <Route path="admin/staff" element={<StaffAccounts me={me} />} />
                  <Route path="admin/sms-templates" element={<SmsTemplates />} />
                  <Route path="admin/settings" element={<SettingsPage />} />
                  <Route path="admin/jobs" element={<Jobs />} />
                  <Route path="admin/audit" element={<Audit />} />
                </>
              )}
              <Route path="*" element={<Navigate to={HOME[me.role]} replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <img src="/favicon-64.png" alt="" width={40} height={40} className="rounded-lg bg-white" />
      <div>
        <p className="font-heading text-xl font-black leading-none">Umurongo</p>
        <p className="text-xs text-white/70">Patient flow</p>
      </div>
    </div>
  );
}

function NavItem({ item, onClick }: { item: Item; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      className={({ isActive }) => `flex min-h-touch items-center gap-3 rounded-xl px-3 font-semibold transition ${isActive ? 'bg-white text-navy' : 'text-white/85 hover:bg-white/10'}`}
    >
      <Icon size={20} aria-hidden /> {item.label}
    </NavLink>
  );
}

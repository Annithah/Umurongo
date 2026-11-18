import { Suspense, lazy } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { MonitorPlay, LogIn } from 'lucide-react';
import { en, rw } from '@umurongo/shared';
import { Spinner } from './components/ui';

// Each audience gets its own bundle: a patient on a slow phone never downloads staff code.
const TicketPage = lazy(() => import('./patient/TicketPage'));
const TvPage = lazy(() => import('./tv/TvPage'));
const TvRedirect = lazy(() => import('./tv/TvRedirect'));
const StaffApp = lazy(() => import('./staff/StaffApp'));

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/t/:token" element={<TicketPage />} />
        <Route path="/tv" element={<TvRedirect />} />
        <Route path="/tv/:hospitalId" element={<TvPage />} />
        <Route path="/staff/*" element={<StaffApp />} />
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div className="flex items-center gap-3">
        <img src="/logo-320.png" alt="" width={56} height={56} className="rounded-xl" />
        <h1 className="text-3xl font-black text-navy">Umurongo</h1>
      </div>
      <div>
        <p className="font-heading text-2xl font-black text-ink">{rw.tagline}</p>
        <p className="mt-1 text-lg text-muted">{en.tagline}</p>
      </div>
      <div className="card bg-sky p-4">
        <p className="font-semibold">{rw.common.haveTicket}</p>
        <p className="text-muted">{en.common.haveTicket}</p>
      </div>
      <div className="grid gap-3">
        <Link to="/staff" className="btn-navy">
          <LogIn size={20} /> Staff sign in
        </Link>
        <Link to="/tv" className="btn-secondary">
          <MonitorPlay size={20} /> Waiting-room TV
        </Link>
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-black text-navy">
        {rw.common.notFound} · {en.common.notFound}
      </h1>
      <Link to="/" className="btn-secondary">
        {rw.common.home} · {en.common.home}
      </Link>
    </main>
  );
}

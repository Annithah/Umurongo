import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogIn } from 'lucide-react';
import { en } from '@umurongo/shared';
import { api, errorMessage, session } from '../lib/api';
import { Field } from '../components/ui';

const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';
const DEMO_ACCOUNTS = [
  { email: 'reception@masaka.demo', label: 'Reception', name: 'Josiane Mutoni' },
  { email: 'claudine@masaka.demo', label: 'Doctor, OPD Room 3', name: 'Dr. Claudine Uwase' },
  { email: 'eric@masaka.demo', label: 'Doctor, OPD Room 5', name: 'Dr. Eric Habimana' },
  { email: 'diane@masaka.demo', label: 'Laboratory', name: 'Diane Uwera' },
  { email: 'cashier@masaka.demo', label: 'Cashier', name: 'Aimable Habineza' },
  { email: 'samuel@masaka.demo', label: 'Pharmacy', name: 'Samuel Nkurunziza' },
  { email: 'admin@masaka.demo', label: 'Hospital admin', name: 'Dr. Jeanne Mukamazimpaka' },
];

export default function Login() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e?: FormEvent, account?: { email: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(account?.email ?? email, account?.password ?? password);
      queryClient.clear();
      queryClient.setQueryData(['me'], res.staff);
      session.set(res.token);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-navy-dark p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <img src="/logo-320.png" alt="" width={48} height={48} className="rounded-xl bg-white" />
          <span className="font-heading text-3xl font-black">Umurongo</span>
        </div>
        <div>
          <p className="font-heading text-4xl font-black leading-tight">{en.tagline}</p>
          <p className="mt-4 max-w-md text-lg text-white/80">Patient flow for the outpatient department: register, call, refer and follow every patient in real time.</p>
        </div>
        <p className="text-sm text-white/60">No medical data is stored in Umurongo.</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/favicon-64.png" alt="" width={40} height={40} className="rounded-lg" />
            <span className="font-heading text-2xl font-black text-navy">Umurongo</span>
          </div>
          <h1 className="text-2xl font-black text-navy">Staff sign in</h1>
          <p className="mb-6 text-muted">Use the email and password from your hospital admin.</p>
          <form className="space-y-4" onSubmit={signIn} noValidate>
            <Field label="Email" id="email">
              <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password" id="password" error={error}>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'password-error' : undefined}
                required
              />
            </Field>
            <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>
              {busy ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />} Sign in
            </button>
          </form>

          {DEMO && (
            <div className="mt-8">
              <p className="label">Demo accounts (password demo1234)</p>
              <div className="grid gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button key={a.email} className="btn-secondary btn-sm justify-between" disabled={busy} onClick={() => signIn(undefined, { email: a.email, password: 'demo1234' })}>
                    <span>{a.name}</span>
                    <span className="font-semibold text-muted">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

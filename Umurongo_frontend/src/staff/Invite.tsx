import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import { api, errorMessage, session } from '../lib/api';
import { ErrorState, Field, Spinner } from '../components/ui';

/** /staff/invite/:token: a new staff member (or a password reset) sets a password. */
export default function Invite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.invite(token), retry: false });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = repeat.length > 0 && repeat !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10 || password !== repeat) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.acceptInvite(token, password);
      queryClient.clear();
      queryClient.setQueryData(['me'], res.staff);
      session.set(res.token);
      navigate('/staff', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      {invite.isLoading && <Spinner />}
      {invite.isError && <ErrorState text={errorMessage(invite.error)} />}
      {invite.data && (
        <>
          <h1 className="text-2xl font-black text-navy">Welcome, {invite.data.fullName}</h1>
          <p className="mb-6 text-muted">
            Choose a password for {invite.data.email} at {invite.data.hospitalName}.
          </p>
          <form className="space-y-4" onSubmit={submit} noValidate>
            <Field label="New password" id="pw" error={tooShort ? 'Use at least 10 characters' : null} help="At least 10 characters. A short sentence is easy to remember.">
              <input id="pw" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={tooShort} />
            </Field>
            <Field label="Repeat password" id="pw2" error={mismatch ? 'The passwords are not the same' : error}>
              <input id="pw2" type="password" autoComplete="new-password" className="input" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-invalid={mismatch} />
            </Field>
            <button className="btn-primary w-full" disabled={busy || password.length < 10 || password !== repeat}>
              {busy ? <Loader2 size={20} className="animate-spin" /> : <KeyRound size={20} />} Set password and sign in
            </button>
          </form>
        </>
      )}
    </main>
  );
}

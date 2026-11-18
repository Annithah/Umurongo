// Shared staff hooks and small pieces.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { StaffMe, StaffRole } from '@umurongo/shared';
import { api, errorMessage, session } from '../lib/api';
import { useToast } from '../components/ui';

export function useSession(): string | null {
  return useSyncExternalStore(session.subscribe, session.get, () => null);
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 30_000 });
}

/** Ticks every `ms` so timers ("waiting 12 min", "called 3:05 ago") stay current. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * A mutation that shows an error toast on failure, an optional success toast, and refreshes
 * the given queries afterwards (sockets refresh other screens).
 */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string) } = {},
) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // A refetch still in flight could land after this action and overwrite its result with older
    // data, so cancel those first. The invalidation after the action fetches fresh data.
    onMutate: async () => {
      await Promise.all((opts.invalidate ?? []).map((k) => queryClient.cancelQueries({ queryKey: k })));
    },
    onSuccess: (r) => {
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r) : opts.success, 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
    onSettled: () => opts.invalidate?.forEach((k) => queryClient.invalidateQueries({ queryKey: k })),
  });
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  RECEPTIONIST: 'Reception',
  CLINICIAN: 'Clinician',
  COUNTER: 'Counter (lab, cashier, pharmacy)',
  HOSPITAL_ADMIN: 'Hospital admin',
};

export const isServing = (me: Pick<StaffMe, 'role'>) => me.role === 'CLINICIAN' || me.role === 'COUNTER';
export const isReception = (me: Pick<StaffMe, 'role'>) => me.role === 'RECEPTIONIST' || me.role === 'HOSPITAL_ADMIN';
export const isAdmin = (me: Pick<StaffMe, 'role'>) => me.role === 'HOSPITAL_ADMIN';

export function initials(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Page title row used by every staff screen. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-black text-navy">{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

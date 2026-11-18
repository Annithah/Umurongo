// Doctors and staff: everyone who serves a queue, with their status. Reception can change any status.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { STAFF_STATUSES, type StaffMe, type StaffPublic, type StaffStatus } from '@umurongo/shared';
import { api } from '../lib/api';
import { clock } from '../lib/format';
import { useLiveRefetch } from '../lib/socket';
import { EmptyState, ErrorState, Spinner } from '../components/ui';
import { STAFF_STATUS_LABEL, StaffStatusChip } from '../components/StatusChip';
import { PageHeader, isReception, useAction } from './common';

export default function TeamBoard({ me }: { me: StaffMe }) {
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
  useLiveRefetch(['staff:status', 'ticket:update', 'config:changed'], [['staff']]);
  const canEdit = isReception(me);

  const groups = useMemo(() => {
    const serving = (staff.data ?? []).filter((s) => s.role === 'CLINICIAN' || s.role === 'COUNTER');
    const map = new Map<string, StaffPublic[]>();
    for (const s of serving) map.set(s.departmentNameEn ?? 'No department', [...(map.get(s.departmentNameEn ?? 'No department') ?? []), s]);
    return [...map.entries()];
  }, [staff.data]);

  return (
    <>
      <PageHeader
        title="Doctors and staff"
        subtitle={canEdit ? 'Change a status when a doctor tells you. Patients see the new estimate at once.' : 'Who is available right now.'}
      />
      {staff.isLoading ? (
        <Spinner />
      ) : staff.isError ? (
        <ErrorState text="Could not load staff." onRetry={() => staff.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState text="No clinicians or counter staff yet. An admin can add them under Staff accounts." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {groups.map(([dept, people]) => (
            <section key={dept} className="card overflow-hidden">
              <h2 className="flex items-center justify-between border-b border-line bg-sky px-4 py-3 font-black text-navy">
                {dept}
                <span className="text-sm font-bold text-muted">
                  {people.filter((p) => p.status === 'AVAILABLE' || p.status === 'IN_CONSULTATION').length} of {people.length} serving
                </span>
              </h2>
              <ul className="divide-y divide-line">
                {people.map((s) => (
                  <Person key={s.id} s={s} canEdit={canEdit} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Person({ s, canEdit }: { s: StaffPublic; canEdit: boolean }) {
  const setStatus = useAction((status: StaffStatus) => api.setStatus(s.id, status), {
    invalidate: [['staff'], ['departments']],
    success: (r) => `${r.fullName}: ${STAFF_STATUS_LABEL[r.status]}`,
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-bold">{s.fullName}</p>
        <p className="text-sm text-muted">
          {s.title}
          {s.roomName ? ` · ${s.roomName}` : ''}
          {s.currentTicketNumber ? ` · serving ${s.currentTicketNumber}` : ''}
          {s.backAt && s.status !== 'AVAILABLE' ? ` · back about ${clock(s.backAt)}` : ''}
        </p>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <StaffStatusChip status={s.status} />
          <label className="sr-only" htmlFor={`status-${s.id}`}>
            Status of {s.fullName}
          </label>
          <select id={`status-${s.id}`} className="input w-44" value={s.status} disabled={setStatus.isPending} onChange={(e) => setStatus.mutate(e.target.value as StaffStatus)}>
            {STAFF_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STAFF_STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <StaffStatusChip status={s.status} />
      )}
    </li>
  );
}

// Admin: departments (names RW/EN, ticket prefix, kind, hours, open/closed, "what to bring").
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { DEPARTMENT_KINDS, SMS_FIELD_LIMITS, type DepartmentAdmin, type DepartmentKind } from '@umurongo/shared';
import { api, errorMessage } from '../../lib/api';
import { Dialog, ErrorState, Field, Spinner } from '../../components/ui';
import { OpenChip } from '../../components/StatusChip';
import { PageHeader, useAction } from '../common';

const KIND_LABEL: Record<DepartmentKind, string> = {
  CONSULTATION: 'Consultation',
  LAB: 'Laboratory',
  CASHIER: 'Cashier',
  PHARMACY: 'Pharmacy',
  IMAGING: 'Imaging',
  OTHER: 'Other',
};

type Draft = Omit<DepartmentAdmin, 'id'>;
const EMPTY: Draft = {
  code: '',
  prefix: '',
  kind: 'CONSULTATION',
  nameEn: '',
  nameRw: '',
  avgMinutes: null,
  isOpen: true,
  opensAt: '07:00',
  closesAt: '19:00',
  locationEn: '',
  locationRw: '',
  requirementsEn: '',
  requirementsRw: '',
  showOnTv: true,
  sortOrder: 100,
};

export default function Departments() {
  const q = useQuery({ queryKey: ['adminDepartments'], queryFn: api.adminDepartments });
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  return (
    <>
      <PageHeader
        title="Departments"
        subtitle="Names appear on tickets, SMS and the TV. Kinyarwanda names need a native check."
        actions={
          <button className="btn-navy" onClick={() => setEditing({ draft: EMPTY })}>
            <Plus size={18} aria-hidden /> Add department
          </button>
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState text={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Hours</th>
                <th className="px-4 py-3">Minutes per patient</th>
                <th className="px-4 py-3">What to bring</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(q.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-bold">
                    {d.code} <span className="text-sm font-semibold text-muted">({d.prefix}-001)</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-bold">{d.nameEn}</p>
                    <p className="text-sm text-muted">{d.nameRw}</p>
                  </td>
                  <td className="px-4 py-3">{KIND_LABEL[d.kind]}</td>
                  <td className="px-4 py-3 tabular-nums">{d.opensAt === '00:00' && d.closesAt === '24:00' ? '24 hours' : `${d.opensAt} to ${d.closesAt}`}</td>
                  <td className="px-4 py-3">{d.avgMinutes ?? 'default'}</td>
                  <td className="px-4 py-3 text-sm text-muted">{d.requirementsEn.split('\n').filter(Boolean).length} items</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <OpenChip open={d.isOpen} />
                      {!d.showOnTv && <span className="text-xs text-muted">not on TV</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-secondary btn-sm" onClick={() => setEditing({ id: d.id, draft: { ...d } })}>
                      <Pencil size={16} aria-hidden /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <DepartmentDialog id={editing.id} initial={editing.draft} onClose={() => setEditing(null)} />}
    </>
  );
}

function DepartmentDialog({ id, initial, onClose }: { id?: string; initial: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useAction(() => api.saveDepartment(d, id), { invalidate: [['adminDepartments'], ['departments']], success: `${d.nameEn} saved` });
  const L = SMS_FIELD_LIMITS.departmentName;

  return (
    <Dialog open onClose={onClose} title={id ? `Edit ${initial.nameEn}` : 'Add department'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" id="d-code" help="2 to 4 letters, e.g. OPD">
            <input id="d-code" className="input uppercase" value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase())} maxLength={4} required />
          </Field>
          <Field label="Ticket prefix" id="d-prefix" help={`Tickets: ${d.prefix || 'XXX'}-001`}>
            <input id="d-prefix" className="input uppercase" value={d.prefix} onChange={(e) => set('prefix', e.target.value.toUpperCase())} maxLength={4} required />
          </Field>
          <Field label="Kind" id="d-kind" help="Sets the step on the patient's journey">
            <select id="d-kind" className="input" value={d.kind} onChange={(e) => set('kind', e.target.value as DepartmentKind)}>
              {DEPARTMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (English)" id="d-en" help={`${d.nameEn.length}/${L} (fits in one SMS)`}>
            <input id="d-en" className="input" value={d.nameEn} onChange={(e) => set('nameEn', e.target.value)} maxLength={L} required />
          </Field>
          <Field label="Name (Kinyarwanda)" id="d-rw" help={`${d.nameRw.length}/${L}. Ask a native speaker to check.`}>
            <input id="d-rw" className="input" value={d.nameRw} onChange={(e) => set('nameRw', e.target.value)} maxLength={L} required lang="rw" />
          </Field>
          <Field label="Where (English)" id="d-loc-en">
            <input id="d-loc-en" className="input" value={d.locationEn} onChange={(e) => set('locationEn', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Where (Kinyarwanda)" id="d-loc-rw">
            <input id="d-loc-rw" className="input" value={d.locationRw} onChange={(e) => set('locationRw', e.target.value)} maxLength={80} lang="rw" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Opens" id="d-open">
            <input id="d-open" type="time" className="input" value={d.opensAt} onChange={(e) => set('opensAt', e.target.value)} />
          </Field>
          <Field label="Closes" id="d-close" help="24:00 = until midnight">
            <input id="d-close" className="input" value={d.closesAt} onChange={(e) => set('closesAt', e.target.value)} pattern="[0-2][0-9]:[0-5][0-9]" />
          </Field>
          <Field label="Minutes per patient" id="d-avg" help="Empty = hospital default">
            <input id="d-avg" type="number" min={1} max={240} className="input" value={d.avgMinutes ?? ''} onChange={(e) => set('avgMinutes', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Order" id="d-order">
            <input id="d-order" type="number" min={0} max={999} className="input" value={d.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What to bring (English), one per line" id="d-req-en">
            <textarea id="d-req-en" className="input min-h-[120px] py-2" value={d.requirementsEn} onChange={(e) => set('requirementsEn', e.target.value)} maxLength={1000} />
          </Field>
          <Field label="What to bring (Kinyarwanda), one per line" id="d-req-rw">
            <textarea id="d-req-rw" className="input min-h-[120px] py-2" value={d.requirementsRw} onChange={(e) => set('requirementsRw', e.target.value)} maxLength={1000} lang="rw" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex min-h-touch items-center gap-2 font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={d.isOpen} onChange={(e) => set('isOpen', e.target.checked)} /> Open (reception can register patients)
          </label>
          <label className="flex min-h-touch items-center gap-2 font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={d.showOnTv} onChange={(e) => set('showOnTv', e.target.checked)} /> Show on the waiting-room TV
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-navy" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

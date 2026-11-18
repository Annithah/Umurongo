// Admin: staff accounts. New people get a one-time invite link (valid 7 days) to set a password.
// The same link resets a forgotten password. Deactivating signs the person out at once.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, UserPlus } from 'lucide-react';
import { STAFF_ROLES, type StaffAdminView, type StaffMe } from '@umurongo/shared';
import { api, errorMessage, type StaffInput } from '../../lib/api';
import { clock, shortDate } from '../../lib/format';
import { Dialog, ErrorState, Field, Spinner, useToast } from '../../components/ui';
import { Chip, StaffStatusChip } from '../../components/StatusChip';
import { PageHeader, ROLE_LABEL, useAction } from '../common';

export default function StaffAccounts({ me }: { me: StaffMe }) {
  const staff = useQuery({ queryKey: ['adminStaff'], queryFn: api.adminStaff });
  const [editing, setEditing] = useState<{ id?: string; input: StaffInput } | null>(null);
  const [invite, setInvite] = useState<{ name: string; url: string; days: number } | null>(null);
  const renew = useAction((s: StaffAdminView) => api.renewInvite(s.id).then((r) => ({ ...r, name: s.fullName })));

  return (
    <>
      <PageHeader
        title="Staff accounts"
        subtitle="Invite people, set their role, department and room, or deactivate an account."
        actions={
          <button className="btn-navy" onClick={() => setEditing({ input: { fullName: '', email: '', role: 'CLINICIAN', title: '', departmentId: null, roomId: null, active: true } })}>
            <UserPlus size={18} aria-hidden /> Invite staff
          </button>
        }
      />
      {staff.isLoading ? (
        <Spinner />
      ) : staff.isError ? (
        <ErrorState text={errorMessage(staff.error)} onRetry={() => staff.refetch()} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Department · room</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last sign-in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(staff.data ?? []).map((s) => (
                <tr key={s.id} className={s.active ? undefined : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <p className="font-bold">{s.fullName}</p>
                    <p className="text-sm text-muted">{s.email}</p>
                  </td>
                  <td className="px-4 py-3">{ROLE_LABEL[s.role]}</td>
                  <td className="px-4 py-3 text-sm">
                    {s.departmentNameEn ?? '-'}
                    {s.roomName ? ` · ${s.roomName}` : ''}
                  </td>
                  <td className="px-4 py-3">{!s.active ? <Chip tone="grey">Deactivated</Chip> : s.invitePending ? <Chip tone="amber">Invite pending</Chip> : <StaffStatusChip status={s.status} />}</td>
                  <td className="px-4 py-3 text-sm text-muted">{s.lastLoginAt ? `${shortDate(s.lastLoginAt)} ${clock(s.lastLoginAt)}` : 'Never'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {s.active && (
                        <button
                          className="btn-secondary btn-sm"
                          onClick={() =>
                            renew.mutate(s, {
                              onSuccess: (r) => setInvite({ name: r.name, url: r.inviteUrl, days: r.expiresInDays }),
                            })
                          }
                        >
                          <KeyRound size={16} aria-hidden /> {s.invitePending ? 'New invite link' : 'Reset password'}
                        </button>
                      )}
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setEditing({ id: s.id, input: { fullName: s.fullName, email: s.email, role: s.role, title: s.title, departmentId: s.departmentId, roomId: s.roomId, active: s.active } })}
                      >
                        <Pencil size={16} aria-hidden /> Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <StaffDialog id={editing.id} initial={editing.input} isSelf={editing.id === me.id} onClose={() => setEditing(null)} onInvite={(name, url, days) => setInvite({ name, url, days })} />}
      {invite && <InviteDialog {...invite} onClose={() => setInvite(null)} />}
    </>
  );
}

function StaffDialog({ id, initial, isSelf, onClose, onInvite }: { id?: string; initial: StaffInput; isSelf: boolean; onClose: () => void; onInvite: (name: string, url: string, days: number) => void }) {
  const [s, setS] = useState<StaffInput>(initial);
  const set = <K extends keyof StaffInput>(k: K, v: StaffInput[K]) => setS((x) => ({ ...x, [k]: v }));
  const departments = useQuery({ queryKey: ['adminDepartments'], queryFn: api.adminDepartments });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: api.rooms });
  const save = useAction(async () => (id ? { staff: await api.updateStaff(id, s) } : await api.createStaff(s)), { invalidate: [['adminStaff'], ['staff'], ['rooms']], success: `${s.fullName} saved` });
  const needsDept = s.role === 'CLINICIAN' || s.role === 'COUNTER';
  const roomOptions = (rooms.data ?? []).filter((r) => r.active && (!s.departmentId || !r.departmentId || r.departmentId === s.departmentId));

  return (
    <Dialog open onClose={onClose} title={id ? `Edit ${initial.fullName}` : 'Invite staff'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, {
            onSuccess: (r) => {
              if ('inviteUrl' in r && r.inviteUrl) onInvite(s.fullName, r.inviteUrl, r.expiresInDays);
              onClose();
            },
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" id="s-name" help="Staff names are shown to patients on the TV.">
            <input id="s-name" className="input" value={s.fullName} onChange={(e) => set('fullName', e.target.value)} required maxLength={60} />
          </Field>
          <Field label="Email" id="s-email">
            <input id="s-email" type="email" className="input" value={s.email} onChange={(e) => set('email', e.target.value)} required />
          </Field>
          <Field label="Role" id="s-role">
            <select id="s-role" className="input" value={s.role} onChange={(e) => set('role', e.target.value as StaffInput['role'])} disabled={isSelf}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title" id="s-title" help="e.g. General practitioner, Lab technician">
            <input id="s-title" className="input" value={s.title} onChange={(e) => set('title', e.target.value)} maxLength={60} />
          </Field>
          <Field label={`Department${needsDept ? '' : ' (optional)'}`} id="s-dept">
            <select id="s-dept" className="input" value={s.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value || null)} required={needsDept}>
              <option value="">None</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room or counter" id="s-room" help={needsDept ? 'Needed to call patients.' : undefined}>
            <select id="s-room" className="input" value={s.roomId ?? ''} onChange={(e) => set('roomId', e.target.value || null)}>
              <option value="">None</option>
              {roomOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {id && !isSelf && (
          <label className="flex min-h-touch items-center gap-2 font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={s.active} onChange={(e) => set('active', e.target.checked)} /> Account active (unticking signs the person out at once)
          </label>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-navy" disabled={save.isPending}>
            {id ? 'Save' : 'Create invite link'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({ name, url, days, onClose }: { name: string; url: string; days: number; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title={`Invite link for ${name}`}>
      <p className="text-muted">Send this link to {name} (for example by WhatsApp). It works once and expires in {days} days. Anyone with the link can set the password, so share it only with them.</p>
      <div className="mt-4 flex gap-2">
        <input className="input font-mono text-sm" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
        <button
          className="btn-navy"
          onClick={() =>
            navigator.clipboard
              .writeText(url)
              .then(() => toast('Link copied'))
              .catch(() => toast('Select the link and copy it', 'info'))
          }
        >
          <Copy size={18} aria-hidden /> Copy
        </button>
      </div>
      <div className="mt-5 flex justify-end">
        <button className="btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

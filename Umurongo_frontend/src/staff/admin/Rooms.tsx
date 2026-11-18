// Admin: rooms and counters. The room name is what the TV and the "your turn" SMS show.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { SMS_FIELD_LIMITS, type RoomView } from '@umurongo/shared';
import { api, errorMessage } from '../../lib/api';
import { Dialog, EmptyState, ErrorState, Field, Spinner } from '../../components/ui';
import { Chip } from '../../components/StatusChip';
import { PageHeader, useAction } from '../common';

export default function Rooms() {
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: api.rooms });
  const departments = useQuery({ queryKey: ['adminDepartments'], queryFn: api.adminDepartments });
  const [editing, setEditing] = useState<Partial<RoomView> | null>(null);
  return (
    <>
      <PageHeader
        title="Rooms and counters"
        subtitle="Shown on the TV and in the SMS: keep names short and clear, e.g. Room 3 or Lab counter 1."
        actions={
          <button className="btn-navy" onClick={() => setEditing({ active: true, departmentId: null })}>
            <Plus size={18} aria-hidden /> Add room
          </button>
        }
      />
      {rooms.isLoading ? (
        <Spinner />
      ) : rooms.isError ? (
        <ErrorState text={errorMessage(rooms.error)} onRetry={() => rooms.refetch()} />
      ) : !rooms.data?.length ? (
        <EmptyState text="No rooms yet." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">Room</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rooms.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-bold">{r.name}</td>
                  <td className="px-4 py-3">{r.departmentCode ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-muted">{r.staffNames.join(', ') || 'No one assigned'}</td>
                  <td className="px-4 py-3">
                    <Chip tone={r.active ? 'green' : 'grey'}>{r.active ? 'In use' : 'Not in use'}</Chip>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-secondary btn-sm" onClick={() => setEditing(r)}>
                      <Pencil size={16} aria-hidden /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RoomDialog room={editing} departments={departments.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoomDialog({ room, departments, onClose }: { room: Partial<RoomView>; departments: { id: string; nameEn: string }[]; onClose: () => void }) {
  const [name, setName] = useState(room.name ?? '');
  const [departmentId, setDepartmentId] = useState<string | null>(room.departmentId ?? null);
  const [active, setActive] = useState(room.active ?? true);
  const save = useAction(() => api.saveRoom({ name: name.trim(), departmentId, active }, room.id), { invalidate: [['rooms']], success: `${name} saved` });
  return (
    <Dialog open onClose={onClose} title={room.id ? `Edit ${room.name}` : 'Add room'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <Field label="Name" id="room-name" help={`${name.length}/${SMS_FIELD_LIMITS.roomName}`}>
          <input id="room-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={SMS_FIELD_LIMITS.roomName} required />
        </Field>
        <Field label="Department" id="room-dept">
          <select id="room-dept" className="input" value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value || null)}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameEn}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex min-h-touch items-center gap-2 font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} /> In use
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-navy" disabled={!name.trim() || save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

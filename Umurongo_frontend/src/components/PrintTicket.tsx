// The printed walk-in ticket (A6 or an 80 mm receipt printer). Bilingual, with a QR code to the
// patient page. No phone number is printed.
import { en, rw } from '@umurongo/shared';
import { clock, longDate } from '../lib/format';
import QrCode from './QrCode';

export interface PrintableTicket {
  number: string;
  displayName: string;
  departmentNameRw: string;
  departmentNameEn: string;
  hospitalName: string;
  joinedAt: string;
  patientUrl: string;
  peopleAhead?: number;
}

export default function PrintTicket({ t }: { t: PrintableTicket }) {
  return (
    <div className="mx-auto w-[76mm] bg-white p-3 text-center text-ink" data-testid="print-ticket">
      <p className="text-sm font-bold">{t.hospitalName}</p>
      <p className="text-xs">
        {longDate(new Date(t.joinedAt))} · {clock(t.joinedAt)}
      </p>
      <div className="my-2 border-y border-dashed border-ink py-2">
        <p className="text-xs font-bold uppercase">
          {rw.print.ticket} · {en.print.ticket}
        </p>
        <p className="font-heading text-6xl font-black leading-none">{t.number}</p>
        <p className="mt-1 text-base font-bold">{t.departmentNameRw}</p>
        <p className="text-sm">{t.departmentNameEn}</p>
        <p className="mt-1 text-sm">{t.displayName}</p>
      </div>
      <div className="flex justify-center">
        <QrCode value={t.patientUrl} size={132} label={`QR code: ${t.patientUrl}`} />
      </div>
      <p className="mt-2 text-sm font-bold">{rw.print.scan}</p>
      <p className="text-xs">{en.print.scan}</p>
      <p className="mt-2 text-xs">{rw.print.tvAndSms}</p>
      <p className="text-xs">{en.print.tvAndSms}</p>
      <p className="mt-2 text-xs font-bold">
        {rw.print.keep} {en.print.keep}
      </p>
      <p className="mt-2 break-all text-[10px]">{t.patientUrl}</p>
    </div>
  );
}

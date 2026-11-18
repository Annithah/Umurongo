// Small SVG charts for the analytics page. One series per chart (the title names it, so no
// legend box). Thin bars with 4 px rounded data ends, a 2 px gap, recessive grid, hover tooltips,
// and every chart has a table view (the green mark is below 3:1 contrast on white, so values
// must also be readable as text).
import { useId, useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';

export interface Point {
  label: string;
  value: number | null;
  /** Longer label for the tooltip and table, e.g. a full date. */
  detail?: string;
}

const W = 640;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 40 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Card with a title, a chart / table toggle and an optional note. */
export function ChartCard({ title, subtitle, table, children }: { title: string; subtitle?: string; table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-navy">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        <button className="btn-secondary btn-sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? <BarChart3 size={16} aria-hidden /> : <Table2 size={16} aria-hidden />}
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {asTable ? table : children}
    </section>
  );
}

export function PointsTable({ points, labelHead, valueHead, format = String }: { points: Point[]; labelHead: string; valueHead: string; format?: (v: number) => string }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="table-head sticky top-0">
          <tr>
            <th className="px-3 py-2">{labelHead}</th>
            <th className="px-3 py-2 text-right">{valueHead}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {points.map((p) => (
            <tr key={p.label}>
              <td className="px-3 py-1.5">{p.detail ?? p.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{p.value === null ? '-' : format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  // Positioned in SVG coordinates, kept inside the plot.
  const left = Math.min(Math.max(x, 70), W - 70);
  return (
    <foreignObject x={left - 70} y={Math.max(0, y - 52)} width={140} height={46} pointerEvents="none">
      <div className="rounded-lg border border-line bg-white px-2 py-1 text-center text-xs shadow-sm">{children}</div>
    </foreignObject>
  );
}

function Axes({ max, ticks = 4, format }: { max: number; ticks?: number; format: (v: number) => string }) {
  const h = H - PAD.top - PAD.bottom;
  return (
    <g aria-hidden>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i;
        const y = PAD.top + h - (v / max) * h;
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" className="fill-muted text-[11px]">
              {format(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Vertical bars, one series. Labels the highest bar directly. */
export function BarChart({ points, format = (v: number) => String(Math.round(v)), label, everyNthLabel = 1 }: { points: Point[]; format?: (v: number) => string; label: string; everyNthLabel?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, points.length);
  const barW = Math.max(2, Math.min(28, slot - 2)); // 2 px surface gap between bars
  const peak = points.reduce((best, p, i) => ((p.value ?? -1) > (points[best]?.value ?? -1) ? i : best), 0);
  const titleId = useId();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={titleId} onMouseLeave={() => setHover(null)}>
      <title id={titleId}>{label}</title>
      <Axes max={max} format={format} />
      {points.map((p, i) => {
        const v = p.value ?? 0;
        const h = (v / max) * plotH;
        const x = PAD.left + i * slot + (slot - barW) / 2;
        const y = PAD.top + plotH - h;
        const r = Math.min(4, barW / 2, h);
        return (
          <g key={p.label}>
            {h > 0 && (
              // Rounded top only, square at the baseline.
              <path
                d={`M${x},${PAD.top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${PAD.top + plotH} Z`}
                className={hover === i ? 'fill-green-ink' : 'fill-green'}
              />
            )}
            {i % everyNthLabel === 0 && (
              <text x={x + barW / 2} y={H - 10} textAnchor="middle" className="fill-muted text-[11px]">
                {p.label}
              </text>
            )}
            {i === peak && v > 0 && hover === null && (
              <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="fill-ink text-[11px] font-bold">
                {format(v)}
              </text>
            )}
            {/* Hit target taller and wider than the bar. */}
            <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
          </g>
        );
      })}
      {hover !== null && (
        <Tooltip x={PAD.left + hover * slot + slot / 2} y={PAD.top + plotH - ((points[hover].value ?? 0) / max) * plotH}>
          <p className="font-bold text-ink">{points[hover].value === null ? '-' : format(points[hover].value!)}</p>
          <p className="text-muted">{points[hover].detail ?? points[hover].label}</p>
        </Tooltip>
      )}
    </svg>
  );
}

/** A 2 px line with a crosshair and tooltip. Gaps where there is no value. */
export function LineChart({ points, format = (v: number) => String(Math.round(v)), label, tone = 'navy', everyNthLabel = 5 }: { points: Point[]; format?: (v: number) => string; label: string; tone?: 'navy' | 'green'; everyNthLabel?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xAt = (i: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const titleId = useId();

  let path = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)} `;
    pen = true;
  });

  const stroke = tone === 'navy' ? 'stroke-navy' : 'stroke-green-ink';
  const fill = tone === 'navy' ? 'fill-navy' : 'fill-green-ink';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-labelledby={titleId}
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const x = ((e.clientX - box.left) / box.width) * W;
        const i = Math.round(((x - PAD.left) / plotW) * (points.length - 1));
        setHover(Math.min(points.length - 1, Math.max(0, i)));
      }}
    >
      <title id={titleId}>{label}</title>
      <Axes max={max} format={format} />
      <path d={path} className={`${stroke} fill-none`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) =>
        i % everyNthLabel === 0 || i === points.length - 1 ? (
          <text key={p.label} x={xAt(i)} y={H - 10} textAnchor="middle" className="fill-muted text-[11px]">
            {p.label}
          </text>
        ) : null,
      )}
      {hover !== null && (
        <g pointerEvents="none">
          <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-muted" strokeDasharray="3 3" />
          {points[hover].value !== null && <circle cx={xAt(hover)} cy={yAt(points[hover].value!)} r={4.5} className={`${fill} stroke-white`} strokeWidth={2} />}
          <Tooltip x={xAt(hover)} y={points[hover].value === null ? PAD.top + plotH : yAt(points[hover].value!)}>
            <p className="font-bold text-ink">{points[hover].value === null ? 'No data' : format(points[hover].value!)}</p>
            <p className="text-muted">{points[hover].detail ?? points[hover].label}</p>
          </Tooltip>
        </g>
      )}
    </svg>
  );
}

/** Headline number (not a chart). */
export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className="mt-1 font-heading text-3xl font-black text-ink">{value}</p>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}

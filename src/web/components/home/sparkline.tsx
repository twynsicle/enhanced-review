/**
 * Tiny inline SVG line chart for the "Recent" header. Scales to the max
 * value; a flat series draws a baseline.
 */
export function Sparkline({
  data,
  color,
  width,
  height,
  fill = false,
  ariaLabel,
}: {
  data: readonly number[];
  color: string;
  width: number;
  height: number;
  fill?: boolean;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...data);
  const pad = 1;
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const points = data.map((value, i) => {
    const x = pad + i * step;
    const y = height - pad - (value / max) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = points.join(' ');
  const area = `${pad},${height - pad} ${line} ${(pad + (data.length - 1) * step).toFixed(2)},${height - pad}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {fill && <polygon points={area} fill={color} opacity={0.15} />}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

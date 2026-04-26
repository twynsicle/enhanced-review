interface SparklineProps {
  data: readonly number[];
  width?: number;
  height?: number;
  /** SVG color string — defaults to currentColor so it inherits text color. */
  color?: string;
  /** Render a translucent area fill under the line. */
  fill?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Tiny inline sparkline for activity counts. Pure SVG, no library —
 * keeps the bundle clean. Each value is normalised to [0,1].
 */
export function Sparkline({
  data,
  width = 64,
  height = 20,
  color = 'currentColor',
  fill = false,
  className,
  ariaLabel,
}: SparklineProps) {
  if (data.length === 0) return null;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = pad + (i * w) / Math.max(1, data.length - 1);
    const y = pad + h - (v / max) * h;
    return [x, y] as const;
  });
  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className={className}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
    >
      {fill && (
        <path
          d={`${d} L${String(pad + w)} ${String(pad + h)} L${String(pad)} ${String(pad + h)} Z`}
          fill={color}
          opacity="0.10"
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

import { useEffect, useId, useRef, useState } from "react";

import {
  formatUsageDay,
  formatUsageTokens,
  USAGE_PROVIDER_COLORS,
  usageProviderName,
  type UsageSummary,
} from "./usageSummary";

const HEIGHT = 224;
const LEFT = 42;
const TOP = 10;
const BOTTOM = HEIGHT - 28;

export function UsageChart({ summary }: { summary: UsageSummary }) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(680);
  const right = width - 8;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Match SVG coordinates to CSS pixels so axis labels stay legible in narrow panes.
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const { days, providers } = summary;
  const selectedIndex = days.findIndex((day) => day.day === selectedDay);
  const selected = days[selectedIndex];
  const highestValue = Math.max(4, ...days.flatMap((day) => [...day.byProvider.values()]));
  const magnitude = 10 ** Math.floor(Math.log10(highestValue));
  const maximum = Math.ceil(highestValue / magnitude) * magnitude;
  const x = (index: number) =>
    days.length === 1 ? (LEFT + right) / 2 : LEFT + (index / (days.length - 1)) * (right - LEFT);
  const y = (value: number) => BOTTOM - (value / maximum) * (BOTTOM - TOP);
  const tickIndexes = [
    ...new Set(
      Array.from({ length: width < 400 ? 3 : 5 }, (_, i) =>
        Math.round((i * (days.length - 1)) / (width < 400 ? 2 : 4)),
      ),
    ),
  ];

  return (
    <div data-testid="usage-chart">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block h-56 w-full text-muted-foreground"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Daily processed tokens, ${formatUsageDay(days[0]!.day)} to ${formatUsageDay(days.at(-1)!.day)}. ${formatUsageTokens(summary.totalTokens)} tokens total. Use the Day breakdown for exact values.`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const localX = ((event.clientX - rect.left) / rect.width) * width;
            const index = Math.max(
              0,
              Math.min(
                days.length - 1,
                Math.round(((localX - LEFT) / (right - LEFT)) * (days.length - 1)),
              ),
            );
            setSelectedDay(days[index]!.day);
          }}
          onPointerLeave={() => setSelectedDay(null)}
        >
          <defs>
            {providers.map(({ provider }) => (
              <linearGradient key={provider} id={`${id}-${provider}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={USAGE_PROVIDER_COLORS[provider]} stopOpacity="0.24" />
                <stop
                  offset="100%"
                  stopColor={USAGE_PROVIDER_COLORS[provider]}
                  stopOpacity="0.015"
                />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <g key={ratio}>
              <line
                x1={LEFT}
                x2={right}
                y1={y(maximum * ratio)}
                y2={y(maximum * ratio)}
                stroke="var(--color-border)"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={LEFT - 8}
                y={y(maximum * ratio) + 3}
                textAnchor="end"
                fill="currentColor"
                fontSize="10"
              >
                {formatUsageTokens(maximum * ratio)}
              </text>
            </g>
          ))}
          {providers.map(({ provider }) => {
            const points = days.map((day, index) => ({
              x: x(index),
              y: y(day.byProvider.get(provider) ?? 0),
            }));
            const line = points
              .map((point, index) => {
                const previous = points[index - 1];
                if (!previous) return `M${point.x},${point.y}`;
                const middle = (previous.x + point.x) / 2;
                return `C${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
              })
              .join(" ");
            return (
              <g key={provider}>
                <path
                  d={`${line} L${x(days.length - 1)},${BOTTOM} L${x(0)},${BOTTOM} Z`}
                  fill={`url(#${id}-${provider})`}
                />
                <path
                  d={line}
                  fill="none"
                  stroke={USAGE_PROVIDER_COLORS[provider]}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {days.length === 1 ? (
                  <circle
                    cx={x(0)}
                    cy={points[0]!.y}
                    r="3"
                    fill={USAGE_PROVIDER_COLORS[provider]}
                  />
                ) : null}
              </g>
            );
          })}
          {selected ? (
            <line
              x1={x(selectedIndex)}
              x2={x(selectedIndex)}
              y1={TOP}
              y2={BOTTOM}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="3 3"
            />
          ) : null}
          {tickIndexes.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={HEIGHT - 5}
              textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
              fill="currentColor"
              fontSize="10"
            >
              {formatUsageDay(days[index]!.day)}
            </text>
          ))}
        </svg>
        {summary.totalTokens === 0 ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            No recorded tokens in this range.
          </p>
        ) : null}
        {selected ? (
          <div
            className="pointer-events-none absolute top-3 z-10 max-w-[80%] rounded-lg border border-border bg-popover px-3 py-2 text-[11px] text-popover-foreground shadow-md"
            style={selectedIndex < days.length / 2 ? { right: 8 } : { left: 42 }}
          >
            <p className="mb-1 font-medium">{formatUsageDay(selected.day)}</p>
            {providers.map(({ provider }) => (
              <div key={provider} className="flex items-center justify-between gap-5">
                <span>{usageProviderName(provider)}</span>
                <span className="tabular-nums">
                  {(selected.byProvider.get(provider) ?? 0).toLocaleString()} tokens
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {providers.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          {providers.map(({ provider }) => (
            <span key={provider} className="flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{ background: USAGE_PROVIDER_COLORS[provider] }}
              />
              {usageProviderName(provider)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

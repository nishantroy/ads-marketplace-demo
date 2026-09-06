"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, sessionTime } from "./playback";

export interface ChartPoint {
  time: number;
  value: number | null;
  target?: number;
}

export function TimelineChart({ points, durationMs, label, monetary = true, target = false }: {
  points: ChartPoint[];
  durationMs: number;
  label: string;
  monetary?: boolean;
  target?: boolean;
}) {
  const format = (value: number) => monetary ? money(value) : value.toFixed(1);
  return (
    <div className="timeline-chart" role="img" aria-label={`${label}. Only completed playback buckets are shown.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points} margin={{ top: 12, right: 14, bottom: 2, left: 0 }} accessibilityLayer>
          <CartesianGrid stroke="#e8eeeb" vertical={false} />
          <XAxis dataKey="time" type="number" domain={[0, durationMs]} ticks={[0, durationMs / 3, durationMs * 2 / 3, durationMs]}
            tickFormatter={sessionTime} axisLine={false} tickLine={false} tick={{ fill: "#67776e", fontSize: 11 }} />
          <YAxis tickFormatter={format} width={62} axisLine={false} tickLine={false} tick={{ fill: "#67776e", fontSize: 11 }} domain={[0, "auto"]} />
          <Tooltip labelFormatter={value => `Session ${sessionTime(Number(value))}`}
            formatter={value => typeof value === "number" ? format(value) : "No observations"}
            contentStyle={{ borderRadius: 10, border: "1px solid #dce5df", fontSize: 12 }} />
          {target && <Line name="Linear spend target" dataKey="target" stroke="#99a49d" strokeDasharray="5 5" dot={false} isAnimationActive={false} />}
          <Line name={label} type="stepAfter" dataKey="value" stroke="#18745a" strokeWidth={2.5}
            dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

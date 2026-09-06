"use client";

import { useEffect, useRef } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5xy from "@amcharts/amcharts5/xy";
import { money, sessionTime } from "./playback";

export interface ChartPoint {
  time: number;
  value: number | null;
  target?: number;
}

export function TimelineChart({ points, durationMs, label, monetary = true, target = false, maxValue, cumulative = false }: {
  points: ChartPoint[];
  durationMs: number;
  label: string;
  monetary?: boolean;
  target?: boolean;
  /** Input-derived bound, in micros for money; never a hidden future result. */
  maxValue?: number;
  cumulative?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<{ actual: am5xy.LineSeries; target?: am5xy.LineSeries } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const root = am5.Root.new(containerRef.current);
    // Retain the built-in amCharts attribution. No license key is configured.
    root.utc = true;
    root.dateFormatter.setAll({ dateFormat: "HH:mm", dateFields: ["valueX"] });
    root.numberFormatter.set("numberFormat", monetary ? "$#,###.00" : "#.0");
    const chart = root.container.children.push(am5xy.XYChart.new(root, {
      panX: false, panY: false, wheelX: "none", wheelY: "none", paddingLeft: 0, paddingRight: 12,
    }));
    const rendererX = am5xy.AxisRendererX.new(root, { minGridDistance: 75 });
    rendererX.labels.template.setAll({ fontSize: 11, fill: am5.color(0x63756b) });
    rendererX.grid.template.set("visible", false);
    const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
      baseInterval: { timeUnit: "minute", count: 5 },
      min: 0, max: durationMs, strictMinMax: true, maxDeviation: 0,
      markUnitChange: false, dateFormats: { minute: "HH:mm", hour: "HH:mm", day: "HH:mm" },
      tooltipDateFormat: "HH:mm", renderer: rendererX,
    }));
    const rendererY = am5xy.AxisRendererY.new(root, { minGridDistance: 40 });
    rendererY.labels.template.setAll({ fontSize: 11, fill: am5.color(0x63756b), width: 58 });
    rendererY.grid.template.setAll({ stroke: am5.color(0xdfe7df), strokeOpacity: 0.65 });
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
      min: 0, max: maxValue === undefined ? undefined : maxValue / (monetary ? 1_000_000 : 1),
      strictMinMax: maxValue !== undefined, renderer: rendererY,
    }));
    const actual = chart.series.push(am5xy.LineSeries.new(root, {
      name: label, xAxis, yAxis, valueXField: "time", valueYField: "value", locationX: 0,
      connect: false, stroke: am5.color(0x18745a), fill: am5.color(0x18745a),
      tooltip: am5.Tooltip.new(root, { labelText: "{valueX.formatDate('HH:mm')} elapsed\n{name}: {valueY}" }),
    }));
    actual.strokes.template.set("strokeWidth", 2.5);
    actual.bullets.push(() => am5.Bullet.new(root, {
      sprite: am5.Circle.new(root, { radius: 2, fill: am5.color(0x18745a) }),
    }));
    const targetSeries = target ? chart.series.push(am5xy.LineSeries.new(root, {
      name: "Linear spend target", xAxis, yAxis, valueXField: "time", valueYField: "target", locationX: 0,
      stroke: am5.color(0x99a49d), connect: false,
    })) : undefined;
    targetSeries?.strokes.template.setAll({ strokeDasharray: [5, 5], strokeWidth: 1.5 });
    const cursor = chart.set("cursor", am5xy.XYCursor.new(root, { behavior: "none", xAxis }));
    cursor.lineY.set("visible", false);
    seriesRef.current = { actual, target: targetSeries };
    return () => { seriesRef.current = null; root.dispose(); };
  }, [durationMs, label, monetary, target, maxValue]);

  useEffect(() => {
    const divisor = monetary ? 1_000_000 : 1;
    const data = points.map(point => ({
      time: point.time, value: point.value === null ? null : point.value / divisor,
      target: point.target === undefined ? undefined : point.target / divisor,
    }));
    // Explicit vertical steps at completed bucket ends: never extend into an unrevealed bucket.
    const actualData = cumulative ? data.flatMap((point, index) => index === 0 ? [point] : [
      { time: point.time, value: data[index - 1].value }, point,
    ]) : data;
    seriesRef.current?.actual.data.setAll(actualData);
    seriesRef.current?.target?.data.setAll(data);
  }, [points, cumulative, durationMs, label, monetary, target, maxValue]);

  const latest = points.at(-1);
  return <div role="group" aria-label={label}>
    <div ref={containerRef} className="timeline-chart" />
    <p className="sr-only">{latest ? `At ${sessionTime(latest.time)} elapsed: ${monetary ? money(latest.value) : latest.value?.toFixed(1) ?? "no observations"}.` : "No observations yet."} Only completed playback buckets are shown.</p>
  </div>;
}

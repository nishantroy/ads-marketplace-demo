export type Swatch = "off" | "on" | "target";

/** Off and on are always the same two colors everywhere (see timeline-chart.tsx); this is the one legend
 * every chart in the app shares, so a swatch never needs to be relearned from one chart to the next. */
export function Legend({ items }: { items: { swatch: Swatch; label: string }[] }) {
  return <span className="legend">{items.map(item => <span className="legend-item" key={item.label}><i className={item.swatch} />{item.label}</span>)}</span>;
}

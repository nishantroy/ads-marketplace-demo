export interface FunnelStage {
  id: string;
  label: string;
  /** Relative width of this band, in (0, 1]; bands narrow from top to bottom. */
  width: number;
}

const MAX_SHAPE_WIDTH_PX = 380;

/**
 * A narrowing funnel built from CSS trapezoids, not SVG or a chart library. The label sits beside the
 * shape, not inside it, so it stays fully readable even for the narrowest bands near the bottom.
 */
export function FunnelDiagram({ stages, activeIndex, doneUpTo, onSelect }: {
  stages: FunnelStage[];
  activeIndex: number;
  /** Bands before this index are marked complete; -1 means none yet. */
  doneUpTo: number;
  onSelect: (index: number) => void;
}) {
  return <div className="funnel" role="list" aria-label="Ad delivery stages">
    {stages.map((stage, index) => {
      const widthPx = stage.width * MAX_SHAPE_WIDTH_PX;
      const nextWidth = stages[index + 1]?.width ?? stage.width * 0.3;
      const bottomPct = (nextWidth / stage.width) * 100;
      const inset = (100 - bottomPct) / 2;
      const isLast = index === stages.length - 1;
      const state = index === activeIndex ? "active" : index < doneUpTo ? "done" : "";
      return <button key={stage.id} role="listitem" type="button" className={`funnel-row ${state}`}
        onClick={() => onSelect(index)} aria-current={index === activeIndex ? "step" : undefined}>
        <span className="funnel-shape-slot" style={{ width: `${MAX_SHAPE_WIDTH_PX}px` }}>
          <span className="funnel-shape" style={{ width: `${widthPx}px`, clipPath: isLast ? undefined : `polygon(0 0, 100% 0, ${100 - inset}% 100%, ${inset}% 100%)` }} aria-hidden="true" />
        </span>
        <span className="funnel-text"><span className="funnel-index">{index + 1}</span><span className="funnel-label">{stage.label}</span></span>
      </button>;
    })}
  </div>;
}

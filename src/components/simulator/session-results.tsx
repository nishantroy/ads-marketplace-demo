import type { TimelineBucket } from "../../lib/contracts";
import { money, sessionTime } from "./playback";

const HOUR_MS = 3_600_000;

/** Sum recorded counts and charges; never average bucket averages or rerun auctions. */
function totals(buckets: TimelineBucket[]) {
  const requests = buckets.reduce((sum, b) => sum + b.requests, 0);
  const filled = buckets.reduce((sum, b) => sum + b.filled, 0);
  const revenue = buckets.reduce((sum, b) => sum + b.revenueMicros, 0);
  return { requests, filled, revenue, price: filled ? revenue / filled : null };
}

const percent = (filled: number, requests: number) => requests ? `${(100 * filled / requests).toFixed(1)}%` : "—";
const count = (value: number) => value.toLocaleString("en-US");

export function SessionResults({ modes, duration }: {
  modes: { label: string; timeline: TimelineBucket[] }[];
  duration: number;
}) {
  const windows = [
    { label: "Whole session", start: 0, end: duration },
    ...Array.from({ length: Math.ceil(duration / HOUR_MS) }, (_, i) => ({
      label: `${sessionTime(i * HOUR_MS)}–${sessionTime(Math.min((i + 1) * HOUR_MS, duration))}${i === Math.ceil(duration / HOUR_MS) - 1 ? " · final hour" : ""}`,
      start: i * HOUR_MS, end: Math.min((i + 1) * HOUR_MS, duration),
    })),
  ];
  return <section className="session-results">
    <p className="eyebrow">Playback complete · recorded auction results</p>
    <h3>{modes.length > 1 ? "The same demand. Different delivery." : `${modes[0].label}: what actually filled?`}</h3>
    <p>Each request offers one ad slot. Fill rate is the share that found a winner; average impression price is what those winners paid.</p>
    <div className="results-highlights">
      {modes.map(mode => {
        const all = totals(mode.timeline);
        const last = totals(mode.timeline.filter(b => b.startMs >= duration - HOUR_MS));
        return <article className="panel" key={mode.label}>
          <h4>{mode.label}</h4>
          <p><strong>{percent(all.filled, all.requests)}</strong> of all requests filled</p>
          <p>
            {all.price === null ? (
              "No impressions"
            ) : (
              <>
                <strong>{money(all.price)}</strong> average price
              </>
            )}
          </p>
          <p>{count(all.filled)} impressions from {count(all.requests)} requests</p>
          <hr />
          <p><strong>{count(last.filled)} / {count(last.requests)}</strong> requests filled in the final hour ({percent(last.filled, last.requests)})</p>
          <p>{last.price === null ? "No impressions sold — no average price." : `${money(last.price)} per impression in the final hour.`} Revenue: {money(last.revenue)}.</p>
        </article>;
      })}
    </div>
    <div className="table-scroll"><table>
      <caption>Whole-session and hourly results · average price = total charges ÷ filled requests</caption>
      <thead>
        <tr><th scope="col" rowSpan={2}>Window</th><th scope="col" rowSpan={2}>Requests</th>
          {modes.map(mode => <th key={mode.label} scope="colgroup" colSpan={3} className="result-mode-group">{mode.label}</th>)}
        </tr>
        <tr>{modes.flatMap(mode => [
          <th key={`${mode.label}-fill`} scope="col" className="result-mode-start">Fill rate</th>,
          <th key={`${mode.label}-price`} scope="col">Avg. imp. price</th>,
          <th key={`${mode.label}-revenue`} scope="col">Revenue</th>,
        ])}</tr>
      </thead>
      <tbody>{windows.map((window, index) => {
        const results = modes.map(mode => totals(mode.timeline.filter(b => b.startMs >= window.start && b.startMs < window.end)));
        return <tr key={window.label} className={index === windows.length - 1 ? "final-hour-row" : undefined}>
          <th scope="row">{window.label}</th><td>{count(results[0].requests)}</td>
          {results.flatMap((result, modeIndex) => [
            <td key={`${modeIndex}-fill`} className="result-mode-start">{percent(result.filled, result.requests)}</td>,
            <td key={`${modeIndex}-price`}>{result.price === null ? "— No impressions" : money(result.price)}</td>,
            <td key={`${modeIndex}-revenue`}>{money(result.revenue)}</td>,
          ])}
        </tr>;
      })}</tbody>
    </table></div>
    <p className="small muted">No impressions means no price observation—not free ads. An empty auction earns $0. Counts and charges are summed from the engine’s recorded five-minute buckets.</p>
  </section>;
}

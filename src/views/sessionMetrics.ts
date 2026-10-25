import type { BrewSession } from '../types';

/** Shared presentation keeps the feed and each bean's history consistent. */
export function renderSessionMetrics(session: BrewSession, group: 'all' | 'input' | 'result' = 'all'): HTMLDListElement {
  const metrics = document.createElement('dl');
  metrics.className = 'session-metrics';
  const input: [string, number | string | null][] = [
    ['Dose (g)', session.dose_g], ['Water (g)', session.water_g],
    ['Grind (µm)', session.grind_um], ['Temp (°C)', session.temp_c],
    ['Time', session.time_str],
  ];
  const result: [string, number | string | null][] = [
    ['Yield (g)', session.yield_g], ['TDS (%)', session.tds_pct],
    ['Extraction (%)', session.extraction_pct?.toFixed(2) ?? null],
  ];
  const values = group === 'input' ? input : group === 'result' ? result : [...input, ...result, ['Comment', session.comment] as const];
  for (const [label, value] of values) {
    const field = document.createElement('div');
    if (label === 'Comment') field.className = 'session-comment';
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value === null || value === '' ? '—' : String(value);
    field.append(term, description);
    metrics.append(field);
  }
  return metrics;
}

const X_MIN = 14;
const X_MAX = 26;
const Y_MIN = 0.95;
const Y_MAX = 1.75;
const LEFT = 76;
const TOP = 24;
const SIZE = 420;
const x = (extraction: number) => LEFT + (extraction - X_MIN) / (X_MAX - X_MIN) * SIZE;
const y = (tds: number) => TOP + (Y_MAX - tds) / (Y_MAX - Y_MIN) * SIZE;

// Region boundaries and wording follow the supplied brewing-chart reference.
const labels = [
  [['Strong', 'Under-', 'Developed'], ['Strong'], ['Strong Bitter']],
  [['Under-', 'Developed'], ['Ideal', 'Optimum', 'Balance'], ['Bitter']],
  [['Weak Under-', 'Developed'], ['Weak'], ['Weak Bitter']],
];

function chartMarkup(): string {
  const regions = labels.flatMap((row, rowIndex) => row.map((lines, column) => {
    const centerX = x(16 + column * 4);
    const centerY = y(1.65 - rowIndex * 0.3);
    return `<text class="brewing-chart-region" x="${centerX}" y="${centerY}">${lines.map((line, index) =>
      `<tspan x="${centerX}" dy="${index === 0 ? -(lines.length - 1) * 12 : 24}">${line}</tspan>`).join('')}</text>`;
  })).join('');
  const vertical = Array.from({ length: 13 }, (_, i) =>
    `<line x1="${x(14 + i)}" x2="${x(14 + i)}" y1="${TOP}" y2="${TOP + SIZE}"/>`).join('');
  const horizontal = Array.from({ length: 17 }, (_, i) =>
    `<line x1="${LEFT}" x2="${LEFT + SIZE}" y1="${y(0.95 + i * 0.05)}" y2="${y(0.95 + i * 0.05)}"/>`).join('');
  const xTicks = Array.from({ length: 7 }, (_, i) =>
    `<text x="${x(14 + i * 2)}" y="474">${14 + i * 2}</text>`).join('');
  const yTicks = Array.from({ length: 9 }, (_, i) =>
    `<text x="66" y="${y(0.95 + i * 0.1)}" text-anchor="end" dominant-baseline="middle">${(0.95 + i * 0.1).toFixed(2)}</text>`).join('');
  return `
    <svg class="brewing-chart-svg" viewBox="0 0 520 524" role="img" aria-label="Coffee brewing control chart">
      <rect class="brewing-chart-plot" x="${LEFT}" y="${TOP}" width="${SIZE}" height="${SIZE}" rx="8"/>
      <path class="brewing-chart-band" d="M ${x(18)} ${TOP} h 140 v ${SIZE} h -140 Z M ${LEFT} ${y(1.55)} h ${SIZE} v 210 h -${SIZE} Z"/>
      <rect class="brewing-chart-ideal" x="${x(18)}" y="${y(1.55)}" width="140" height="210"/>
      <g class="brewing-chart-grid">${vertical}${horizontal}</g>
      <g class="brewing-chart-labels">${regions}</g>
      <g class="brewing-chart-ticks">${xTicks}${yTicks}</g>
      <g class="brewing-chart-axis">
        <text x="${LEFT + SIZE / 2}" y="510">Percent Extraction (%)</text>
        <text transform="translate(19 ${TOP + SIZE / 2}) rotate(-90)">Total Dissolved Solids (TDS%)</text>
      </g>
      <g class="brewing-chart-result" hidden>
        <path class="brewing-chart-guides"/>
        <circle class="brewing-chart-point" r="7"><title>Your brew</title></circle>
      </g>
      <rect class="brewing-chart-border" x="${LEFT}" y="${TOP}" width="${SIZE}" height="${SIZE}" rx="8"/>
    </svg>`;
}

export function createBrewingChart(): {
  element: HTMLElement;
  update: (extraction: number | null, tds: number | null) => void;
} {
  const element = document.createElement('figure');
  element.className = 'brewing-chart';
  element.innerHTML = `<h3>Brewing control chart</h3>${chartMarkup()}
    <figcaption class="brewing-chart-summary" aria-live="polite" aria-atomic="true"></figcaption>`;
  const svg = element.querySelector('svg')!;
  const result = element.querySelector<SVGGElement>('.brewing-chart-result')!;
  const guides = element.querySelector('.brewing-chart-guides')!;
  const point = element.querySelector('.brewing-chart-point')!;
  const summary = element.querySelector('figcaption')!;

  function update(extraction: number | null, tds: number | null): void {
    result.setAttribute('hidden', '');
    let message = 'Enter positive dose, yield, and TDS values to plot your brew.';
    if (extraction !== null && tds !== null && Number.isFinite(extraction) && Number.isFinite(tds) && extraction > 0 && tds > 0) {
      const coordinates = `Your brew: ${extraction.toFixed(2)}% extraction · ${tds.toFixed(2)}% TDS`;
      if (extraction < X_MIN || extraction > X_MAX || tds < Y_MIN || tds > Y_MAX) {
        message = `${coordinates}. Outside chart range (14–26% extraction; 0.95–1.75% TDS).`;
      } else {
        const column = extraction < 18 ? 0 : extraction > 22 ? 2 : 1;
        const row = tds > 1.55 ? 0 : tds < 1.15 ? 2 : 1;
        const quality = labels[row]![column]!.join(' ').replace(/- /g, '-');
        message = `${coordinates} — ${quality}.`;
        const cx = x(extraction);
        const cy = y(tds);
        point.setAttribute('cx', String(cx));
        point.setAttribute('cy', String(cy));
        point.querySelector('title')!.textContent = message;
        guides.setAttribute('d', `M ${LEFT} ${cy} H ${cx} V ${TOP + SIZE}`);
        result.removeAttribute('hidden');
      }
    }
    summary.textContent = message;
    svg.setAttribute('aria-label', `Coffee brewing control chart. X: extraction, 14 to 26 percent. Y: TDS, 0.95 to 1.75 percent. ${message}`);
  }

  update(null, null);
  return { element, update };
}

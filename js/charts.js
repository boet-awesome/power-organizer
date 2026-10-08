// charts.js — minimal SVG bar chart, no charting library needed.

export function barChart(series, { width = 320, height = 120, color = 'var(--teal)' } = {}) {
  const max = Math.max(1, ...series.map(s => s.value));
  const barW = width / series.length;
  const gap = barW * 0.28;
  const bars = series.map((s, i) => {
    const h = (s.value / max) * (height - 24);
    const x = i * barW + gap / 2;
    const y = height - 20 - h;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - gap).toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="3" fill="${color}" />
      <text x="${(x + (barW - gap) / 2).toFixed(1)}" y="${height - 6}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${s.label}</text>
      ${s.value > 0 ? `<text x="${(x + (barW - gap) / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${s.value}</text>` : ''}
    `;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="7 day completion trend">${bars}</svg>`;
}

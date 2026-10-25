import assert from 'node:assert/strict';

export async function checkBrewingChart({ sync, fillSession }) {
  const state = () => sync(`const chart = document.querySelector('.brewing-chart');
    const point = chart.querySelector('.brewing-chart-point');
    return {
      hidden: chart.querySelector('.brewing-chart-result').hasAttribute('hidden'),
      cx: Number(point.getAttribute('cx')), cy: Number(point.getAttribute('cy')),
      summary: chart.querySelector('figcaption').textContent,
      accessible: chart.querySelector('svg').getAttribute('aria-label'),
      guides: chart.querySelector('.brewing-chart-guides').getAttribute('d'),
      regions: chart.querySelectorAll('.brewing-chart-region').length,
      overflow: document.querySelector('.app-content').scrollWidth > document.querySelector('.app-content').clientWidth,
    };`);
  let chart = await state();
  assert.equal(chart.hidden, true);
  assert.equal(chart.regions, 9);
  assert.equal(chart.overflow, false);
  await fillSession({ dose_g: '18', yield_g: '270', tds_pct: '1.35' });
  chart = await state();
  assert.equal(chart.hidden, false);
  assert.ok(Math.abs(chart.cx - 294.75) < 1e-9); // 20.25% EY on a 14–26 scale.
  assert.ok(Math.abs(chart.cy - 234) < 1e-9); // 1.35% TDS at the vertical midpoint.
  assert.match(chart.guides, /^M 76 /);
  assert.match(chart.guides, / V 444$/);
  assert.match(chart.summary, /20.25% extraction · 1.35% TDS — Ideal Optimum Balance/);
  assert.ok(chart.accessible.includes(chart.summary));
  for (const [field, original] of [['dose_g', '18'], ['yield_g', '270'], ['tds_pct', '1.35']]) {
    for (const value of ['', '0', '-1']) {
      await fillSession({ [field]: value });
      chart = await state();
      assert.equal(chart.hidden, true);
      assert.match(chart.summary, /Enter positive/);
    }
    await fillSession({ [field]: original });
    assert.equal((await state()).hidden, false);
  }
  for (const [tds, qualities] of [
    [1.65, ['Strong Under-Developed', 'Strong', 'Strong Bitter']],
    [1.35, ['Under-Developed', 'Ideal Optimum Balance', 'Bitter']],
    [1.05, ['Weak Under-Developed', 'Weak', 'Weak Bitter']],
  ]) {
    for (const [index, extraction] of [16, 20, 24].entries()) {
      await fillSession({ dose_g: '10', yield_g: String(extraction * 10 / tds), tds_pct: String(tds) });
      chart = await state();
      assert.equal(chart.hidden, false);
      assert.ok(chart.summary.endsWith(`${qualities[index]}.`), chart.summary);
    }
  }
  for (const [extraction, tds, cx, cy] of [[14, 0.95, 76, 444], [26, 1.75, 496, 24]]) {
    await fillSession({ dose_g: String(tds), yield_g: String(extraction), tds_pct: String(tds) });
    chart = await state();
    assert.equal(chart.hidden, false);
    assert.ok(Math.abs(chart.cx - cx) < 1e-9);
    assert.ok(Math.abs(chart.cy - cy) < 1e-9);
  }
  for (const [extraction, tds] of [[13, 1.35], [27, 1.35], [20, 0.9], [20, 1.8]]) {
    await fillSession({ dose_g: '10', yield_g: String(extraction * 10 / tds), tds_pct: String(tds) });
    chart = await state();
    assert.equal(chart.hidden, true);
    assert.match(chart.summary, /Outside chart range/);
    assert.ok(chart.summary.includes(`${extraction.toFixed(2)}% extraction`));
  }
  await fillSession({ dose_g: '', yield_g: '', tds_pct: '' });
  console.log('PASS brewing chart live coordinates/guides, nine regions, invalid inputs, scale endpoints, out-of-range feedback, accessibility, and narrow layout');
}

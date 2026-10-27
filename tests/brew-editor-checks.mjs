import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Desktop Safari has a minimum window width. Render the actual app DOM and
// stylesheet in an exact-size frame to check phone geometry independently.
export async function checkBrewEditor({ sync, api, screenshotPath }) {
  await api('/window/rect', { width: 1000, height: 1100 });
  await sync(`
    const frame = document.createElement('iframe');
    frame.id = 'brew-editor-viewport';
    frame.style.cssText = 'position:fixed;inset:0;width:393px;height:852px;border:0;z-index:1000;background:#0e1222';
    document.body.append(frame);
    const doc = frame.contentDocument;
    for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.append(style.cloneNode(true));
    doc.body.append(document.querySelector('#app').cloneNode(true));
    for (const field of document.querySelectorAll('#app input, #app select, #app output')) {
      if (field.id) doc.getElementById(field.id).value = field.value;
    }
  `);
  try {
    // Allow linked production CSS to finish loading before measuring.
    for (let i = 0; i < 100; i++) {
      if (await sync(`const doc = document.querySelector('#brew-editor-viewport').contentDocument;
        return getComputedStyle(doc.querySelector('.session-measurements')).display === 'grid';`)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const [width, height] of [[320, 568], [320, 852], [375, 667], [375, 812], [393, 680], [393, 852], [430, 932], [852, 393]]) {
      for (const safeAreas of [false, true]) {
        const layout = await sync(`
          const frame = document.querySelector('#brew-editor-viewport');
          frame.style.width = '${width}px';
          frame.style.height = '${height}px';
          const doc = frame.contentDocument;
          const form = doc.querySelector('.session-form');
          form.style.setProperty('--editor-safe-top', '${safeAreas ? 59 : 0}px');
          form.style.setProperty('--editor-safe-bottom', '${safeAreas ? 34 : 0}px');
          const content = doc.querySelector('.session-body');
          content.scrollTop = 0;
          const bounds = selector => {
            const rect = doc.querySelector(selector).getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          };
          return {
            width: frame.contentWindow.innerWidth,
            height: frame.contentWindow.innerHeight,
            scale: new DOMMatrix(getComputedStyle(form).transform).a,
            horizontal: content.scrollWidth > content.clientWidth,
            vertical: content.scrollHeight > content.clientHeight,
            body: bounds('.session-body'), measurements: bounds('.session-measurements'),
            chart: bounds('.session-form .brewing-chart'), bean: bounds('.session-bean-field'),
            input: bounds('.session-measurements > div:first-child'),
            output: bounds('.session-measurements > div:last-child'),
            grind: bounds('#session-grind'), comment: bounds('#session-comment'),
            actions: bounds('.session-actions'),
            cancel: bounds('.cancel-session'), save: bounds('.save-session'),
            svg: bounds('.session-form .brewing-chart-svg'),
            caption: bounds('.session-form .brewing-chart-summary'),
            navigation: getComputedStyle(doc.querySelector('.tab-bar')).display,
            fields: [...doc.querySelectorAll('.session-form input, .session-form select')].filter(field => field.getBoundingClientRect().height > 0).map(field => ({
              font: getComputedStyle(field).fontSize, height: field.getBoundingClientRect().height,
            })),
          };
        `);
        assert.equal(layout.width, width);
        assert.equal(layout.height, height);
        const expectedScale = Math.max(0.8, Math.min(1, width / 393, (height - (safeAreas ? 93 : 0)) / 759));
        assert.ok(Math.abs(layout.scale - expectedScale) < 0.00001, JSON.stringify(layout));
        assert.equal(layout.horizontal, false, JSON.stringify(layout));
        assert.equal(layout.navigation, 'none');
        assert.equal(layout.cancel.top, layout.save.top);
        assert.equal(layout.cancel.bottom, layout.save.bottom);
        assert.ok(layout.cancel.right < layout.save.left);
        assert.ok(layout.svg.bottom - layout.svg.top >= 220 * expectedScale - 1);
        assert.ok(layout.caption.bottom - layout.caption.top <= 1);
        assert.ok(layout.chart.bottom <= layout.bean.top);
        assert.ok(layout.input.right < layout.output.left);
        assert.ok(Math.abs(layout.grind.top - layout.comment.top) <= 1, JSON.stringify(layout));
        assert.ok(Math.abs(layout.grind.bottom - layout.comment.bottom) <= 1, JSON.stringify(layout));
        assert.ok(layout.fields.every(field => field.font === '16px' && field.height >= 44 * expectedScale - 1));
        assert.ok(Math.abs(layout.actions.bottom - height) <= 1, JSON.stringify(layout));
        if (!layout.vertical) {
          assert.ok(layout.measurements.bottom <= layout.actions.top, JSON.stringify(layout));
          // With no warning/hint, only the intentional body padding separates
          // the final fields from the actions; spare height belongs to the chart.
          if (width <= 420) assert.ok(layout.actions.top - layout.measurements.bottom <= 13 * expectedScale + 1, JSON.stringify(layout));
        }
        if ((width === 393 && height === 852) || (width === 375 && height === 667)) {
          assert.equal(layout.vertical, false, JSON.stringify(layout));
        }
        if (height === 393 || (height === 568 && safeAreas)) {
          assert.equal(layout.vertical, true, JSON.stringify(layout));
          const reached = await sync(`
            const doc = document.querySelector('#brew-editor-viewport').contentDocument;
            const body = doc.querySelector('.session-body');
            body.scrollTop = body.scrollHeight;
            const comment = doc.querySelector('#session-comment').getBoundingClientRect();
            const actions = doc.querySelector('.session-actions').getBoundingClientRect();
            return { reachable: comment.top >= body.getBoundingClientRect().top && comment.bottom <= actions.top, bottom: actions.bottom };
          `);
          assert.ok(reached.reachable && Math.abs(reached.bottom - height) <= 1, JSON.stringify(reached));
        }
      }
    }
    const pinned = await sync(`
      const doc = document.querySelector('#brew-editor-viewport').contentDocument;
      const frame = document.querySelector('#brew-editor-viewport');
      frame.style.width = '393px'; frame.style.height = '852px';
      const content = doc.querySelector('.session-body');
      const spacer = doc.createElement('div'); spacer.style.height = '1500px'; content.append(spacer);
      content.scrollTop = 500;
      const rect = doc.querySelector('.session-actions').getBoundingClientRect();
      const result = { scrolled: content.scrollTop > 0, bottom: rect.bottom, visible: rect.top > 0 };
      spacer.remove(); content.scrollTop = 0; return result;
    `);
    assert.equal(pinned.scrolled, true);
    assert.ok(Math.abs(pinned.bottom - 852) <= 1 && pinned.visible, JSON.stringify(pinned));
    const focus = await sync(`
      const doc = document.querySelector('#brew-editor-viewport').contentDocument;
      return [...doc.querySelectorAll('.session-form label')].filter(label => label.control?.tagName !== 'OUTPUT' && label.getBoundingClientRect().height > 0)
        .map(label => { label.click(); return { id: label.htmlFor, focused: doc.activeElement.id === label.htmlFor }; });
    `);
    assert.ok(focus.length >= 9 && focus.every(field => field.focused), JSON.stringify(focus));
    if (screenshotPath) {
      await sync(`const frame = document.querySelector('#brew-editor-viewport'); frame.style.width = '393px';
        frame.contentDocument.activeElement.blur();`);
      const element = await sync(`return document.querySelector('#brew-editor-viewport');`);
      const id = element['element-6066-11e4-a52e-4f735466cecf'];
      const png = await api('/element/' + id + '/screenshot');
      await writeFile(screenshotPath, Buffer.from(png, 'base64'));
    }
    console.log('PASS proportional brew editor scaling, phone/landscape layouts, safe areas, filled height, pinned actions, label focus, and scroll fallback');
  } finally {
    await sync(`document.querySelector('#brew-editor-viewport')?.remove();`);
  }
}

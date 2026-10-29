import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function checkBeanManager({ sync, api, waitFor, screenshotPath }) {
  await api('/window/rect', { width: 1000, height: 1100 });
  await sync(`
    const form = document.querySelector('.bean-form');
    const toggle = document.querySelector('.add-bean-toggle');
    if (!form.hidden) toggle.click();
    toggle.click();
    document.querySelector('#bean-name').value = 'Unfinished bean';
    toggle.click();
  `);
  assert.equal(await sync(`return document.querySelector('.bean-form').hidden;`), true);
  assert.equal(await sync(`return document.querySelector('.add-bean-toggle').getAttribute('aria-expanded');`), 'false');
  await sync(`document.querySelector('.add-bean-toggle').click();`);
  assert.equal(await sync(`return document.querySelector('#bean-name').value;`), 'Unfinished bean');
  assert.equal(await sync(`return document.querySelector('.add-bean-toggle').getAttribute('aria-expanded');`), 'true');
  await sync(`const frame = document.createElement('iframe'); frame.id = 'bean-manager-viewport';
    frame.style.cssText = 'position:fixed;inset:0;width:393px;height:852px;border:0;z-index:1000;background:#0e1222';
    document.body.append(frame); const doc = frame.contentDocument;
    for (const style of document.querySelectorAll('style,link[rel="stylesheet"]')) doc.head.append(style.cloneNode(true));
    doc.body.append(document.querySelector('#app').cloneNode(true));`);
  try {
    await waitFor(`getComputedStyle(document.querySelector('#bean-manager-viewport').contentDocument.querySelector('.add-bean-toggle')).display === 'flex'`);
    for (const [width, height] of [[320, 568], [375, 667], [393, 759], [393, 852], [430, 932]]) {
      for (const safe of [false, true]) {
        const layout = await sync(`const frame = document.querySelector('#bean-manager-viewport');
          frame.style.width = '${width}px'; frame.style.height = '${height}px';
          const doc = frame.contentDocument;
          const header = doc.querySelector('.app-header'); header.style.paddingTop = '${(width <= 420 ? 8 : 18) + (safe ? 59 : 0)}px';
          doc.querySelector('.tab-bar').style.paddingBottom = '${safe ? 34 : 0}px';
          const preview = doc.querySelector('.photo-preview');
          preview.hidden = false; preview.src = doc.createElement('canvas').toDataURL();
          doc.querySelector('.remove-photo').hidden = false;
          doc.querySelector('.photo-status').textContent = 'WebP ready · 99.9 kB';
          const bounds = selector => { const r = doc.querySelector(selector).getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}; };
          return { horizontal: doc.querySelector('.app-content').scrollWidth > doc.querySelector('.app-content').clientWidth,
            toggle:bounds('.add-bean-toggle'), form:bounds('.bean-form'), submit:bounds('.bean-form button[type=submit]'),
            navigation:bounds('.tab-bar'), fields:[...doc.querySelectorAll('.bean-form input')].map(input=>({font:getComputedStyle(input).fontSize,height:input.getBoundingClientRect().height})) };
        `);
        assert.equal(layout.horizontal, false, JSON.stringify({width, height, safe, layout}));
        assert.ok(layout.fields.every(field => field.font === '16px' && field.height >= 44), JSON.stringify(layout));
        assert.ok(layout.submit.bottom - layout.submit.top >= 44);
        if (width === 393) {
          assert.ok(layout.toggle.top >= 0 && layout.form.bottom <= layout.navigation.top, JSON.stringify({width, height, safe, layout}));
        }
      }
    }
    if (screenshotPath) {
      await sync(`const frame=document.querySelector('#bean-manager-viewport');frame.style.width='393px';frame.style.height='852px';`);
      const element = await sync(`return document.querySelector('#bean-manager-viewport');`);
      const png = await api('/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/screenshot');
      await writeFile(screenshotPath, Buffer.from(png, 'base64'));
    }
    await sync(`const doc=document.querySelector('#bean-manager-viewport').contentDocument;
      doc.querySelector('.bean-form').hidden=true;
      const card=doc.querySelector('.bean-card');card.classList.add('is-expanded');card.querySelector('details').open=true;
      const history=card.querySelector('.bean-history');
      for(let i=0;i<40;i++){const row=doc.createElement('article');row.className='bean-session';row.textContent='Long history '+i;row.style.minHeight='120px';history.append(row);}`);
    for (const width of [320, 375, 393, 430]) {
      const layout = await sync(`const frame=document.querySelector('#bean-manager-viewport');frame.style.width='${width}px';frame.style.height='852px';
        const doc=frame.contentDocument;const card=doc.querySelector('.is-expanded');
        doc.querySelector('.app-header').style.paddingTop='${(width <= 420 ? 8 : 18) + 59}px';
        doc.querySelector('.tab-bar').style.paddingBottom='34px';
        // Equivalent bottom inset to env(safe-area-inset-bottom)=34px.
        card.style.bottom='calc(var(--tab-height) + 34px + 12px)';
        doc.querySelector('.app-content').scrollTop=0;
        const summary=card.querySelector('.bean-summary'),history=card.querySelector('.bean-history');
        const before=summary.getBoundingClientRect().top;history.scrollTop=history.scrollHeight;
        const result={before,after:summary.getBoundingClientRect().top,scrolled:history.scrollTop,
          contentTop:doc.querySelector('.app-content').getBoundingClientRect().top,
          lastBottom:history.lastElementChild.getBoundingClientRect().bottom,
          historyBottom:history.getBoundingClientRect().bottom,navTop:doc.querySelector('.tab-bar').getBoundingClientRect().top,
          horizontal:history.scrollWidth>history.clientWidth || doc.querySelector('.app-content').scrollWidth>doc.querySelector('.app-content').clientWidth};
        history.scrollTop=0;result.backAtTop=history.scrollTop===0;return result;`);
      assert.equal(layout.horizontal, false, JSON.stringify({width, layout}));
      assert.equal(layout.before, layout.after);
      assert.equal(layout.before, layout.contentTop + 13); // 12px inset + card border.
      assert.ok(layout.scrolled > 1000 && layout.backAtTop, JSON.stringify(layout));
      assert.ok(layout.lastBottom <= layout.historyBottom && layout.historyBottom < layout.navTop, JSON.stringify(layout));
    }
  } finally { await sync(`document.querySelector('#bean-manager-viewport')?.remove();`); }

  await sync(`document.querySelector('#bean-name').value=''; document.querySelector('.add-bean-toggle').click();
    const spacer=document.createElement('div');spacer.id='bean-test-spacer';spacer.style.height='800px';
    document.querySelector('.bean-list').prepend(spacer);
    const history=document.querySelector('.bean-history');
    const fixture=document.createElement('div');fixture.id='bean-test-history';
    for(let i=0;i<40;i++){const row=document.createElement('article');row.className='bean-session';row.textContent='History fixture '+i;row.style.minHeight='120px';fixture.append(row);}
    const photo=document.createElement('img');photo.className='bean-photo';photo.alt='History fixture photo';photo.src=document.createElement('canvas').toDataURL();fixture.prepend(photo);
    history.append(fixture);document.querySelector('.app-content').scrollTop=600;
    window.__beanListScroll=document.querySelector('.app-content').scrollTop;
    document.querySelector('.bean-summary').click();`);
  try {
    assert.equal(await sync(`return document.querySelector('.bean-card details').open;`), true);
    const positions = await sync(`const card=document.querySelector('.is-expanded');
      const history=card.querySelector('.bean-history');const summary=card.querySelector('.bean-summary');
      const top=summary.getBoundingClientRect().top;
      history.scrollTop=history.scrollHeight;
      const last=history.lastElementChild.lastElementChild.getBoundingClientRect();
      const result={top,after:summary.getBoundingClientRect().top,scrolled:history.scrollTop,
        lastBottom:last.bottom,historyBottom:history.getBoundingClientRect().bottom,
        navTop:document.querySelector('.tab-bar').getBoundingClientRect().top};
      history.scrollTop=120; result.up=history.scrollTop;return result;`);
    assert.equal(positions.top, positions.after);
    assert.ok(positions.scrolled > positions.up && positions.up === 120, JSON.stringify(positions));
    assert.ok(positions.lastBottom <= positions.historyBottom && positions.historyBottom < positions.navTop, JSON.stringify(positions));
    // Action taps must not dismiss the pinned inspection.
    await sync(`document.querySelector('.is-expanded .bean-actions').click();`);
    assert.equal(await sync(`return document.querySelector('.bean-card details').open;`), true);
    await sync(`document.querySelector('.is-expanded .bean-actions').click();`);
    for (const target of ['#bean-test-history .bean-session', '.bean-summary', '#bean-test-history .bean-photo', '.bean-history']) {
      if (!await sync(`return document.querySelector('.bean-card details').open;`)) await sync(`document.querySelector('.bean-summary').click();`);
      await sync(`document.querySelector(${JSON.stringify(target)}).click();`);
      assert.equal(await sync(`return document.querySelector('.bean-card details').open;`), false, target);
      assert.equal(await sync(`return document.querySelector('.app-content').scrollTop === window.__beanListScroll;`), true, 'Restore collection position');
    }
    await sync(`document.querySelector('.bean-summary').click();
      document.querySelector('.bean-summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    assert.equal(await sync(`return document.querySelector('.bean-card details').open;`), false);
    assert.equal(await sync(`return document.activeElement.className;`), 'bean-summary');
  } finally {
    await sync(`document.querySelector('#bean-test-history')?.remove();document.querySelector('#bean-test-spacer')?.remove();delete window.__beanListScroll;`);
  }
  console.log('PASS compact bean form/draft toggle, photo-inclusive phone fit, pinned scrollable histories, action taps, tap-anywhere/Escape collapse and collection scroll restoration');
}

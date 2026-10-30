import assert from 'node:assert/strict';

export async function checkSwipeRows({sync, evaluate, waitFor, api, showWindow}) {
  if (api && !process.env.TEST_FIREFOX) {
    // Hidden Safari windows pause CSS transitions. OS focus is independent of
    // WebDriver's selected context; actual trusted-event delivery is checked below.
    await showWindow();
  }
  if(process.env.TEST_REDUCED_MOTION) assert.equal(await sync(`return matchMedia('(prefers-reduced-motion: reduce)').matches;`),true,'isolated browser honors reduced-motion preference');
  const before=await evaluate(`const db=await getDB();return {beans:await db.getBeans(),sessions:await db.getBrewSessions(),csv:(await db.exportData('csv',false)).map(f=>Array.from(f.data))};`);
  for(const kind of ['bean','session']) {
    const bean=kind==='bean', id=bean?before.beans[0].id:before.sessions[0].id;
    const selector=bean?'.bean-card[data-bean-id="'+id+'"]':'.session-card[data-session-id="'+id+'"]';
    const surface=selector+(bean?' .bean-surface':' .session-surface');
    const summary=selector+(bean?' .bean-summary':' .session-summary');
    const menu=selector+(bean?' .bean-actions':' .session-menu');
    await sync(`document.querySelector('#tab-${bean?'bean-manager':'brew-controller'}').click();`);
    await waitFor(`document.querySelector('.${bean?'bean':'session'}-list').getAttribute('aria-busy')==='false'`);
    const event=(type,x=0,y=0,extra='')=>sync(`document.querySelector('${surface}').dispatchEvent(new PointerEvent('${type}',{pointerId:71,pointerType:'touch',isPrimary:true,button:0,clientX:200+${x},clientY:200+${y},bubbles:true,cancelable:true,${extra}}));`);
    // Test the scroll veto itself; synthetic pointer events cannot start native
    // scrolling and therefore cannot reveal a missing touchmove preventDefault.
    const touchMove=(x,y,count=1,cancelable=true)=>sync(`const event=new Event('touchmove',{bubbles:true,cancelable:${cancelable}});
      Object.defineProperty(event,'touches',{value:Array.from({length:${count}},(_,identifier)=>({identifier,clientX:200+${x},clientY:200+${y}}))});
      document.querySelector('${surface}').dispatchEvent(event);return event.defaultPrevented;`);
    const state=()=>sync(`const s=document.querySelector('${surface}'),r=document.querySelector('${selector}');return {
      x:new DOMMatrixReadOnly(getComputedStyle(s).transform).m41,pressed:s.classList.contains('is-pressed'),dragging:s.classList.contains('is-swiping'),
      duration:getComputedStyle(s).transitionDuration,inline:s.style.transform,remove:r.querySelector('.${bean?'bean':'session'}-delete').hidden,
      inert:r.querySelector('.${bean?'bean':'session'}-delete').inert,open:r.classList.contains('delete-revealed')};`);
    const settled=x=>waitFor(`Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('${surface}')).transform).m41-(${x}))<0.1`);
    await event('pointerdown');assert.equal((await state()).pressed,true,kind+' immediate contact feedback');
    await event('pointermove',-8,1);
    assert.equal(await touchMove(-8,1),true,kind+' pointermove-first horizontal swipe blocks native scroll');
    let s=await state();assert.equal(s.x,-8,kind+' moves before release at 8px');
    assert.deepEqual([s.dragging,s.remove,s.inert,s.duration],[true,false,true,'0s']);
    await event('pointermove',-32,1);assert.equal((await state()).x,-32,kind+' follows finger without easing');
    assert.equal(await sync(`return !document.querySelector('${surface}').dispatchEvent(new Event('dragstart',{bubbles:true,cancelable:true}));`),true,'native image drag is prevented');
    assert.equal((await state()).dragging,true,'native drag attempt does not interrupt finger tracking');
    await sync(`document.querySelector('${summary}').dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:71,bubbles:true}));`);
    assert.equal((await state()).dragging,true,'child capture handoff must not cancel the surface drag');
    await event('pointermove',-60,1);assert.equal((await state()).x,-60);
    await event('pointerup',-60,1);await settled(-96);
    s=await state();assert.deepEqual([s.open,s.inert,s.dragging,s.inline],[true,false,false,'']);
    if(process.env.TEST_REDUCED_MOTION) assert.equal(s.duration,'0s','reduced-motion settling has no animation');
    await sync(`document.querySelector('${summary}').click();`);
    assert.equal((await state()).open,true,'post-swipe click must not dismiss action or activate row');
    assert.equal(await sync(`return ${bean?`document.querySelector('${selector} details').open`:`!document.querySelector('.session-form').hidden`};`),false);

    await event('pointerdown');await event('pointermove',25,1);
    assert.equal((await state()).x,-71,'an open row tracks reverse movement before release');
    await event('pointerup',25,1);await settled(-96);assert.equal((await state()).open,true,'short reverse drag restores prior state');
    await event('pointerdown');await event('pointermove',200,1);
    assert.equal((await state()).x,0,'reverse drag stops at closed instead of exposing the opposite action');
    if(bean) assert.equal(await sync(`return document.querySelector('${selector} .bean-edit').hidden;`),true);
    await event('pointerup',200,1);await settled(0);
    assert.equal((await state()).remove,true,'reverse drag closes without switching actions');
    for(const direction of (bean?[-1,1]:[-1])) {
      await event('pointerdown');
      assert.equal(await touchMove(direction*2,1),false,'small undecided movement does not block scrolling');
      // Exercise touchmove-first ordering as well as drift after pointer capture.
      assert.equal(await touchMove(direction*8,1),true,kind+' horizontal intent blocks native scroll before pointermove');
      await event('pointermove',direction*32,60);
      assert.equal((await state()).x,direction*32,kind+' locked swipe ignores dominant vertical drift');
      assert.equal(await touchMove(direction*32,60),true,kind+' vertical drift cannot hand swipe to native scroll');
      assert.equal(await touchMove(direction*32,60,1,false),false,'non-cancelable touchmove is tolerated');
      await event('pointermove',direction*60,-80);
      assert.equal((await state()).x,direction*60,kind+' locked swipe follows horizontal movement through opposite vertical drift');
      await event('pointerup',direction*60,-80);await settled(direction*96);
      assert.equal(await touchMove(direction*60,-80),false,'scroll guard ends on release');
      await sync(`document.querySelector('${menu}').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);await settled(0);
    }
    await event('pointerdown');
    assert.equal(await touchMove(2,12),false,'vertical touch start stays native');
    await event('pointermove',-70,15);await event('pointerup',-70,15);
    assert.equal((await state()).dragging,false,'vertical touch start cannot become a horizontal swipe');
    await event('pointerdown');await event('pointermove',-32,1);
    assert.equal(await touchMove(-32,1,2),false,'second touch releases scroll guard for pinch zoom');await settled(0);
    assert.equal((await state()).dragging,false,'multitouch ends horizontal lock');
    for(const cancel of ['pointercancel','lostpointercapture']) {
      await event('pointerdown');await event('pointermove',-60,1);await event(cancel,-60,1);await settled(0);
      assert.equal(await touchMove(-60,30),false,'scroll guard ends on '+cancel);
      s=await state();assert.deepEqual([s.open,s.remove,s.inert,s.dragging,s.pressed,s.inline],[false,true,false,false,false,''],kind+' '+cancel+' restores clean state');
    }
    for (const interruption of ['outside-up', 'outside-cancel', 'blur', 'pagehide', 'hidden']) {
      await event('pointerdown');
      await sync(`
        if ('${interruption}'.startsWith('outside')) document.body.dispatchEvent(new PointerEvent('${interruption}'==='outside-up'?'pointerup':'pointercancel',{pointerId:71,bubbles:true}));
        else if ('${interruption}'==='hidden') {
          const descriptor=Object.getOwnPropertyDescriptor(document,'hidden');
          try {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}
          finally {if(descriptor)Object.defineProperty(document,'hidden',descriptor);else delete document.hidden;}
        } else window.dispatchEvent(new Event('${interruption}'));
      `);
      assert.equal((await state()).pressed,false,kind+' cleans up '+interruption);
      await event('pointerdown');assert.equal((await state()).pressed,true,kind+' next contact after '+interruption);
      await event('pointermove',-60,1);assert.equal((await state()).x,-60,kind+' next swipe after '+interruption);
      await event('pointercancel');await settled(0);
    }
    await event('pointerdown');await event('pointermove',-20,1);
    await event('pointerdown',-20,1,'pointerId:72,isPrimary:false');await settled(0);
    assert.equal((await state()).dragging,false,'second touch cancels row movement for pinch zoom');
    await event('pointerdown');await event('pointermove',2,12);await event('pointermove',-70,15);await event('pointerup',-70,15);
    s=await state();assert.deepEqual([s.open,s.dragging,s.pressed,s.inline],[false,false,false,''],'vertical intent remains scrolling even after diagonal motion');
    assert.equal(await sync(`return getComputedStyle(document.querySelector('${surface}')).touchAction;`),'pan-y pinch-zoom');
    await event('pointerdown');await event('pointermove',-25,1);await event('pointerup',-25,1);await settled(0);
    assert.equal((await state()).remove,true,'short horizontal drag snaps closed');
    await event('pointerdown');await event('pointermove',500,1);
    const right=await state();assert.ok(right.x<=(bean?112:16),'bounded overscroll');
    if(bean) assert.equal(await sync(`return document.querySelector('${selector} .bean-edit').inert;`),true);
    await event('pointercancel',500,1);await settled(0);

    await sync(`document.querySelector('${menu}').click();`);
    await event('pointerdown');await event('pointermove',-20,1);await event('pointercancel',-20,1);
    assert.equal(await sync(`return document.querySelector('${menu}').getAttribute('aria-expanded');`),'true','cancel restores menu');
    if(bean) assert.equal(await sync(`return document.querySelector('${selector}').classList.contains('actions-revealed');`),true);
    await sync(`document.querySelector('${menu}').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);await settled(0);
    await event('pointerdown');await event('pointerup');await sync(`document.querySelector('${summary}').click();`);
    assert.equal(await sync(`return ${bean?`document.querySelector('${selector} details').open`:`!document.querySelector('.session-form').hidden`};`),true,'fresh tap retains normal expand/edit behavior');
    if(bean) {
      await waitFor(`document.querySelector('${selector} .history-status')?.textContent !== 'Loading brew history…'`);
      await sync(`const text=document.querySelector('${selector} .bean-history');const range=document.createRange();range.selectNodeContents(text);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);`);
      await event('pointerdown');assert.equal((await state()).pressed,false,'existing text selection remains selectable');await event('pointerup');
      await sync(`getSelection().removeAllRanges();document.querySelector('${summary}').click();`);
    } else {
      await waitFor(`document.querySelector('.session-form').getAttribute('aria-busy')==='false'`);
      await sync(`document.querySelector('.cancel-session').click();`);
    }

    if(!process.env.TEST_FIREFOX) {
      await api('/actions',undefined,'DELETE');
      // Select the owned context before input; contact() checks actual delivery
      // rather than requiring the OS to give Safari foreground focus.
      await showWindow();
      const point=await sync(`window.__swipeTrace=[];window.__swipeContacts=[];window.__swipeTraceController=new AbortController();for(const type of ['pointerdown','pointerup','pointercancel','pointermove','mousedown','mouseup'])document.addEventListener(type,event=>{if(event.isTrusted&&window.__swipeTrace.length<100)window.__swipeTrace.push({type:event.type,target:event.target.className,primary:event.isPrimary,button:event.button,buttons:event.buttons,x:event.clientX,y:event.clientY,selection:getSelection()?.toString()});},{capture:true,signal:window.__swipeTraceController.signal});document.addEventListener('pointerdown',event=>{if(event.isTrusted)window.__swipeContacts.push({pressed:document.querySelector('${surface}').classList.contains('is-pressed'),target:event.target.className});},{signal:window.__swipeTraceController.signal});const row=document.querySelector('${summary}');row.scrollIntoView({block:'center'});const r=row.getBoundingClientRect(),edge=document.querySelector('${surface}').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),edgeY:Math.floor(edge.bottom-1),outsideY:Math.ceil(edge.bottom+3)};`);
      const actions=steps=>api('/actions',{actions:[{type:'pointer',id:'row-drag',parameters:{pointerType:'mouse'},actions:steps}]});
      // Wait only for native event delivery, then inspect the state sampled
      // synchronously during bubbling. Never retry the gesture or poll feedback.
      const contact=async()=>{
        const previous=await sync('return window.__swipeContacts.length;');
        await actions([{type:'pointerDown',button:0}]);
        for(let i=0;i<20;i++) {
          if(await sync(`return window.__swipeContacts.length>${previous};`)) break;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        const received=await sync(`return {contact:window.__swipeContacts[${previous}],trace:window.__swipeTrace,focus:document.hasFocus()};`);
        assert.ok(received.contact,'Safari native pointerdown was not delivered '+kind+' '+JSON.stringify(received));
        assert.equal(received.contact.pressed,true,'trusted pointer must set pressed during dispatch '+kind+' '+JSON.stringify(received));
        assert.equal((await state()).pressed,true,'trusted contact remains pressed '+kind+' '+JSON.stringify(received));
      };
      try {
        await actions([{type:'pointerMove',origin:'viewport',x:point.x,y:point.edgeY,duration:0}]);
        await contact();
        await actions([{type:'pointerMove',origin:'viewport',x:point.x,y:point.outsideY,duration:0},{type:'pointerUp',button:0}]);
        assert.equal((await state()).pressed,false,'trusted off-row release clears contact '+kind);
        await actions([{type:'pointerMove',origin:'viewport',x:point.x,y:point.y,duration:0}]);
        await contact();
        await actions([{type:'pointerMove',origin:'viewport',x:point.x-60,y:point.y+12,duration:120}]);
        assert.equal((await state()).dragging,true,'trusted pointer captured across move');
        assert.ok(Math.abs((await state()).x+60)<1,'trusted pointer tracks 60px before release');
        await actions([{type:'pointerMove',origin:'viewport',x:point.x-60,y:point.y-70,duration:120}]);
        assert.equal((await state()).dragging,true,'trusted horizontal capture survives vertical movement');
        assert.ok(Math.abs((await state()).x+60)<1,'trusted vertical drift preserves horizontal offset');
        await actions([{type:'pointerUp',button:0}]);await settled(-96);
        assert.equal((await state()).open,true,'trusted release reveals action');
      } finally { await api('/actions',undefined,'DELETE');await sync(`window.__swipeTraceController.abort();delete window.__swipeTraceController;delete window.__swipeTrace;delete window.__swipeContacts;`); }
      await sync(`document.querySelector('${menu}').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);await settled(0);
    }
  }
  const after=await evaluate(`const db=await getDB();return {beans:await db.getBeans(),sessions:await db.getBrewSessions(),csv:(await db.exportData('csv',false)).map(f=>Array.from(f.data))};`);
  assert.deepEqual(after,before,'touch feedback, preview, cancellation and tap/keyboard controls preserve exact records and CSV bytes');
  console.log('PASS live bean/session swipe positions before release, immediate press, inert preview, reverse/short/cancel/multitouch/scroll, menu/keyboard/taps, selection and exact data'+(process.env.TEST_FIREFOX?'':' including trusted Safari pointer capture'));
}

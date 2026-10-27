/** Keep the editor's geometry while native input UI covers part of the screen. */
export function stabilizeEditorViewport(form: HTMLFormElement): { reset: () => void } {
  const body = form.querySelector<HTMLElement>('.session-body')!;
  const chart = form.querySelector<HTMLElement>('.brewing-chart')!;
  const actions = form.querySelector<HTMLElement>('.session-actions')!;
  const viewport = window.visualViewport;
  let locked: { width: number; visibleHeight: number; height: number; scale: number } | null = null;
  const previous = new Map<string, string>();
  const editing = () => form.contains(document.activeElement)
    && document.activeElement?.matches('input, select, textarea');

  function set(name: string, value: string): void {
    if (!previous.has(name)) previous.set(name, form.style.getPropertyValue(name));
    form.style.setProperty(name, value);
  }

  function reset(): void {
    locked = null;
    delete form.dataset.typing;
    for (const [name, value] of previous) {
      if (value) form.style.setProperty(name, value);
      else form.style.removeProperty(name);
    }
    previous.clear();
  }

  function lock(): void {
    if (locked || !form.getClientRects().length) return;
    const scale = new DOMMatrix(getComputedStyle(form).transform).a;
    const height = form.getBoundingClientRect().height;
    locked = { width: window.innerWidth, visibleHeight: viewport?.height ?? window.innerHeight, height, scale };
    // Capture before the keyboard changes viewport units or safe-area insets.
    set('--editor-viewport-height', `${height}px`);
    set('--editor-scale', String(scale));
    set('--editor-safe-top', `${Math.max(0, (parseFloat(getComputedStyle(body).paddingTop) - 12) * scale)}px`);
    set('--editor-safe-bottom', `${Math.max(0, (parseFloat(getComputedStyle(actions).paddingBottom) - 12) * scale)}px`);
    set('--editor-chart-height', `${chart.getBoundingClientRect().height / scale}px`);
    form.dataset.typing = '';
  }

  function update(): void {
    if (!locked) return;
    // Rotation/window-width changes still get a fresh responsive layout.
    if (window.innerWidth !== locked.width) {
      reset();
      if (editing()) lock();
    }
    if (!locked) return;
    const visibleHeight = viewport?.height ?? window.innerHeight;
    if (!editing() && visibleHeight >= locked.visibleHeight - 1) {
      reset();
      return;
    }
    // Extra scroll room reveals covered fields without shrinking the graph.
    const covered = viewport && viewport.scale === 1
      ? Math.max(0, locked.height - viewport.height - viewport.offsetTop) : 0;
    set('--editor-keyboard-space', `${covered / locked.scale}px`);
  }

  form.addEventListener('focusin', () => { if (editing()) { lock(); update(); } });
  // Wait until focus has moved; keep the lock through keyboard dismissal.
  form.addEventListener('focusout', () => requestAnimationFrame(update));
  window.addEventListener('resize', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  return { reset };
}

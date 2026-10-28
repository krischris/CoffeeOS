const actionWidth = 96;

/** Track the finger directly; leave vertical scrolling and zoom to the browser. */
export function attachSwipeRow(surface: HTMLElement, options: {
  disabled: () => boolean;
  ignore: (target: Element) => boolean;
  position: () => -1 | 0 | 1;
  allowsRight: boolean;
  preview: (offset: number) => void;
  settle: (direction: 'left' | 'right' | null) => void;
}): void {
  let gesture: { id: number; x: number; y: number; origin: number; position: number; horizontal: boolean } | null = null;
  let suppressClick = false;
  let contactListeners: AbortController | null = null;

  function finish(direction: 'left' | 'right' | null, cancelled = false): void {
    const previous = gesture;
    gesture = null;
    contactListeners?.abort();
    contactListeners = null;
    surface.classList.remove('is-pressed', 'is-swiping');
    if (previous?.horizontal) {
      options.settle(direction);
      surface.style.removeProperty('transform');
    }
    if (cancelled) suppressClick = false;
    if (previous && surface.hasPointerCapture(previous.id)) surface.releasePointerCapture(previous.id);
  }

  surface.addEventListener('pointerdown', event => {
    if (gesture) {
      const samePointer = gesture.id === event.pointerId;
      finish(null, true);
      if (!samePointer) return; // A second contact belongs to pinch zoom.
    }
    suppressClick = false;
    if (!event.isPrimary || event.button !== 0 || options.disabled() || options.ignore(event.target as Element) || window.getSelection()?.toString()) return;
    const position = options.position();
    // Read once on contact so grabbing a row during its settling animation does
    // not jump to the animation's endpoint. Moves only write compositor transforms.
    const transform = getComputedStyle(surface).transform;
    const origin = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, origin, position, horizontal: false };
    surface.classList.add('is-pressed');
    // Before horizontal capture, a mouse release can land outside the surface.
    // Scope document/window listeners to this contact; never retain detached rows.
    contactListeners = new AbortController();
    const listeners = { capture: true, signal: contactListeners.signal };
    const cancelOutside = (outside: PointerEvent) => {
      if (gesture?.id === outside.pointerId && !surface.contains(outside.target as Node)) finish(null, true);
    };
    document.addEventListener('pointerup', cancelOutside, listeners);
    document.addEventListener('pointercancel', () => finish(null, true), listeners);
    document.addEventListener('pointerdown', next => {
      if (gesture && next.pointerId !== gesture.id && !surface.contains(next.target as Node)) finish(null, true);
    }, listeners);
    // Captured element blur during normal focus transfer is not window blur.
    window.addEventListener('blur', event => { if (event.target === window) finish(null, true); }, listeners);
    window.addEventListener('pagehide', () => finish(null, true), listeners);
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(null, true); }, listeners);
  });
  surface.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(dy) >= 5 && Math.abs(dy) >= Math.abs(dx)) { finish(null); return; }
      if (Math.abs(dx) < 5 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      gesture.horizontal = true; suppressClick = true;
      surface.classList.remove('is-pressed');
      surface.classList.add('is-swiping');
      if (event.isTrusted && !surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const min = gesture.position > 0 ? 0 : -actionWidth;
    const max = gesture.position < 0 || !options.allowsRight ? 0 : actionWidth;
    const offset = gesture.origin + dx;
    // A little resistance at the ends, without allowing one swipe to cross from
    // an already open action to the opposite action.
    const constrained = Math.max(min, Math.min(max, offset));
    const crossingClosed = gesture.position > 0 && offset < 0 || gesture.position < 0 && offset > 0;
    const resisted = constrained + (crossingClosed ? 0 : Math.max(-16, Math.min(16, (offset - constrained) / 4)));
    options.preview(resisted);
    surface.style.transform = `translate3d(${resisted}px, 0, 0)`;
  }, { passive: false });
  surface.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    finish(gesture.horizontal && Math.abs(dx) >= 40 ? (dx < 0 ? 'left' : 'right') : null);
  });
  const cancel = (event: PointerEvent) => { if (gesture?.id === event.pointerId) finish(null, true); };
  surface.addEventListener('pointercancel', cancel);
  // Implicit touch capture can move from a child summary to this surface. Its
  // bubbling loss is not a loss of the surface's newly acquired capture.
  surface.addEventListener('lostpointercapture', event => { if (event.target === surface) cancel(event); });
  surface.addEventListener('dragstart', event => { if (gesture) event.preventDefault(); });
  surface.addEventListener('keydown', () => { if (gesture) finish(null, true); suppressClick = false; });
  surface.addEventListener('click', event => {
    if (suppressClick && !options.ignore(event.target as Element)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
    suppressClick = false;
  }, true);
}

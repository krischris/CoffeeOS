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
  let gesture: { id: number; type: string; x: number; y: number; origin: number; position: number; horizontal: boolean } | null = null;
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

  function horizontalIntent(x: number, y: number): boolean {
    if (!gesture) return false;
    if (gesture.horizontal) return true;
    const dx = Math.abs(x - gesture.x), dy = Math.abs(y - gesture.y);
    if (dy >= 5 && dy >= dx) { finish(null); return false; }
    if (dx < 5 || dx < dy * 1.15) return false;
    gesture.horizontal = true;
    suppressClick = true;
    surface.classList.remove('is-pressed');
    surface.classList.add('is-swiping');
    return true;
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
    gesture = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, origin, position, horizontal: false };
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
  // Cancelling pointermove does not suppress native touch scrolling. Keep this
  // non-passive listener on the surface so vertical drift cannot hand an active
  // horizontal swipe back to Safari's scroller. Decide intent here too: browsers
  // can deliver touchmove before pointermove. Vertical starts and pinch stay native.
  surface.addEventListener('touchmove', event => {
    if (!gesture || gesture.type !== 'touch') return;
    if (event.touches.length !== 1) { finish(null, true); return; }
    const touch = event.touches[0]!;
    if (horizontalIntent(touch.clientX, touch.clientY) && event.cancelable) event.preventDefault();
  }, { passive: false });
  surface.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!horizontalIntent(event.clientX, event.clientY) || !gesture) return;
    const dx = event.clientX - gesture.x;
    if (event.isTrusted && !surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId);
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

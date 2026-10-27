import { CommittedWriteError, addBean, updateBean, deleteBean, getBeans, getBrewSessions } from '../db';
import { compressBeanPhoto, isBeanPhoto } from '../photos';
import type { Bean, BrewSession } from '../types';
import { renderSessionMetrics } from './sessionMetrics';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

function renderSession(session: BrewSession): HTMLElement {
  const card = document.createElement('article');
  card.className = 'bean-session';
  card.dataset.sessionId = session.id;
  const heading = document.createElement('h4');
  const time = textElement('time', dateTimeFormatter.format(new Date(session.brewed_at)));
  time.dateTime = session.brewed_at;
  heading.append(time);
  card.append(heading, renderSessionMetrics(session));
  return card;
}

function renderBean(bean: Bean, sessions: BrewSession[], onEdit: () => void, onDelete: () => Promise<void>): HTMLElement {
  const card = document.createElement('article');
  card.className = 'bean-card';
  card.dataset.beanId = bean.id;
  const surface = document.createElement('div');
  surface.className = 'bean-surface';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.className = 'bean-summary';
  summary.append(textElement('h3', bean.name));
  const dates = document.createElement('dl');
  dates.className = 'bean-dates';
  const beanDates: [string, string | null][] = [['Roast date', bean.roast_date], ['Freeze date', bean.freeze_date]];
  for (const [label, date] of beanDates) {
    if (!date) continue;
    const field = document.createElement('div');
    const value = document.createElement('dd');
    const time = textElement('time', dateFormatter.format(new Date(`${date}T00:00:00`)));
    time.dateTime = date;
    value.append(time);
    field.append(textElement('dt', label), value);
    dates.append(field);
  }
  if (dates.childElementCount) summary.append(dates);
  summary.append(textElement('p', `${sessions.length} brew ${sessions.length === 1 ? 'session' : 'sessions'}`, 'session-count'));
  summary.append(textElement('span', 'Tap anywhere to close', 'bean-close-hint'));
  details.append(summary);
  const history = document.createElement('div');
  history.className = 'bean-history';
  history.tabIndex = 0;
  history.setAttribute('role', 'region');
  history.setAttribute('aria-label', `Brew sessions for ${bean.name}`);
  if (bean.photo_jpeg && isBeanPhoto(bean.photo_jpeg)) {
    const photo = document.createElement('img');
    photo.className = 'bean-photo';
    photo.src = bean.photo_jpeg;
    photo.alt = `Photo of ${bean.name}`;
    photo.loading = 'lazy';
    history.append(photo);
  }
  if (sessions.length) history.append(...sessions.map(renderSession));
  else history.append(textElement('p', 'No brew sessions yet', 'bean-empty'));
  details.append(history);
  const actions = textElement('button', '•••', 'bean-actions');
  actions.type = 'button';
  actions.setAttribute('aria-label', `Actions for ${bean.name}`);
  actions.setAttribute('aria-expanded', 'false');
  const edit = textElement('button', 'Edit', 'bean-edit');
  edit.type = 'button';
  edit.setAttribute('aria-label', `Edit ${bean.name}`);
  edit.hidden = true;
  const remove = textElement('button', 'Delete', 'bean-delete');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Delete ${bean.name} and all ${sessions.length} brew sessions`);
  remove.hidden = true;
  const failure = textElement('p', '', 'form-error');
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  let deleting = false;
  let revealed: 'edit' | 'delete' | 'menu' | null = null;
  function reveal(action: typeof revealed): void {
    if (deleting) return;
    revealed = action;
    card.classList.toggle('edit-revealed', action === 'edit');
    card.classList.toggle('delete-revealed', action === 'delete');
    card.classList.toggle('actions-revealed', action === 'menu');
    edit.hidden = action !== 'edit' && action !== 'menu';
    remove.hidden = action !== 'delete' && action !== 'menu';
    actions.setAttribute('aria-expanded', String(action !== null));
  }
  actions.addEventListener('click', () => {
    reveal(revealed === 'menu' ? null : 'menu');
    if (!edit.hidden) edit.focus();
  });
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape') { reveal(null); if (!details.open) actions.focus(); }
  });
  let gesture: { id: number; x: number; y: number; horizontal: boolean } | null = null;
  let suppressClick = false;
  surface.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return;
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
  });
  surface.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.horizontal && Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { gesture = null; return; }
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      gesture.horizontal = true;
      suppressClick = true;
      if (surface.hasPointerCapture(event.pointerId) === false && event.isTrusted) surface.setPointerCapture(event.pointerId);
    }
  });
  surface.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    if (gesture.horizontal && Math.abs(dx) >= 40) {
      const action = dx < 0 ? 'delete' : 'edit';
      reveal(revealed !== null && revealed !== action ? null : action);
    }
    gesture = null;
  });
  surface.addEventListener('pointercancel', () => { gesture = null; suppressClick = false; });
  surface.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; return; }
    if (revealed !== null && !(event.target as Element).closest('button')) {
      event.preventDefault();
      event.stopPropagation();
      reveal(null);
    }
  }, true);
  let listScrollTop = 0;
  function setExpanded(open: boolean): void {
    const content = card.closest<HTMLElement>('.app-content');
    if (open) listScrollTop = content?.scrollTop ?? 0;
    details.open = open;
    card.classList.toggle('is-expanded', open);
    if (content) content.scrollTop = open ? 0 : listScrollTop;
    if (open) history.scrollTop = 0;
    else summary.focus({ preventScroll: true });
  }
  surface.addEventListener('click', event => {
    if (event.defaultPrevented || (event.target as Element).closest('button, a, input, select, textarea')) return;
    // A scroll gesture is handled by the browser; text selection should also
    // remain possible without dismissing a long history.
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
    setExpanded(!details.open);
  });
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape' && details.open) {
      event.preventDefault();
      setExpanded(false);
    }
  });
  edit.addEventListener('click', () => {
    if (deleting) return;
    reveal(null);
    if (details.open) setExpanded(false);
    onEdit();
  });
  remove.addEventListener('click', () => {
    if (deleting) return;
    deleting = true;
    remove.disabled = true;
    edit.disabled = true;
    actions.disabled = true;
    remove.textContent = 'Deleting…';
    failure.hidden = true;
    void onDelete().catch(error => {
      failure.textContent = error instanceof CommittedWriteError
        ? 'Deletion was applied, but storage could not be confirmed. Export a backup from IO before closing this tab.'
        : 'Could not delete this bean. Your data was preserved; please try again.';
      failure.hidden = false;
    }).finally(() => {
      deleting = false;
      remove.disabled = false;
      edit.disabled = false;
      actions.disabled = false;
      remove.textContent = 'Delete';
    });
  });
  summary.append(actions);
  surface.append(details, failure);
  card.append(edit, remove, surface);
  return card;
}

/** Mount once; refresh on tab entry so newly saved sessions are reflected here. */
export function createBeanManager(container: HTMLElement): { refresh: () => Promise<void>; openForm: () => void } {
  container.innerHTML = `
    <button id="add-bean-toggle" class="secondary-button add-bean-toggle" type="button" aria-expanded="false" aria-controls="add-bean-form">Add a bean <span aria-hidden="true">＋</span></button>
    <form id="add-bean-form" class="bean-form card" aria-labelledby="add-bean-toggle" hidden>
      <fieldset>
        <label for="bean-name">Name <span class="field-hint">(required)</span></label>
        <input id="bean-name" name="name" type="text" required placeholder="e.g. Ethiopia · Yirgacheffe">
        <div class="date-fields">
          <div><label for="bean-roast-date">Roast date <span class="field-hint">(optional)</span></label>
            <input id="bean-roast-date" name="roast_date" type="date"></div>
          <div><label for="bean-freeze-date">Freeze date <span class="field-hint">(optional)</span></label>
            <input id="bean-freeze-date" name="freeze_date" type="date"></div>
        </div>
        <label for="bean-photo">Photo <span class="field-hint">(optional)</span></label>
        <input id="bean-photo" type="file" accept="image/*">
        <p class="field-hint photo-hint">Camera or library · saved as JPEG</p>
        <div class="bean-photo-selection">
          <img class="bean-photo photo-preview" alt="Selected bean photo" hidden>
          <button class="secondary-button remove-photo" type="button" hidden>Remove photo</button>
        </div>
        <p class="photo-status" role="status"></p>
        <div class="bean-form-actions">
          <button class="secondary-button cancel-bean" type="button" hidden>Cancel</button>
          <button class="primary-button" type="submit">Add Bean</button>
        </div>
      </fieldset>
      <p class="form-message" role="status" aria-live="polite"></p>
      <p class="form-error" role="alert" hidden></p>
    </form>
    <section class="bean-collection" aria-labelledby="bean-list-heading">
      <h2 id="bean-list-heading">Your beans <span class="bean-count"></span></h2>
      <div class="list-error" role="alert" hidden>
        <p>Your beans could not be loaded. Please try again.</p>
        <button class="secondary-button" type="button">Try again</button>
      </div>
      <p class="list-status" role="status"></p>
      <div class="bean-list"></div>
    </section>`;

  const form = container.querySelector<HTMLFormElement>('form')!;
  const toggle = container.querySelector<HTMLButtonElement>('.add-bean-toggle')!;
  function setFormOpen(open: boolean): void {
    form.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('span')!.textContent = open ? '−' : '＋';
    if (open) {
      const content = container.closest<HTMLElement>('.app-content');
      if (content) content.scrollTop = 0;
    }
  }
  function openForm(): void {
    if (saving) return;
    if (editing) resetEditor();
    setFormOpen(true);
    name.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => setFormOpen(form.hidden === true));
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !saving) {
      if (editing) resetEditor();
      setFormOpen(false);
      toggle.focus({ preventScroll: true });
    }
  });
  const fieldset = form.querySelector('fieldset')!;
  const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
  const roastDate = form.querySelector<HTMLInputElement>('[name="roast_date"]')!;
  const freezeDate = form.querySelector<HTMLInputElement>('[name="freeze_date"]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const cancel = form.querySelector<HTMLButtonElement>('.cancel-bean')!;
  const message = form.querySelector<HTMLElement>('.form-message')!;
  const error = form.querySelector<HTMLElement>('.form-error')!;
  const list = container.querySelector<HTMLElement>('.bean-list')!;
  const count = container.querySelector<HTMLElement>('.bean-count')!;
  const listStatus = container.querySelector<HTMLElement>('.list-status')!;
  const listError = container.querySelector<HTMLElement>('.list-error')!;
  let refreshVersion = 0;
  let saving = false;
  let editing: Bean | null = null;
  let photo: string | null = null;
  let processingPhoto = false;
  let photoVersion = 0;
  const photoInput = form.querySelector<HTMLInputElement>('#bean-photo')!;
  const preview = form.querySelector<HTMLImageElement>('.photo-preview')!;
  const removePhoto = form.querySelector<HTMLButtonElement>('.remove-photo')!;
  const photoStatus = form.querySelector<HTMLElement>('.photo-status')!;
  function resetPhoto(): void {
    photoVersion++;
    processingPhoto = false;
    photoInput.disabled = removePhoto.disabled = submit.disabled = false;
    photo = null;
    photoInput.value = '';
    preview.removeAttribute('src');
    preview.hidden = removePhoto.hidden = true;
    photoStatus.textContent = '';
  }
  function resetEditor(): void {
    editing = null;
    form.reset();
    name.setCustomValidity('');
    resetPhoto();
    cancel.hidden = true;
    submit.textContent = 'Add Bean';
    toggle.firstChild!.textContent = 'Add a bean ';
    message.textContent = '';
    error.hidden = true;
  }
  function editBean(bean: Bean): void {
    if (saving) return;
    resetEditor();
    editing = bean;
    name.value = bean.name;
    if (bean.roast_date) roastDate.value = bean.roast_date;
    else roastDate.valueAsDate = null;
    if (bean.freeze_date) freezeDate.value = bean.freeze_date;
    else freezeDate.valueAsDate = null;
    photo = bean.photo_jpeg ?? null;
    if (photo) {
      preview.src = photo;
      preview.hidden = removePhoto.hidden = false;
    }
    cancel.hidden = false;
    submit.textContent = 'Save';
    toggle.firstChild!.textContent = 'Edit bean ';
    setFormOpen(true);
    name.focus({ preventScroll: true });
  }
  cancel.addEventListener('click', () => {
    if (saving) return;
    const id = editing?.id;
    resetEditor();
    setFormOpen(false);
    const card = [...list.querySelectorAll<HTMLElement>('.bean-card')].find(card => card.dataset.beanId === id);
    (card?.querySelector<HTMLButtonElement>('.bean-actions') ?? toggle).focus({ preventScroll: true });
  });
  removePhoto.addEventListener('click', resetPhoto);
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const version = ++photoVersion;
    processingPhoto = true;
    photoInput.disabled = removePhoto.disabled = submit.disabled = true;
    photoStatus.textContent = 'Preparing photo…';
    error.hidden = true;
    void compressBeanPhoto(file).then(jpeg => {
      if (version !== photoVersion) return;
      photo = jpeg;
      preview.src = jpeg;
      preview.hidden = removePhoto.hidden = false;
      photoStatus.textContent = `JPEG ready · ${Math.round(jpeg.length * 0.75 / 1024)} KB`;
    }).catch(failure => {
      if (version !== photoVersion) return;
      photoInput.value = '';
      photoStatus.textContent = '';
      error.textContent = failure instanceof Error ? failure.message : 'Could not read this photo.';
      error.hidden = false;
    }).finally(() => {
      if (version !== photoVersion) return;
      processingPhoto = false;
      photoInput.disabled = removePhoto.disabled = submit.disabled = false;
    });
  });

  async function refresh(): Promise<void> {
    const version = ++refreshVersion;
    list.setAttribute('aria-busy', 'true');
    listStatus.textContent = 'Loading beans…';
    listError.hidden = true;
    try {
      const [beans, sessions] = await Promise.all([getBeans(), getBrewSessions()]);
      if (version !== refreshVersion) return;
      const byBean = new Map<string, BrewSession[]>();
      for (const session of sessions) {
        const history = byBean.get(session.bean_id) ?? [];
        history.push(session);
        byBean.set(session.bean_id, history);
      }
      list.replaceChildren(...beans.map(bean => renderBean(bean, byBean.get(bean.id) ?? [], () => editBean(bean), async () => {
        try { await deleteBean(bean.id); }
        catch (failure) {
          if (failure instanceof CommittedWriteError) {
            await refresh();
            error.textContent = 'Deletion was applied, but storage could not be confirmed. Export a backup from IO before closing this tab.';
            error.hidden = false;
            return;
          }
          throw failure;
        }
        await refresh();
      })));
      if (!beans.length) {
        const empty = textElement('div', '', 'empty-state');
        empty.append(textElement('h3', 'No beans yet'), textElement('p', 'Add your first bean above to start your collection.'));
        list.append(empty);
      }
      count.textContent = `(${beans.length})`;
    } catch (failure) {
      if (version === refreshVersion) listError.hidden = false;
      console.error('Could not load beans and brew history.', failure);
    } finally {
      if (version === refreshVersion) {
        list.setAttribute('aria-busy', 'false');
        listStatus.textContent = '';
      }
    }
  }

  name.addEventListener('input', () => name.setCustomValidity(''));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving || processingPhoto) return;
    name.setCustomValidity(name.value.trim() ? '' : 'Enter a bean name.');
    if (!form.reportValidity()) return;
    void save();
  });

  async function save(): Promise<void> {
    const original = editing;
    saving = true;
    fieldset.disabled = true;
    toggle.disabled = true;
    submit.textContent = original ? 'Saving…' : 'Adding…';
    message.textContent = '';
    error.hidden = true;
    try {
      const input = { name: original && name.value === original.name ? original.name : name.value.trim(), roast_date: roastDate.value || null, freeze_date: freezeDate.value || null, photo_jpeg: photo };
      const bean = await (original ? updateBean(original.id, input) : addBean(input));
      resetEditor();
      if (original) setFormOpen(false);
      message.textContent = `${original ? 'Saved' : 'Added'} ${bean.name}.`;
      await refresh();
    } catch (failure) {
      console.error('Could not save bean.', failure);
      if (failure instanceof CommittedWriteError) {
        resetEditor();
        await refresh();
      }
      error.textContent = failure instanceof CommittedWriteError ? failure.message
        : 'Your bean could not be saved. Your entries are still here; please try again.';
      error.hidden = false;
    } finally {
      saving = false;
      fieldset.disabled = false;
      toggle.disabled = false;
      submit.textContent = editing ? 'Save' : 'Add Bean';
      if (original && form.hidden) toggle.focus({ preventScroll: true });
    }
  }

  listError.querySelector('button')!.addEventListener('click', () => void refresh());
  return { refresh, openForm };
}

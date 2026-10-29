import { CommittedWriteError, EditConflictError, DatabaseRuntimeError, addBrewSession, updateBrewSession, deleteBrewSession, getBeans, getBrewSessions } from '../db';
import type { BrewSession } from '../types';
import { createBrewingChart } from './brewingChart';
import { stabilizeEditorViewport } from './editorViewport';
import { attachSwipeRow } from './swipeRow';

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function renderSession(session: BrewSession, onEdit: () => void, onDelete: () => Promise<void>): HTMLElement {
  const card = document.createElement('article');
  card.className = 'session-card card';
  card.dataset.sessionId = session.id;
  const surface = document.createElement('div');
  surface.className = 'session-surface';
  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'session-summary';
  summary.setAttribute('aria-label', `Edit ${session.bean_name ?? 'Unknown bean'} brew, ${dateTimeFormatter.format(new Date(session.brewed_at))}`);
  const heading = document.createElement('span');
  heading.className = 'session-name';
  heading.textContent = session.bean_name ?? 'Unknown bean';
  const time = document.createElement('time');
  time.dateTime = session.brewed_at;
  time.textContent = dateFormatter.format(new Date(session.brewed_at));
  time.title = dateTimeFormatter.format(new Date(session.brewed_at));
  const ey = document.createElement('span');
  ey.className = 'session-ey';
  ey.textContent = `EY ${session.extraction_pct?.toFixed(2) ?? '—'}${session.extraction_pct === null ? '' : '%'}`;
  summary.append(time, heading, ey);
  summary.addEventListener('click', () => { summary.focus(); onEdit(); });
  const actions = document.createElement('button');
  actions.type = 'button';
  actions.className = 'session-menu';
  actions.textContent = '•••';
  actions.setAttribute('aria-label', `Actions for ${session.bean_name ?? 'Unknown bean'} brew, ${time.title}`);
  actions.setAttribute('aria-expanded', 'false');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'session-delete';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${session.bean_name ?? 'Unknown bean'} brew, ${time.title}`);
  remove.hidden = true;
  const failure = document.createElement('p');
  failure.className = 'form-error';
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  let deleting = false;
  function reveal(open: boolean): void {
    if (deleting) return;
    card.classList.toggle('delete-revealed', open);
    remove.hidden = !open;
    remove.inert = false;
    actions.setAttribute('aria-expanded', String(open));
  }
  actions.addEventListener('click', () => {
    reveal(Boolean(remove.hidden));
    if (!remove.hidden) remove.focus();
  });
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape') { reveal(false); actions.focus(); }
  });
  attachSwipeRow(surface, {
    disabled: () => deleting,
    ignore: target => Boolean(target.closest('.session-menu')),
    position: () => card.classList.contains('delete-revealed') ? -1 : 0,
    allowsRight: false,
    preview: offset => { remove.hidden = offset >= 0; remove.inert = true; },
    settle: direction => reveal(direction ? direction === 'left' : card.classList.contains('delete-revealed')),
  });
  surface.addEventListener('click', event => {
    if (!remove.hidden && !(event.target as Element).closest('.session-menu')) {
      event.preventDefault();
      event.stopPropagation();
      reveal(false);
    }
  }, true);
  remove.addEventListener('click', () => {
    if (deleting) return;
    deleting = true;
    remove.disabled = actions.disabled = summary.disabled = true;
    remove.textContent = 'Deleting…';
    failure.hidden = true;
    void onDelete().catch(error => {
      failure.textContent = error instanceof CommittedWriteError
        ? 'Deletion was applied, but storage could not be confirmed. Export a backup from IO before closing this tab.'
        : error instanceof DatabaseRuntimeError ? error.message : 'Could not delete this session. Your data was preserved; please try again.';
      failure.hidden = false;
    }).finally(() => {
      deleting = false;
      remove.disabled = actions.disabled = summary.disabled = false;
      remove.textContent = 'Delete';
    });
  });
  surface.append(summary, actions);
  card.append(remove, surface, failure);
  return card;
}

function localDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}

export function createBrewController(container: HTMLElement, options: {
  onSaved: () => Promise<void>;
  onAddBean: () => void;
}): { refresh: () => Promise<void> } {
  container.innerHTML = `
    <div class="brew-feed">
      <button class="primary-button new-session" type="button">+ New Session</button>
      <p class="save-message form-message" role="status"></p>
      <section class="session-collection" aria-labelledby="session-list-heading">
        <div class="session-list-header">
          <h2 id="session-list-heading">Your brew sessions <span class="session-count-total"></span></h2>
          <button class="session-filter-toggle" type="button" aria-label="Filter brew sessions by bean"
            aria-expanded="false" aria-controls="session-bean-filter" title="Filter brew sessions by bean">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l-6 7v7l-4 2v-9L4 4Z"/></svg>
          </button>
        </div>
        <div id="session-bean-filter" class="session-filter" hidden>
          <select class="session-filter-bean" aria-label="Filter brew sessions by bean">
            <option value="">All beans</option>
          </select>
        </div>
        <div class="list-error" role="alert" hidden>
          <p>Your sessions could not be loaded. Please try again.</p>
          <button class="secondary-button" type="button">Try again</button>
        </div>
        <p class="list-status" role="status"></p>
        <div class="session-list"></div>
      </section>
    </div>
    <form class="session-form card" aria-labelledby="new-session-heading" hidden>
      <div class="session-body">
      <div class="session-heading">
        <h2 id="new-session-heading" tabindex="-1">New Session</h2>
        <label class="session-date-toggle" for="session-date" hidden>
          <span class="session-date-label"></span>
          <input id="session-date" name="brewed_at" type="datetime-local" step="0.001">
        </label>
      </div>
      <p class="bean-picker-status" role="status"></p>
      <div class="bean-picker-error" role="alert" hidden>
        <p>Your beans could not be loaded. Please try again.</p>
        <button class="secondary-button" type="button">Try again</button>
      </div>
      <div class="no-beans" hidden>
        <p>Add a bean in Bean Manager before logging your first brew session.</p>
        <button class="secondary-button" type="button">Open Bean Manager</button>
      </div>
      <fieldset>
        <div class="session-bean-field">
          <label class="bean-selector-label" for="session-bean">Bean <span class="field-hint">(required)</span></label>
          <select id="session-bean" name="bean_id" required>
            <option value="">Select a bean</option>
          </select>
        </div>
        <div class="session-measurements">
          <div>
            <table class="spec-table">
              <caption>Input</caption>
              <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
              <tbody>
                <tr><th scope="row"><label for="session-dose">Dose (g)</label></th><td><input id="session-dose" name="dose_g" type="number" step="any" inputmode="decimal"></td></tr>
                <tr><th scope="row"><label for="session-water">Water (g)</label></th><td><input id="session-water" name="water_g" type="number" step="any" inputmode="decimal"></td></tr>
                <tr><th scope="row"><label for="session-time">Time</label></th><td><input id="session-time" name="time_str" type="text" placeholder="e.g. 02:30"></td></tr>
                <tr><th scope="row"><label for="session-temp">Temp (°C)</label></th><td><input id="session-temp" name="temp_c" type="number" step="any" inputmode="decimal"></td></tr>
                <tr><th scope="row"><label for="session-grind">Grind (µm)</label></th><td><input id="session-grind" name="grind_um" type="number" step="any" inputmode="decimal"></td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <table class="spec-table">
              <caption>Output</caption>
              <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
              <tbody>
                <tr><th scope="row"><label for="session-yield">Yield (g)</label></th><td><input id="session-yield" name="yield_g" type="number" step="any" inputmode="decimal"></td></tr>
                <tr><th scope="row"><label for="session-tds">TDS%</label></th><td><input id="session-tds" name="tds_pct" type="number" step="any" inputmode="decimal"></td></tr>
                <tr><th scope="row"><label for="session-extraction">EY (%)</label></th><td><output id="session-extraction" for="session-dose session-yield session-tds" aria-live="polite">—</output></td></tr>
                <tr class="session-comment-label"><td colspan="2"><label for="session-comment">Comment</label></td></tr>
                <tr class="session-comment-field"><td colspan="2"><input id="session-comment" name="comment" type="text" placeholder="Tasting notes"></td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <p class="field-hint session-optional-hint">Measurements and comment are optional.</p>
      </fieldset>
      <p class="form-error" role="alert" hidden></p>
      </div>
      <div class="session-actions">
        <button class="secondary-button cancel-session" type="button">Cancel</button>
        <button class="primary-button save-session" type="submit">Save Session</button>
      </div>
    </form>`;

  const feed = container.querySelector<HTMLElement>('.brew-feed')!;
  const form = container.querySelector<HTMLFormElement>('.session-form')!;
  const fieldset = form.querySelector('fieldset')!;
  const bean = form.querySelector<HTMLSelectElement>('select')!;
  const output = form.querySelector('output')!;
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const chart = createBrewingChart();
  const dateToggle = form.querySelector<HTMLLabelElement>('.session-date-toggle')!;
  const dateLabel = dateToggle.querySelector<HTMLElement>('.session-date-label')!;
  form.querySelector('.session-heading')!.after(chart.element);
  const editorViewport = stabilizeEditorViewport(form);
  function updateDateLabel(): void {
    const value = input('brewed_at').value;
    dateLabel.textContent = value ? new Date(value).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }) : 'Set date';
    input('brewed_at').setAttribute('aria-label', `Edit brewed timestamp: ${value || 'not set'}`);
  }
  input('brewed_at').addEventListener('input', updateDateLabel);
  const newSession = feed.querySelector<HTMLButtonElement>('.new-session')!;
  const saveButton = form.querySelector<HTMLButtonElement>('.save-session')!;
  const cancel = form.querySelector<HTMLButtonElement>('.cancel-session')!;
  const pickerStatus = form.querySelector<HTMLElement>('.bean-picker-status')!;
  const pickerError = form.querySelector<HTMLElement>('.bean-picker-error')!;
  const noBeans = form.querySelector<HTMLElement>('.no-beans')!;
  const error = form.querySelector<HTMLElement>('.form-error')!;
  const message = feed.querySelector<HTMLElement>('.save-message')!;
  const list = feed.querySelector<HTMLElement>('.session-list')!;
  const count = feed.querySelector<HTMLElement>('.session-count-total')!;
  const listStatus = feed.querySelector<HTMLElement>('.list-status')!;
  const listError = feed.querySelector<HTMLElement>('.list-error')!;
  const filterToggle = feed.querySelector<HTMLButtonElement>('.session-filter-toggle')!;
  const filter = feed.querySelector<HTMLElement>('.session-filter')!;
  const filterBean = feed.querySelector<HTMLSelectElement>('.session-filter-bean')!;
  let sessions: BrewSession[] = [];
  let refreshVersion = 0;
  let pickerVersion = 0;
  let saving = false;
  let editing: BrewSession | null = null;
  const initialText: Record<string, string> = {};
  let initialDate = '';
  let returnFocus: HTMLElement | null = null;

  const number = (name: string): number | null => {
    const value = input(name).valueAsNumber;
    return Number.isFinite(value) ? value : null;
  };
  const text = (name: 'time_str' | 'comment'): string | null => {
    const value = input(name).value;
    return editing && value === initialText[name] ? editing[name] : value.trim() || null;
  };

  function extraction(): number | null {
    const dose = number('dose_g');
    const yieldG = number('yield_g');
    const tds = number('tds_pct');
    if (dose === null || yieldG === null || tds === null || dose <= 0 || yieldG <= 0 || tds <= 0) return null;
    const value = yieldG * tds / dose;
    return Number.isFinite(value) ? value : null;
  }

  function updateExtraction(): void {
    const value = editing && ['dose_g', 'yield_g', 'tds_pct'].every(name =>
      number(name) === editing![name as 'dose_g' | 'yield_g' | 'tds_pct']) ? editing.extraction_pct : extraction();
    output.value = value === null ? '—' : `${value.toFixed(2)}%`;
    chart.update(value, number('tds_pct'));
  }

  function renderSessions(): void {
    const visible = filterBean.value ? sessions.filter(session => session.bean_id === filterBean.value) : sessions;
    list.replaceChildren(...visible.map(session => renderSession(session, () => openEditor(session), async () => {
      try {
        await deleteBrewSession(session.id);
      } catch (failure) {
        if (!(failure instanceof CommittedWriteError)) throw failure;
        message.textContent = 'Deletion was applied, but storage could not be confirmed. Export a backup from IO before closing this tab.';
        await Promise.all([refresh(), options.onSaved()]);
        return;
      }
      message.textContent = 'Session deleted.';
      await Promise.all([refresh(), options.onSaved()]);
      newSession.focus();
    })));
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = filterBean.value
        ? '<h3>No brew sessions for this bean</h3><p>Choose another bean or clear the filter to see all sessions.</p>'
        : '<h3>No brew sessions yet</h3><p>Start with + New Session to log your next cup.</p>';
      list.append(empty);
    }
    count.textContent = `(${visible.length})`;
  }

  async function refresh(): Promise<void> {
    const version = ++refreshVersion;
    list.setAttribute('aria-busy', 'true');
    listStatus.textContent = 'Loading sessions…';
    listError.hidden = true;
    filterBean.disabled = true;
    try {
      const [loadedSessions, beans] = await Promise.all([getBrewSessions(), filter.hidden ? null : getBeans()]);
      if (version !== refreshVersion) return;
      sessions = loadedSessions;
      if (beans) {
        const selected = filterBean.value;
        filterBean.replaceChildren(new Option('All beans', ''));
        filterBean.append(...beans.map(item => new Option(item.name, item.id)));
        filterBean.value = beans.some(item => item.id === selected) ? selected : '';
      }
      renderSessions();
    } catch (failure) {
      if (version === refreshVersion) listError.hidden = false;
      console.error('Could not load brew sessions.', failure);
    } finally {
      if (version === refreshVersion) {
        list.setAttribute('aria-busy', 'false');
        listStatus.textContent = '';
        filterBean.disabled = false;
      }
    }
    if (version === refreshVersion && !form.hidden && !saving) await loadBeans();
  }

  async function loadBeans(): Promise<void> {
    const version = ++pickerVersion;
    fieldset.disabled = true;
    saveButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    pickerStatus.textContent = 'Loading beans…';
    pickerError.hidden = true;
    noBeans.hidden = true;
    try {
      const beans = await getBeans();
      if (version !== pickerVersion) return;
      const selected = bean.value || editing?.bean_id || '';
      bean.replaceChildren(new Option('Select a bean', ''));
      bean.append(...beans.map(item => new Option(item.name, item.id)));
      bean.value = selected;
      noBeans.hidden = beans.length > 0;
      fieldset.disabled = beans.length === 0;
    } catch (failure) {
      if (version === pickerVersion) pickerError.hidden = false;
      console.error('Could not load beans for a new session.', failure);
    } finally {
      if (version === pickerVersion) {
        saveButton.disabled = fieldset.disabled;
        pickerStatus.textContent = '';
        form.setAttribute('aria-busy', 'false');
      }
    }
  }

  function showFeed(): void {
    ++pickerVersion;
    editorViewport.reset();
    editing = null;
    form.reset();
    updateExtraction();
    form.hidden = true;
    feed.hidden = false;
    (returnFocus?.isConnected ? returnFocus : newSession).focus();
  }

  function openEditor(session: BrewSession | null = null): void {
    returnFocus = document.activeElement as HTMLElement;
    editing = session;
    form.reset();
    form.querySelector('h2')!.textContent = session ? 'Edit Session' : 'New Session';
    saveButton.textContent = session ? 'Save Changes' : 'Save Session';
    dateToggle.hidden = !session;
    input('brewed_at').required = !!session;
    if (session) {
      for (const name of ['dose_g', 'water_g', 'time_str', 'temp_c', 'grind_um', 'comment', 'yield_g', 'tds_pct'] as const) {
        input(name).value = String(session[name] ?? '');
        initialText[name] = input(name).value;
      }
      input('brewed_at').value = localDateTime(session.brewed_at);
      initialDate = input('brewed_at').value;
      updateDateLabel();
      bean.replaceChildren(new Option(session.bean_name ?? 'Selected bean', session.bean_id));
    }
    updateExtraction();
    feed.hidden = true;
    form.hidden = false;
    error.hidden = true;
    message.textContent = '';
    form.querySelector<HTMLElement>('h2')!.focus();
    const content = container.closest('.app-content');
    if (content) content.scrollTop = 0;
    void loadBeans();
  }
  newSession.addEventListener('click', () => { openEditor(); returnFocus = newSession; });
  cancel.addEventListener('click', showFeed);
  noBeans.querySelector('button')!.addEventListener('click', () => {
    showFeed();
    options.onAddBean();
  });
  pickerError.querySelector('button')!.addEventListener('click', () => void loadBeans());
  listError.querySelector('button')!.addEventListener('click', () => void refresh());
  filterToggle.addEventListener('click', () => {
    filter.hidden = !filter.hidden;
    filterBean.value = '';
    filterToggle.setAttribute('aria-expanded', String(!filter.hidden));
    const label = filter.hidden ? 'Filter brew sessions by bean' : 'Hide and clear bean filter';
    filterToggle.setAttribute('aria-label', label);
    filterToggle.title = label;
    renderSessions();
    void refresh();
  });
  filterBean.addEventListener('change', renderSessions);
  for (const name of ['dose_g', 'yield_g', 'tds_pct']) input(name).addEventListener('input', updateExtraction);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving || fieldset.disabled || !form.reportValidity()) return;
    void save();
  });

  async function save(): Promise<void> {
    saving = true;
    input('brewed_at').disabled = true;
    fieldset.disabled = true;
    saveButton.disabled = true;
    cancel.disabled = true;
    saveButton.textContent = 'Saving…';
    error.hidden = true;
    try {
      const values = {
        bean_id: bean.value, dose_g: number('dose_g'), water_g: number('water_g'),
        time_str: text('time_str'), temp_c: number('temp_c'), grind_um: number('grind_um'),
        comment: text('comment'), yield_g: number('yield_g'), tds_pct: number('tds_pct'),
        extraction_pct: editing && ['dose_g', 'yield_g', 'tds_pct'].every(name =>
          number(name) === editing![name as 'dose_g' | 'yield_g' | 'tds_pct']) ? editing.extraction_pct : extraction(),
      };
      if (editing) {
        await updateBrewSession(editing.id, { ...values,
          brewed_at: input('brewed_at').value === initialDate ? undefined : new Date(input('brewed_at').value).toISOString(),
        }, editing);
      } else await addBrewSession(values);
    } catch (failure) {
      console.error('Could not save brew session.', failure);
      if (failure instanceof CommittedWriteError) {
        showFeed();
        message.textContent = failure.message;
        await Promise.all([refresh(), options.onSaved()]);
        return;
      }
      error.textContent = (failure instanceof EditConflictError || failure instanceof DatabaseRuntimeError) ? failure.message : 'Your session could not be saved. Your entries are still here; please try again.';
      error.hidden = false;
      return;
    } finally {
      saving = false;
      input('brewed_at').disabled = false;
      fieldset.disabled = false;
      saveButton.disabled = false;
      cancel.disabled = false;
      saveButton.textContent = editing ? 'Save Changes' : 'Save Session';
    }
    showFeed();
    message.textContent = 'Session saved.';
    await Promise.all([refresh(), options.onSaved()]);
  }

  return { refresh };
}

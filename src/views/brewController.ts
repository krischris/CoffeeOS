import { CommittedWriteError, addBrewSession, getBeans, getBrewSessions } from '../db';
import type { BrewSession } from '../types';
import { renderSessionMetrics } from './sessionMetrics';
import { createBrewingChart } from './brewingChart';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function renderSession(session: BrewSession): HTMLElement {
  const card = document.createElement('article');
  card.className = 'session-card card';
  card.dataset.sessionId = session.id;
  const heading = document.createElement('h3');
  heading.textContent = session.bean_name ?? 'Unknown bean';
  const time = document.createElement('time');
  time.dateTime = session.brewed_at;
  time.textContent = dateTimeFormatter.format(new Date(session.brewed_at));
  card.append(heading, time);
  for (const group of ['input', 'result'] as const) {
    const label = document.createElement('h4');
    label.textContent = group === 'input' ? 'Input' : 'Result';
    card.append(label, renderSessionMetrics(session, group));
  }
  if (session.comment) {
    const comment = document.createElement('p');
    comment.className = 'brew-comment';
    comment.textContent = session.comment;
    card.append(comment);
  }
  return card;
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
        <h2 id="session-list-heading">Your brew sessions <span class="session-count-total"></span></h2>
        <div class="list-error" role="alert" hidden>
          <p>Your sessions could not be loaded. Please try again.</p>
          <button class="secondary-button" type="button">Try again</button>
        </div>
        <p class="list-status" role="status"></p>
        <div class="session-list"></div>
      </section>
    </div>
    <form class="session-form card" aria-labelledby="new-session-heading" hidden>
      <h2 id="new-session-heading" tabindex="-1">New Session</h2>
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
        <label class="bean-selector-label" for="session-bean">Bean <span class="field-hint">(required)</span></label>
        <select id="session-bean" name="bean_id" required>
          <option value="">Select a bean</option>
        </select>
        <table class="spec-table">
          <caption>Input</caption>
          <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
          <tbody>
            <tr><th scope="row"><label for="session-dose">Dose (g)</label></th><td><input id="session-dose" name="dose_g" type="number" step="0.1" inputmode="decimal"></td></tr>
            <tr><th scope="row"><label for="session-water">Water (g)</label></th><td><input id="session-water" name="water_g" type="number" step="0.1" inputmode="decimal"></td></tr>
            <tr><th scope="row"><label for="session-time">Time</label></th><td><input id="session-time" name="time_str" type="text" placeholder="e.g. 02:30"></td></tr>
            <tr><th scope="row"><label for="session-temp">Temp (°C)</label></th><td><input id="session-temp" name="temp_c" type="number" step="0.1" inputmode="decimal"></td></tr>
            <tr><th scope="row"><label for="session-grind">Grind size (µm)</label></th><td><input id="session-grind" name="grind_um" type="number" step="1" inputmode="decimal"></td></tr>
            <tr><th scope="row"><label for="session-comment">Comment</label></th><td><input id="session-comment" name="comment" type="text"></td></tr>
          </tbody>
        </table>
        <table class="spec-table">
          <caption>Result</caption>
          <thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
          <tbody>
            <tr><th scope="row"><label for="session-yield">Yield (g)</label></th><td><input id="session-yield" name="yield_g" type="number" step="0.1" inputmode="decimal"></td></tr>
            <tr><th scope="row"><label for="session-tds">TDS%</label></th><td><input id="session-tds" name="tds_pct" type="number" step="0.01" inputmode="decimal"></td></tr>
            <tr><th scope="row"><label for="session-extraction">Extraction (%)</label></th><td><output id="session-extraction" for="session-dose session-yield session-tds" aria-live="polite">—</output></td></tr>
          </tbody>
        </table>
        <p class="field-hint">All measurements and the comment are optional.</p>
        <button class="primary-button save-session" type="submit">Save Session</button>
      </fieldset>
      <button class="secondary-button cancel-session" type="button">Cancel</button>
      <p class="form-error" role="alert" hidden></p>
    </form>`;

  const feed = container.querySelector<HTMLElement>('.brew-feed')!;
  const form = container.querySelector<HTMLFormElement>('.session-form')!;
  const fieldset = form.querySelector('fieldset')!;
  const bean = form.querySelector<HTMLSelectElement>('select')!;
  const output = form.querySelector('output')!;
  const chart = createBrewingChart();
  form.querySelectorAll('.spec-table')[1]!.after(chart.element);
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
  let refreshVersion = 0;
  let pickerVersion = 0;
  let saving = false;

  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const number = (name: string): number | null => {
    const value = input(name).valueAsNumber;
    return Number.isFinite(value) ? value : null;
  };
  const text = (name: string): string | null => input(name).value.trim() || null;

  function extraction(): number | null {
    const dose = number('dose_g');
    const yieldG = number('yield_g');
    const tds = number('tds_pct');
    if (dose === null || yieldG === null || tds === null || dose <= 0 || yieldG <= 0 || tds <= 0) return null;
    const value = yieldG * tds / dose;
    return Number.isFinite(value) ? value : null;
  }

  function updateExtraction(): void {
    const value = extraction();
    output.value = value === null ? '—' : `${value.toFixed(2)}%`;
    chart.update(value, number('tds_pct'));
  }

  async function refresh(): Promise<void> {
    const version = ++refreshVersion;
    list.setAttribute('aria-busy', 'true');
    listStatus.textContent = 'Loading sessions…';
    listError.hidden = true;
    try {
      const sessions = await getBrewSessions();
      if (version !== refreshVersion) return;
      list.replaceChildren(...sessions.map(renderSession));
      if (!sessions.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<h3>No brew sessions yet</h3><p>Start with + New Session to log your next cup.</p>';
        list.append(empty);
      }
      count.textContent = `(${sessions.length})`;
    } catch (failure) {
      if (version === refreshVersion) listError.hidden = false;
      console.error('Could not load brew sessions.', failure);
    } finally {
      if (version === refreshVersion) {
        list.setAttribute('aria-busy', 'false');
        listStatus.textContent = '';
      }
    }
    if (version === refreshVersion && !form.hidden && !saving) await loadBeans();
  }

  async function loadBeans(): Promise<void> {
    const version = ++pickerVersion;
    fieldset.disabled = true;
    form.setAttribute('aria-busy', 'true');
    pickerStatus.textContent = 'Loading beans…';
    pickerError.hidden = true;
    noBeans.hidden = true;
    try {
      const beans = await getBeans();
      if (version !== pickerVersion) return;
      const selected = bean.value;
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
        pickerStatus.textContent = '';
        form.setAttribute('aria-busy', 'false');
      }
    }
  }

  function showFeed(): void {
    ++pickerVersion;
    form.reset();
    updateExtraction();
    form.hidden = true;
    feed.hidden = false;
    newSession.focus();
  }

  newSession.addEventListener('click', () => {
    feed.hidden = true;
    form.hidden = false;
    error.hidden = true;
    message.textContent = '';
    form.querySelector<HTMLElement>('h2')!.focus();
    void loadBeans();
  });
  cancel.addEventListener('click', showFeed);
  noBeans.querySelector('button')!.addEventListener('click', () => {
    showFeed();
    options.onAddBean();
  });
  pickerError.querySelector('button')!.addEventListener('click', () => void loadBeans());
  listError.querySelector('button')!.addEventListener('click', () => void refresh());
  for (const name of ['dose_g', 'yield_g', 'tds_pct']) input(name).addEventListener('input', updateExtraction);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving || fieldset.disabled || !form.reportValidity()) return;
    void save();
  });

  async function save(): Promise<void> {
    saving = true;
    fieldset.disabled = true;
    cancel.disabled = true;
    saveButton.textContent = 'Saving…';
    error.hidden = true;
    try {
      await addBrewSession({
        bean_id: bean.value, dose_g: number('dose_g'), water_g: number('water_g'),
        time_str: text('time_str'), temp_c: number('temp_c'), grind_um: number('grind_um'),
        comment: text('comment'), yield_g: number('yield_g'), tds_pct: number('tds_pct'),
        extraction_pct: extraction(),
      });
    } catch (failure) {
      console.error('Could not save brew session.', failure);
      if (failure instanceof CommittedWriteError) {
        showFeed();
        message.textContent = failure.message;
        await Promise.all([refresh(), options.onSaved()]);
        return;
      }
      error.textContent = 'Your session could not be saved. Your entries are still here; please try again.';
      error.hidden = false;
      return;
    } finally {
      saving = false;
      fieldset.disabled = false;
      cancel.disabled = false;
      saveButton.textContent = 'Save Session';
    }
    showFeed();
    message.textContent = 'Session saved.';
    await Promise.all([refresh(), options.onSaved()]);
  }

  return { refresh };
}

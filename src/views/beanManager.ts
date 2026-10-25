import { CommittedWriteError, addBean, getBeans, getBrewSessions } from '../db';
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

function renderBean(bean: Bean, sessions: BrewSession[]): HTMLElement {
  const card = document.createElement('article');
  card.className = 'bean-card';
  card.dataset.beanId = bean.id;
  card.append(textElement('h3', bean.name));
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
  if (dates.childElementCount) card.append(dates);
  card.append(textElement('p', `${sessions.length} brew ${sessions.length === 1 ? 'session' : 'sessions'}`, 'session-count'));
  if (sessions.length) card.append(...sessions.map(renderSession));
  else card.append(textElement('p', 'No brew sessions yet', 'bean-empty'));
  return card;
}

/** Mount once; refresh on tab entry so newly saved sessions are reflected here. */
export function createBeanManager(container: HTMLElement): { refresh: () => Promise<void> } {
  container.innerHTML = `
    <form class="bean-form card" aria-labelledby="add-bean-heading">
      <h2 id="add-bean-heading">Add a bean</h2>
      <fieldset>
        <label for="bean-name">Name <span class="field-hint">(required)</span></label>
        <input id="bean-name" name="name" type="text" required placeholder="e.g. Ethiopia · Yirgacheffe">
        <div class="date-fields">
          <div><label for="bean-roast-date">Roast date <span class="field-hint">(optional)</span></label>
            <input id="bean-roast-date" name="roast_date" type="date"></div>
          <div><label for="bean-freeze-date">Freeze date <span class="field-hint">(optional)</span></label>
            <input id="bean-freeze-date" name="freeze_date" type="date"></div>
        </div>
        <button class="primary-button" type="submit">Add Bean</button>
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
  const fieldset = form.querySelector('fieldset')!;
  const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
  const roastDate = form.querySelector<HTMLInputElement>('[name="roast_date"]')!;
  const freezeDate = form.querySelector<HTMLInputElement>('[name="freeze_date"]')!;
  const submit = form.querySelector('button')!;
  const message = form.querySelector<HTMLElement>('.form-message')!;
  const error = form.querySelector<HTMLElement>('.form-error')!;
  const list = container.querySelector<HTMLElement>('.bean-list')!;
  const count = container.querySelector<HTMLElement>('.bean-count')!;
  const listStatus = container.querySelector<HTMLElement>('.list-status')!;
  const listError = container.querySelector<HTMLElement>('.list-error')!;
  let refreshVersion = 0;
  let saving = false;

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
      list.replaceChildren(...beans.map(bean => renderBean(bean, byBean.get(bean.id) ?? [])));
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
    if (saving) return;
    name.setCustomValidity(name.value.trim() ? '' : 'Enter a bean name.');
    if (!form.reportValidity()) return;
    void save();
  });

  async function save(): Promise<void> {
    saving = true;
    fieldset.disabled = true;
    submit.textContent = 'Adding…';
    message.textContent = '';
    error.hidden = true;
    try {
      const bean = await addBean({ name: name.value.trim(), roast_date: roastDate.value || null, freeze_date: freezeDate.value || null });
      form.reset();
      message.textContent = `Added ${bean.name}.`;
      await refresh();
    } catch (failure) {
      console.error('Could not add bean.', failure);
      if (failure instanceof CommittedWriteError) {
        form.reset();
        await refresh();
      }
      error.textContent = failure instanceof CommittedWriteError ? failure.message
        : 'Your bean could not be saved. Your entries are still here; please try again.';
      error.hidden = false;
    } finally {
      saving = false;
      fieldset.disabled = false;
      submit.textContent = 'Add Bean';
    }
  }

  listError.querySelector('button')!.addEventListener('click', () => void refresh());
  return { refresh };
}

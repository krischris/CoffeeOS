import './style.css';
import { installDriveDiagnostics } from './driveDiagnostics';
import { initDB, DatabaseStartupError, getStorageMode, getDatabaseStartupPhase } from './db';
import { createStartupView } from './startupView';
import { createBeanManager } from './views/beanManager';
import { createBrewController } from './views/brewController';
import { createIOView } from './views/ioView';
import { createAboutView } from './views/aboutView';

installDriveDiagnostics();

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element');
}

let preparingOffline = Boolean(window.coffeeosOfflineStartup && !window.crossOriginIsolated);
const startup = createStartupView(app, () => preparingOffline ? 'Preparing CoffeeOS for offline use' : getDatabaseStartupPhase());
try {
  // On a headerless host, first install establishes isolation by reloading. Do
  // not open storage or expose editable drafts before that automatic reload.
  await window.coffeeosOfflineStartup;
  preparingOffline = false;
  await initDB();
} catch (error) {
  console.error('Could not initialize the coffee database.', error);
  startup.failed(error instanceof DatabaseStartupError ? error.message : 'Your coffee data could not be opened. Please reload to try again.', error);
}

if (app.getAttribute('aria-busy') === 'true') {
  startup.ready();
  renderShell(app);
  app.setAttribute('aria-busy', 'false');
}

function renderShell(app: HTMLDivElement): void {
  const views = [
    {
      id: 'brew-controller',
      label: 'Brew Controller',
      icon: '<path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 3v2m4-2v2m4-2v2"/>',
      title: 'One good cup at a time.',
      description: 'Your brew sessions and tasting notes, one cup at a time.',
      empty: 'No brew sessions yet',
    },
    {
      id: 'bean-manager',
      label: 'Bean Manager',
      icon: '<path d="M18 5c4 4 2 10-2 14S6 22 3 19 2 9 6 5s8-4 12 0Z"/><path d="M17 4c-7 2-3 11-13 16"/>',
      title: 'Every bean has a story.',
      description: 'Keep your coffee collection and its brewing history together.',
      empty: 'No beans yet',
    },
    {
      id: 'io',
      label: 'IO',
      icon: '<path d="M8 3v12m-4-4 4 4 4-4m4 10V9m-4 4 4-4 4 4"/>',
      title: 'Your coffee, with you.',
      description: 'Back up, share, and restore your coffee records.',
      empty: 'Your coffee data',
    },
  ];

  app.innerHTML = `
    <header class="app-header">
      <a class="wordmark" href="./" aria-label="coffeos home">coffeos<span aria-hidden="true">.</span></a>
      <a class="about-link" href="./privacy.html" aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/></svg>
        <span>About &amp; privacy</span>
      </a>
    </header>
    <main class="app-content">
      ${getStorageMode() === 'memory' ? '<p class="storage-warning" role="alert">Storage is unavailable. Your coffee data will be lost when this tab closes. Export a backup from IO before leaving.</p>' : ''}
      ${views.map((view, index) => `
        <section id="${view.id}" class="view" role="tabpanel"
          aria-labelledby="tab-${view.id}" tabindex="0" ${index === 0 ? '' : 'hidden'}>
          <p class="eyebrow">${view.label}</p>
          <h1>${view.title}</h1>
          <p class="view-description">${view.description}</p>
          <div class="empty-state">
            <span class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">${view.icon}</svg>
            </span>
            <h2>${view.empty}</h2>
            <p>${index === 2 ? 'Your data will always feel at home.' : 'Good things begin with a fresh start.'}</p>
          </div>
        </section>
      `).join('')}
    </main>
    <nav class="tab-bar" aria-label="Main navigation">
      <div class="tabs" role="tablist" aria-label="Coffee views">
        ${views.map((view, index) => `
          <button id="tab-${view.id}" class="tab" type="button" role="tab"
            aria-controls="${view.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">
            <svg viewBox="0 0 24 24" aria-hidden="true">${view.icon}</svg>
            <span>${view.label}</span>
          </button>
        `).join('')}
      </div>
    </nav>
  `;

  window.addEventListener('coffeeos-database-failed', event => {
    const warning = document.createElement('p'); warning.className = 'storage-warning'; warning.setAttribute('role', 'alert');
    warning.textContent = (event as CustomEvent<string>).detail;
    app.querySelector('.app-content')!.prepend(warning);
  });
  createAboutView(app);
  const tabs = Array.from(app.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = Array.from(app.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
  const beanContainer = document.createElement('div');
  app.querySelector('#bean-manager .empty-state')!.replaceWith(beanContainer);
  const beanManager = createBeanManager(beanContainer);
  const brewContainer = document.createElement('div');
  app.querySelector('#brew-controller .empty-state')!.replaceWith(brewContainer);
  const brewController = createBrewController(brewContainer, {
    onSaved: async () => { if (!panels[1]?.hidden) await beanManager.refresh(); },
    onAddBean: () => {
      activateTab(1);
      beanManager.openForm();
    },
  });
  void brewController.refresh();
  const ioContainer = document.createElement('div');
  app.querySelector('#io .empty-state')!.replaceWith(ioContainer);
  createIOView(ioContainer, async () => {
    await Promise.all([!panels[1]?.hidden ? beanManager.refresh() : Promise.resolve(), !panels[0]?.hidden ? brewController.refresh() : Promise.resolve()]);
  });

  function activateTab(activeIndex: number): void {
    tabs.forEach((tab, index) => {
      const active = index === activeIndex;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = panels[index];
      if (panel) panel.hidden = !active;
    });
    const content = app?.querySelector('.app-content');
    if (content) content.scrollTop = 0;
    if (views[activeIndex]?.id === 'bean-manager') void beanManager.refresh();
    if (views[activeIndex]?.id === 'brew-controller') void brewController.refresh();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(index));
    tab.addEventListener('keydown', (event) => {
      let nextIndex: number;
      switch (event.key) {
        case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break;
        case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break;
        case 'Home': nextIndex = 0; break;
        case 'End': nextIndex = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      activateTab(nextIndex);
      tabs[nextIndex]?.focus();
    });
  });
}

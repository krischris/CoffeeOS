interface OfflineStatus { state: string; message: string }

declare global {
  interface Window {
    coffeeosOffline?: OfflineStatus;
    coffeeosOfflineStartup?: Promise<void>;
  }
}

export function createOfflineStatus(container: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'card io-offline';
  section.setAttribute('aria-labelledby', 'offline-heading');
  section.innerHTML = '<h2 id="offline-heading">Offline use</h2><p class="offline-status field-hint" role="status" aria-live="polite"></p>';
  const status = section.querySelector<HTMLParagraphElement>('.offline-status')!;
  const render = () => {
    section.hidden = !window.coffeeosOffline;
    status.textContent = window.coffeeosOffline?.message ?? '';
    status.dataset.state = window.coffeeosOffline?.state ?? '';
  };
  window.addEventListener('coffeeos-offline-status', render);
  render();
  container.append(section);
}

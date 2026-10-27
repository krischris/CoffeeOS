/** Reuse the public policy in a modal without navigating away from the app. */
export function createAboutView(app: HTMLElement): void {
  const link = app.querySelector<HTMLAnchorElement>('.about-link')!;
  const dialog = document.createElement('dialog');
  dialog.className = 'about-dialog';
  dialog.setAttribute('aria-labelledby', 'about-heading');
  dialog.innerHTML = `
    <header class="about-toolbar">
      <button type="button" autofocus>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>
        Back
      </button>
      <h2 id="about-heading">About &amp; privacy</h2>
    </header>
    <div class="about-content"></div>`;
  app.append(dialog);
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => link.focus({ preventScroll: true }));
  const content = dialog.querySelector<HTMLDivElement>('.about-content')!;
  let loaded = false;
  let loading = false;

  async function load(): Promise<void> {
    if (loaded || loading) return;
    loading = true;
    content.setAttribute('aria-busy', 'true');
    content.innerHTML = '<p role="status">Loading privacy policy…</p>';
    try {
      const response = await fetch(link.href, { credentials: 'omit' });
      if (!response.ok) throw new Error('Policy unavailable');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const policy = page.querySelector('main.privacy-content');
      if (!policy) throw new Error('Policy missing');
      const article = document.createElement('article');
      article.className = 'privacy-content';
      article.append(...Array.from(policy.childNodes, node => document.importNode(node, true)));
      content.replaceChildren(article);
      loaded = true;
    } catch {
      content.innerHTML = '<p role="alert">The privacy policy could not load. Check your connection and try again.</p><button class="secondary-button" type="button">Try again</button>';
      content.querySelector('button')!.addEventListener('click', () => { void load(); });
    } finally {
      loading = false;
      content.setAttribute('aria-busy', 'false');
    }
  }

  link.addEventListener('click', event => {
    // Preserve normal link actions such as opening the public policy in a new tab.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    dialog.showModal();
    content.scrollTop = 0;
    void load();
  });
}

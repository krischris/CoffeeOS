/* Optional OAuth helper: no database, service-worker registration or token storage. */
(() => {
  const id = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const status = document.querySelector('[role="status"]');
  const button = document.querySelector('button');
  if (!/^[a-f0-9-]{36}$/.test(id)) { status.textContent = 'Open this window using Connect in CoffeeOS.'; return; }
  const channel = new BroadcastChannel(`coffeeos-drive-${id}`);
  let active = true, configured = false, client;
  const finish = message => {
    if (!active) return;
    active = false; button.disabled = true; clearTimeout(expiry);
    if (message) channel.postMessage(message);
    channel.close();
  };
  const expiry = setTimeout(() => {
    finish({ type: 'error' }); status.textContent = 'Authorization expired. Close this window and Connect again.';
  }, 180_000);
  channel.onmessage = event => {
    if (!active) return;
    if (event.data?.type === 'cancel') { finish(); window.close(); return; }
    const clientId = event.data?.clientId;
    if (configured || event.data?.type !== 'configure' || typeof clientId !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return;
    configured = true;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') script.referrerPolicy = 'no-referrer-when-downgrade';
    script.onerror = () => { finish({ type: 'error' }); status.textContent = 'Google could not load. Return to CoffeeOS; local backups are still available.'; };
    script.onload = () => {
      if (!active) return;
      try {
        client = google.accounts.oauth2.initTokenClient({
          client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file openid email', include_granted_scopes: false,
          callback: response => {
            if (!active) return;
            if (response.error || !response.access_token || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 0) {
              finish({ type: 'error' }); status.textContent = 'Authorization was not completed. Return to CoffeeOS and Connect again.'; return;
            }
            finish({ type: 'authorized', token: response.access_token, scope: response.scope,
              expiresAt: Date.now() + Number(response.expires_in) * 1000 - 30_000 });
            status.textContent = 'Authorization returned to CoffeeOS. You can close this window.';
            window.close();
          },
          error_callback: () => { finish({ type: 'error' }); status.textContent = 'Google sign-in was blocked or closed. Return to CoffeeOS and Connect again.'; },
        });
        button.disabled = false; status.textContent = 'Ready. Continue to choose your account.';
      } catch { finish({ type: 'error' }); status.textContent = 'Google authorization is unavailable. Return to CoffeeOS.'; }
    };
    document.head.append(script);
  };
  button.addEventListener('click', () => {
    if (!active || !client) return;
    button.disabled = true; status.textContent = 'Waiting for Google…';
    try { client.requestAccessToken({ prompt: 'select_account' }); }
    catch { finish({ type: 'error' }); status.textContent = 'Authorization could not open. Return to CoffeeOS and Connect again.'; }
  });
  window.addEventListener('pagehide', () => finish({ type: 'error' }));
  if (window.crossOriginIsolated) {
    // A previously installed isolation worker may predate the helper exception.
    // Update only that worker, then retry this bounded authorization request.
    status.textContent = 'Updating authorization support…';
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      if (active) { finish(); location.hash = id; location.reload(); }
    }, { once: true });
    void navigator.serviceWorker?.getRegistration().then(registration => {
      if (!registration) throw new Error('No isolation worker');
      return registration.update().then(() => {
        const pending = registration.installing || registration.waiting;
        const waiting = () => {
          if (!active || !registration.waiting) return;
          finish({ type: 'error' });
          status.textContent = 'An app update is ready. Close all CoffeeOS windows, reopen CoffeeOS, then connect Google Drive again.';
        };
        if (pending) pending.addEventListener('statechange', waiting);
        waiting();
      });
    }).catch(() => {
      finish({ type: 'error' }); status.textContent = 'This host still isolates the authorization window. Configure the helper headers in the CoffeeOS setup guide, then reconnect.';
    });
  } else channel.postMessage({ type: 'ready' });
})();

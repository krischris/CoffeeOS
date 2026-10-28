/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
// Vite replaces this in production. Development keeps the original network flow.
const offlineBuild = null;
let coepCredentialless = false;
if (typeof window === 'undefined') {
    const scope = self.registration.scope;
    const cachePrefix = 'coffeeos-shell:' + scope + ':';
    const cacheName = offlineBuild && cachePrefix + offlineBuild.id;
    const readyURL = new URL('.offline-ready', scope).href;
    const fileURLs = new Map(offlineBuild?.files.map(file => [new URL(file.path, scope).href, file]));
    const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    async function download(file) {
        const url = new URL(file.path, scope).href;
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin', signal: AbortSignal.timeout(60000) }));
        if (!response.ok || response.redirected) throw new Error('Offline download failed: ' + file.path);
        const bytes = await response.arrayBuffer();
        const checked = file.path === 'coi-serviceworker.js'
            ? new TextEncoder().encode(new TextDecoder().decode(bytes).replace(
                'const offlineBuild = ' + JSON.stringify(offlineBuild) + ';', 'const offlineBuild = null;'))
            : bytes;
        if (await digest(checked) !== file.hash) throw new Error('Offline download does not match this build: ' + file.path);
        return new Response(bytes, { status: response.status, headers: response.headers });
    }
    async function prepareOffline() {
        const cache = await caches.open(cacheName);
        const keys = new Set((await cache.keys()).map(request => request.url));
        if (await (await cache.match(readyURL))?.text() === offlineBuild.id && offlineBuild.files.every(file => keys.has(new URL(file.path, scope).href))) return;
        try {
            // Sequential writes bound peak buffering to one asset. Never populate
            // an active build's cache from arbitrary runtime/network requests.
            for (const file of offlineBuild.files) {
                const url = new URL(file.path, scope).href;
                await cache.put(url, await download(file));
            }
            await cache.put(readyURL, new Response(offlineBuild.id));
        } catch (error) {
            // This is only the failed candidate's static-asset cache. Database,
            // snapshots, backend metadata and previous builds remain untouched.
            await caches.delete(cacheName);
            throw error;
        }
    }
    self.addEventListener("install", event => {
        if (offlineBuild) event.waitUntil(prepareOffline());
        else self.skipWaiting();
        // Production updates wait for existing windows to close. Never reload
        // an editor or switch an open page's assets halfway through a build.
    });
    self.addEventListener("activate", event => event.waitUntil((async () => {
        if (offlineBuild) {
            // Retain the current and most recent prior complete shell. Touch only
            // this scope's static caches, never another app's caches or records.
            try {
                const older = (await caches.keys()).filter(name => name.startsWith(cachePrefix) && name !== cacheName);
                const complete = [];
                for (const name of older) if (await (await caches.open(name)).match(readyURL)) complete.push(name);
                for (const name of older) if (name !== complete.at(-1)) await caches.delete(name);
            } catch (error) { console.warn('Obsolete offline files could not be removed.', error); }
        }
        await self.clients.claim();
    })()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === 'offline-status') {
            ev.waitUntil((async () => {
                let ready = false;
                if (offlineBuild && await caches.has(cacheName)) {
                    const cache = await caches.open(cacheName);
                    const keys = new Set((await cache.keys()).map(request => request.url));
                    ready = await (await cache.match(readyURL))?.text() === offlineBuild.id && offlineBuild.files.every(file => keys.has(new URL(file.path, scope).href));
                }
                ev.ports[0]?.postMessage({ ready, build: offlineBuild?.id ?? null });
            })());
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then(clients => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        // Only the same-origin OAuth helper document can communicate with Google's
        // popup. Never weaken headers on the database page or other resources.
        const helper = new URL('drive-auth.html', self.registration.scope);
        const requested = new URL(r.url);
        const isDriveAuth = r.mode === 'navigate' && requested.origin === helper.origin && requested.pathname === helper.pathname;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;
        async function load() {
            if (offlineBuild && r.method === 'GET' && requested.origin === new URL(scope).origin) {
                const url = new URL(r.url);
                url.hash = '';
                if (r.mode === 'navigate' && (url.pathname === new URL(scope).pathname || url.pathname === new URL('index.html', scope).pathname)) {
                    url.href = new URL('index.html', scope).href;
                }
                const file = fileURLs.get(url.href);
                if (file) {
                    try {
                        const cached = await (await caches.open(cacheName)).match(url.href);
                        if (cached) return cached;
                    } catch (error) { console.warn('Offline files could not be read.', error); }
                    try {
                        // Repair evicted files only with this exact build's bytes.
                        // Never mix a newer HTML/public script into the active shell.
                        const response = await download(file);
                        try { await (await caches.open(cacheName)).put(url.href, response.clone()); }
                        catch (error) { console.warn('Offline files could not be saved.', error); }
                        return response;
                    } catch {
                        return new Response('CoffeeOS offline files are unavailable. Reconnect, then close all CoffeeOS windows and reopen to retry. Your saved coffee data has been kept.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                    }
                }
            }
            return fetch(request);
        }
        event.respondWith(
            load()
                .then(async (response) => {
                    // Safari can forward conditional worker requests through the
                    // service worker. Rebuilding a bodyless 304 loses the cached
                    // script, so obtain its full body before adding the headers.
                    if (response.status === 304) {
                        const headers = new Headers(request.headers);
                        headers.delete("If-Modified-Since");
                        headers.delete("If-None-Match");
                        response = await fetch(new Request(request, {
                            headers,
                            cache: "no-store",
                        }));
                    }
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy", isDriveAuth ? 'unsafe-none' :
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!coepCredentialless) {
                        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
                    }
                    newHeaders.set("Cross-Origin-Opener-Policy", isDriveAuth ? 'same-origin-allow-popups' : 'same-origin');

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((error) => { console.error(error); return Response.error(); })
        );
    });

} else {
    if (offlineBuild) {
        (() => {
            let unblock;
            window.coffeeosOfflineStartup = new Promise(resolve => { unblock = resolve; });
            if (window.crossOriginIsolated !== false) unblock();
            const publish = (state, message) => {
                window.coffeeosOffline = { state, message };
                window.dispatchEvent(new CustomEvent('coffeeos-offline-status', { detail: window.coffeeosOffline }));
                if (state === 'unavailable') unblock();
            };
            // Reuse the existing isolation reload marker. Denied session storage
            // or ineffective headers must produce a recoverable state, not a loop.
            const reloadForIsolation = () => {
                if (window.crossOriginIsolated !== false) return;
                try {
                    if (sessionStorage.getItem('coiReloadedBySelf') === 'offline') {
                        publish('unavailable', 'Offline startup could not be enabled. Reload CoffeeOS to retry; your saved data has been kept.');
                        return;
                    }
                    sessionStorage.setItem('coiReloadedBySelf', 'offline');
                    window.location.reload();
                } catch {
                    publish('unavailable', 'Reload CoffeeOS to enable offline use; your saved data has been kept.');
                }
            };
            if (window.crossOriginIsolated) {
                try { if (sessionStorage.getItem('coiReloadedBySelf') === 'offline') sessionStorage.removeItem('coiReloadedBySelf'); }
                catch { /* Opening saved data does not require this reload marker. */ }
            }
            if (!navigator.serviceWorker || !window.isSecureContext) {
                publish('unavailable', 'Offline use is unavailable in this browser.');
                return;
            }
            const status = async registration => {
                if (registration.waiting) {
                    publish('update', 'An update is ready. Close all CoffeeOS windows and reopen to use it.');
                    return;
                }
                if (registration.installing) {
                    publish('preparing', 'Preparing offline use. Keep CoffeeOS open and online.');
                    return;
                }
                const worker = navigator.serviceWorker.controller;
                if (!worker) return;
                const channel = new MessageChannel();
                const timer = setTimeout(() => {
                    channel.port1.close();
                    publish('unavailable', 'Offline use is not ready. Reopen CoffeeOS while online to try again.');
                }, 5000);
                channel.port1.onmessage = event => {
                    clearTimeout(timer);
                    channel.port1.close();
                    publish(event.data.ready ? 'ready' : 'unavailable', event.data.ready
                        ? 'Ready for offline use. Google Drive still needs an internet connection.'
                        : 'Offline use is not ready. Reopen CoffeeOS while online to try again.');
                };
                worker.postMessage({ type: 'offline-status' }, [channel.port2]);
            };
            const watch = registration => {
                const installing = registration.installing;
                if (!installing) return;
                installing.addEventListener('statechange', () => {
                    if (installing.state === 'redundant') {
                        publish('unavailable', 'Offline preparation failed. Keep a backup and reopen CoffeeOS while online to try again.');
                    } else void status(registration);
                });
            };
            publish('preparing', 'Preparing offline use. Keep CoffeeOS open and online.');
            navigator.serviceWorker.register(document.currentScript.src, { updateViaCache: 'none' }).then(registration => {
                watch(registration);
                registration.addEventListener('updatefound', () => { watch(registration); void status(registration); });
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (window.crossOriginIsolated === false) reloadForIsolation();
                    else void status(registration);
                });
                void status(registration);
                // The only automatic reload establishes isolation after the first
                // install. Production updates never skip the waiting lifecycle.
                if (window.crossOriginIsolated === false && registration.active && navigator.serviceWorker.controller) reloadForIsolation();
            }).catch(() => publish('unavailable', 'Offline use is unavailable. Reopen CoffeeOS while online to try again.'));
        })();
    } else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = (reloadedBySelf == "coepdegrade");

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        const controlling = n.serviceWorker && n.serviceWorker.controller;

        // Record the failure if the page is served by serviceWorker.
        if (controlling && !window.crossOriginIsolated) {
            window.sessionStorage.setItem("coiCoepHasFailed", "true");
        }
        const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

        if (controlling) {
            // Reload only on the first failure.
            const reloadToDegrade = coi.coepDegrade() && !(
                coepDegrading || window.crossOriginIsolated
            );
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: (reloadToDegrade || coepHasFailed && coi.coepDegrade())
                    ? false
                    : coi.coepCredentialless(),
            });
            if (reloadToDegrade) {
                !coi.quiet && console.log("Reloading page to degrade COEP.");
                window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
                coi.doReload("coepdegrade");
            }

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // If we're already coi: do nothing. Perhaps it's due to this script doing its job, or COOP/COEP are
        // already set from the origin server. Also if the browser has no notion of crossOriginIsolated, just give up here.
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Firefox private mode) this won't be available
        if (!n.serviceWorker) {
            !coi.quiet && console.error("COOP/COEP Service Worker not registered, perhaps due to private mode.");
            return;
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                    coi.doReload();
                });

                // If the registration is active, but it's not controlling the page
                if (registration.active && !n.serviceWorker.controller) {
                    !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                    coi.doReload();
                }
            },
            (err) => {
                !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
            }
        );
    })();
    }
}

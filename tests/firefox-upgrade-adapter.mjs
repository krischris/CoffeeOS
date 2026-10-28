// Minimal adapter for running the same upgrade assertions in isolated Firefox.
export async function firefoxAdapter() {
const socket = new WebSocket(process.env.FIREFOX_BIDI_URL ?? 'ws://127.0.0.1:9223/session');
await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true});});
let sequence = 0;
const pending = new Map();
const exceptions = [];
const logs = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === 'event') {
    if (message.method === 'log.entryAdded') {
      logs.push(message.params);
      if (message.params.type === 'javascript') exceptions.push(message.params);
    }
    return;
  }
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  clearTimeout(task.timer);
  if (message.type === 'error') task.reject(new Error(JSON.stringify(message)));
  else task.resolve(message.result);
});

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 45_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}


let context, userContext;
return async (path, body, method) => {
  if (path === '/session') {
    await command('session.new', {capabilities:{alwaysMatch:{acceptInsecureCerts:false}}});
    ({userContext} = await command('browser.createUserContext'));
    ({context} = await command('browsingContext.create', {type:'tab', userContext}));
    return {sessionId:'firefox'};
  }
  if (path.endsWith('/window/new')) {
    const created = await command('browsingContext.create', {type:'tab', userContext});
    return {handle:created.context, type:'tab'};
  }
  if (path.endsWith('/window') && method === 'DELETE') {
    await command('browsingContext.close', {context});
    context = undefined;
    return;
  }
  if (path.endsWith('/window')) {
    if (body?.handle) { context = body.handle; return; }
    return context;
  }
  if (method === 'DELETE') {
    await command('browsingContext.close', {context});
    await command('browser.removeUserContext', {userContext});
    await command('session.end'); socket.close(); return;
  }
  if (path.endsWith('/timeouts')) return;
  if (path.endsWith('/url')) return command('browsingContext.navigate', {context, url:body.url, wait:'complete'});
  if (path.endsWith('/refresh')) return command('browsingContext.reload', {context, wait:'complete'});
  const expression = path.endsWith('/execute/async')
    ? `new Promise(resolve => { (function(){${body.script}})(resolve); })`
    : `(function(){${body.script}})()`;
  const result = await command('script.evaluate', {expression:`(async () => JSON.stringify(await (${expression})))()`, target:{context}, awaitPromise:true});
  if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value === undefined ? undefined : JSON.parse(result.result.value);
};
}

const CHANNEL_NAME = 'class-revolution-events-v1';
const STORAGE_KEY = 'class-revolution:last-event.v1';

function makeId() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'evt-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export function createEventBus() {
  const listeners = new Set();
  const seen = new Set();
  const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_NAME) : null;

  function dispatch(event) {
    if (!event || !event.id || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    listeners.forEach(function (listener) {
      try { listener(event); } catch (error) { console.error(error); }
    });
  }

  if (channel) channel.addEventListener('message', function (message) { dispatch(message.data); });
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { dispatch(JSON.parse(event.newValue)); } catch (error) {}
  });

  return {
    publish: function (type, payload) {
      const event = {
        id: makeId(),
        type: type,
        payload: payload || {},
        origin: makeId(),
        createdAt: new Date().toISOString()
      };
      dispatch(event);
      if (channel) channel.postMessage(event);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {}
      return event;
    },
    subscribe: function (listener) {
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    },
    close: function () {
      if (channel) channel.close();
      listeners.clear();
    }
  };
}
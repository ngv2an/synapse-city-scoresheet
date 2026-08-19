/**
 * Sends one scoring run to a Google Sheet through a Google Apps Script Web App.
 *
 * The key detail is in post(): do NOT set a 'Content-Type: application/json' header.
 * A string body is tagged text/plain, which makes this a simple request and skips the
 * preflight. Apps Script only exposes doGet/doPost and cannot answer OPTIONS.
 *
 * Fill in ENDPOINT and SHARED_KEY to match apps-script/Code.gs.
 */
const SheetSubmit = (() => {
  const ENDPOINT = 'PASTE_WEB_APP_URL';
  const SHARED_KEY = 'PASTE_A_LONG_RANDOM_STRING';
  const QUEUE_KEY = 'scoresheet.pendingSubmissions';

  function isConfigured() {
    return ENDPOINT.indexOf('https://script.google.com/') === 0;
  }

  // crypto.randomUUID only exists in a secure context, and a competition venue often
  // serves over plain http on a LAN IP. The id still has to be stable to block duplicates.
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'sub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function readQueue() {
    try {
      const raw = JSON.parse(localStorage.getItem(QUEUE_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      return true;
    } catch (err) {
      // localStorage is full, almost always from base64 photos. Drop them, keep the scores.
      try {
        const lighter = queue.map((item) => Object.assign({}, item, { photoBase64: '' }));
        localStorage.setItem(QUEUE_KEY, JSON.stringify(lighter));
        return true;
      } catch (err2) {
        return false;
      }
    }
  }

  async function post(payload) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ key: SHARED_KEY }, payload)),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'unknown');
    return data;
  }

  /**
   * Sends immediately. On a network error the run is queued and the error is rethrown.
   * submissionId is fixed per run, so any number of retries still produces one row.
   */
  async function submit(payload) {
    if (!isConfigured()) {
      throw new Error('ENDPOINT is not set in submit.js');
    }

    const item = Object.assign(
      { submissionId: newId(), userAgent: navigator.userAgent },
      payload
    );

    try {
      return await post(item);
    } catch (err) {
      writeQueue(readQueue().concat([item]));
      throw err;
    }
  }

  /** Pushes whatever is still stuck in the queue. Returns how many went through. */
  async function flush() {
    if (!isConfigured()) return 0;

    const queue = readQueue();
    if (!queue.length) return 0;

    const failed = [];
    let sent = 0;

    for (const item of queue) {
      try {
        await post(item);
        sent += 1;
      } catch (err) {
        failed.push(item);
      }
    }

    writeQueue(failed);
    return sent;
  }

  return {
    submit,
    flush,
    isConfigured,
    pending: () => readQueue().length,
  };
})();

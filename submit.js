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
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbyFo41U6Hg2bMGknSf9ZtDqYUa6ARHv5wNGWqcN1k7dweK1Eo_OyMWVlUpAyVeGEyWvkQ/exec';
  const SHARED_KEY = '5Utxx6W06WnkEPHIbJYqr3uNBTB9ryeA';
  const QUEUE_KEY = 'scoresheet.pendingSubmissions';
  const RETRIES = 2;
  const RETRY_DELAY = 900;

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

  /**
   * Apps Script answers a POST with a 302 to a one-shot script.googleusercontent.com URL
   * carrying the reply. Safari on iOS reaches that URL and gets a 404 every time, while
   * Chrome on desktop reads it fine — but the sheet gets the row either way, because the
   * key in that URL is only minted after doPost has finished. Landing there at all proves
   * the run executed. Losing the reply is not losing the write.
   *
   * A 404 straight from script.google.com/macros/s/.../exec is a different matter — that
   * is a wrong or undeployed endpoint and must stay an error. res.url tells them apart
   * because it holds the final URL after redirects.
   */
  function isLostReply(res) {
    return res.url.indexOf('googleusercontent.com') !== -1;
  }

  async function post(payload) {
    let res;

    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ key: SHARED_KEY }, payload)),
      });
    } catch (err) {
      // fetch only rejects at the transport layer: offline, DNS, or a CORS block.
      // Opening the page over file:// lands here too.
      throw new Error('cannot reach server (offline, or page not served over http) — ' + err.message);
    }

    if (!res.ok) {
      if (isLostReply(res)) return { ok: true, unconfirmed: true };
      throw new Error('server returned HTTP ' + res.status);
    }

    // Read as text first: Apps Script sometimes answers with an HTML error page, and
    // res.json() would then fail with a parse error that hides what actually came back.
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      if (isLostReply(res)) return { ok: true, unconfirmed: true };
      throw new Error('reply was not JSON — ' + raw.slice(0, 60).replace(/\s+/g, ' '));
    }

    if (!data.ok) throw new Error(data.error || 'unknown');
    return data;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Apps Script answers a POST with a 302 to a one-shot user_content_key URL, and that
   * second hop intermittently 404s — the row is already written by then, so the write
   * succeeded while the reply is lost. Retrying the same submissionId is free: the server
   * dedupes it and answers from cache instead of appending, which is both fast and
   * reliable. So a retry is really a confirmation that the row landed.
   */
  async function postWithRetry(item) {
    let lastErr;

    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAY * attempt);

      try {
        const data = await post(item);
        if (attempt > 0) data.viaRetry = true;
        return data;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr;
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
      return await postWithRetry(item);
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
        await postWithRetry(item);
        sent += 1;
      } catch (err) {
        failed.push(item);
      }
    }

    writeQueue(failed);
    return sent;
  }

  /** Fetches the Config tab of the target Sheet: competition name, date, round times, level, judges, teams */
  async function fetchMetadata(sheetId) {
    if (!isConfigured()) return { ok: false, error: 'Endpoint not configured' };
    const query = sheetId ? `?sheetId=${encodeURIComponent(sheetId)}` : '';
    const res = await fetch(ENDPOINT + query);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.text();
    return JSON.parse(raw);
  }

  return {
    submit,
    flush,
    fetchMetadata,
    isConfigured,
    pending: () => readQueue().length,
  };
})();

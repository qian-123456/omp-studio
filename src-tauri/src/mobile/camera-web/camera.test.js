import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { waitFor } from '@testing-library/dom';
import { afterEach, describe, expect, it } from 'vitest';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./camera.js', import.meta.url), 'utf8');
const token = 'a'.repeat(43);
const windows = [];

// jsdom does not decode images or implement canvas. Keep the actual page and
// event handlers, replacing only those browser image APIs and the LAN server.
function openPage(post, statusCode = 200, options = {}) {
  const dom = new JSDOM(html, {
    url: `http://192.168.1.2/camera#token=${token}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  windows.push(window);
  window.document.documentElement.lang = 'en-US';
  window.URL.createObjectURL = () => 'blob:camera-test';
  window.URL.revokeObjectURL = () => {};
  window.Image = class {
    naturalWidth = 16;
    naturalHeight = 16;
    set src(_value) { queueMicrotask(() => this.onload?.()); }
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4) }) });
  window.jsQR = () => options.qrResult || null;
  window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new window.Blob(['jpeg'], { type: 'image/jpeg' }));
  if (options.storage) {
    const rows = options.storage;
    const db = {
      transaction() {
        const tx = {};
        tx.objectStore = () => {
          const request = (operation) => {
            const result = {};
            queueMicrotask(() => { result.result = operation(); tx.oncomplete?.(); });
            return result;
          };
          return {
            getAll: () => request(() => [...rows.values()]),
            put: (value) => request(() => { rows.set(value.id, { ...value }); }),
            delete: (id) => request(() => rows.delete(id)),
          };
        };
        return tx;
      },
      close() {},
    };
    window.indexedDB = { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } };
  }
  const received = new Map();
  const requests = [];
  const statuses = [];
  window.fetch = async (url, requestOptions = {}) => {
    if (String(url) === '/camera/status') {
      statuses.push(requestOptions.headers.Authorization);
      const code = options.statusCode ? options.statusCode() : statusCode;
      if (code === 'offline') throw new Error('offline');
      if (code !== 200) return { ok: false, status: code };
      return { ok: true, status: 200, json: async () => ({ state: 'connected', captureId: options.captureId ? options.captureId() : 'capture-one', expiresAt: options.expiresAt, photos: [...received.values(), ...(options.serverPhotos || [])] }) };
    }
    const id = String(url).split('/').pop();
    requests.push({ id, options: requestOptions });
    const result = await post(id, requests.length);
    if (result) received.set(id, { id, state: result });
    return { ok: true, status: 200, json: async () => ({ id, state: result }) };
  };
  window.eval(script);
  const document = window.document;
  const until = (assertion) => waitFor(assertion, { container: document });
  const photos = () => document.querySelectorAll('#photos img');
  const upload = document.querySelector('#upload');
  async function choose(canUpload = true) {
    const input = document.querySelector('#library-input');
    await until(() => expect(input.disabled).toBe(false));
    expect(input.multiple).toBe(true);
    const files = [new window.File(['one'], 'one.png', { type: 'image/png' }), new window.File(['two'], 'two.png', { type: 'image/png' })];
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => {
      expect(photos()).toHaveLength(2);
      expect(upload.disabled).toBe(!canUpload);
    });
  }
  return { document, window, requests, statuses, photos, upload, until, choose };
}

afterEach(() => {
  for (const window of windows.splice(0)) window.close();
});

describe('QR renewal', () => {
  it('opens guidance and camera chooser synchronously without uploading or navigating', async () => {
    const page = openPage(async () => 'received');
    await page.choose();
    const input = page.document.querySelector('#qr-input');
    let clicks = 0;
    input.click = () => { clicks++; };
    const href = page.window.location.href;
    page.document.querySelector('#reconnect').click();
    expect(clicks).toBe(1);
    expect(page.document.querySelector('#recovery').open).toBe(true);
    expect(page.document.querySelector('#recovery').textContent).toMatch(/computer.*Reconnect.*photograph/is);
    expect(page.document.activeElement).not.toBe(page.document.querySelector('#recovery-url'));
    expect(page.requests).toHaveLength(0);
    expect(page.window.location.href).toBe(href);
    expect(page.photos()).toHaveLength(2);
  });

  it('renews with a QR without adding it to the queue or cache', async () => {
    const storage = new Map(), nextToken = 'b'.repeat(43);
    const page = openPage(async () => 'received', 200, { storage, qrResult: { data: `http://192.168.1.2/camera#token=${nextToken}` } });
    await page.choose();
    await page.until(() => expect(storage.size).toBe(2));
    const savedIds = [...storage.keys()];
    const input = page.document.querySelector('#qr-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [new page.window.File(['qr'], 'qr.png', { type: 'image/png' })] });
    input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await page.until(() => expect(page.statuses).toContain(`Bearer ${nextToken}`));
    await page.until(() => expect(page.upload.disabled).toBe(false));
    expect(page.photos()).toHaveLength(2);
    expect([...storage.keys()]).toEqual(savedIds);
    expect(page.requests).toHaveLength(0);
    expect(page.window.sessionStorage.getItem('phone-camera-token')).toBe(nextToken);
  });

  it('leaves credentials and photos intact for invalid QR and cancellation', async () => {
    const storage = new Map();
    const page = openPage(async () => 'received', 200, { storage, qrResult: { data: `http://evil.example/camera#token=${'b'.repeat(43)}` } });
    await page.choose();
    await page.until(() => expect(storage.size).toBe(2));
    const input = page.document.querySelector('#qr-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [new page.window.File(['qr'], 'qr.png', { type: 'image/png' })] });
    input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await page.until(() => expect(page.document.querySelector('#qr-status').textContent).toMatch(/invalid link/i));
    expect(page.window.sessionStorage.getItem('phone-camera-token')).toBe(token);
    expect(page.photos()).toHaveLength(2);
    expect(storage.size).toBe(2);
    Object.defineProperty(input, 'files', { configurable: true, value: [] });
    input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    expect(page.photos()).toHaveLength(2);
    expect(page.window.sessionStorage.getItem('phone-camera-token')).toBe(token);
  });
  it('reports an ordinary photo without replacing the token or staged photos', async () => {
    const page = openPage(async () => 'received');
    await page.choose();
    const input = page.document.querySelector('#qr-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [new page.window.File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await page.until(() => expect(page.document.querySelector('#qr-status').textContent).toMatch(/could not read/i));
    expect(page.window.sessionStorage.getItem('phone-camera-token')).toBe(token);
    expect(page.photos()).toHaveLength(2);
  });
});

describe('phone camera batch page', () => {
  it('retries an offline connection with the same token without reloading', async () => {
    let code = 'offline';
    const page = openPage(async () => 'received', 200, { statusCode: () => code });
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/lost/i));
    page.document.querySelector('#reconnect').click();
    const button = page.document.querySelector('#retry-connection');
    expect(button.textContent).toBe('Retry current connection');
    code = 200;
    button.click();
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/connected/i));
    expect(page.statuses).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
  });

  it('opens renewal guidance after known expiry without dropping staged photos or contacting a closed listener', async () => {
    const page = openPage(async () => 'received', 200, { expiresAt: new Date(Date.now() - 1).toISOString() });
    await page.choose();
    page.document.querySelector('#retry-connection').click();
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/expired/i));
    let clicks = 0;
    page.document.querySelector('#qr-input').click = () => { clicks++; };
    page.document.querySelector('#reconnect').click();
    expect(clicks).toBe(1);
    expect(page.document.activeElement).not.toBe(page.document.querySelector('#recovery-url'));
    expect(page.document.querySelector('#recovery').open).toBe(true);
    expect(page.photos()).toHaveLength(2);
    expect(page.upload.disabled).toBe(true);
    expect(page.statuses).toEqual([`Bearer ${token}`]);
    expect(page.document.querySelector('#connection').textContent).toMatch(/expired/i);
  });

  it('rejects cross-origin recovery links and reconnects an expired capture without resending received photos', async () => {
    let code = 200;
    const page = openPage(async (_id, count) => {
      if (count === 2) throw new Error('offline');
      return 'received';
    }, 200, { statusCode: () => code });
    await page.choose();
    page.upload.click();
    await page.until(() => expect(page.requests).toHaveLength(2));
    await page.until(() => expect(page.upload.disabled).toBe(false));
    const [confirmed, pending] = page.requests.map(({ id }) => id);
    code = 410;
    page.document.querySelector('#reconnect').click();
    page.document.querySelector('#retry-connection').click();
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/expired/i));
    const form = page.document.querySelector('#recovery-form');
    const input = page.document.querySelector('#recovery-url');
    const submit = () => form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
    const nextToken = 'b'.repeat(43);
    const before = page.statuses.length;
    input.value = `http://evil.example/camera#token=${nextToken}`;
    submit();
    expect(page.document.querySelector('#qr-status').textContent).toMatch(/invalid link/i);
    expect(page.statuses).toHaveLength(before);
    code = 200;
    input.value = `http://192.168.1.2/camera#token=${nextToken}`;
    submit();
    await page.until(() => expect(page.statuses).toContain(`Bearer ${nextToken}`));
    await page.until(() => expect(page.upload.disabled).toBe(false));
    expect(input.value).toBe('');
    page.upload.click();
    await page.until(() => expect(page.requests).toHaveLength(3));
    expect(page.requests.map(({ id }) => id)).toEqual([confirmed, pending, pending]);
  });

  it('recovers same-capture cached photos in a new tab and reconciles server receipts', async () => {
    const storage = new Map();
    const first = openPage(async (_id, count) => {
      if (count === 2) throw new Error('offline');
      return 'received';
    }, 200, { storage });
    await first.choose();
    first.upload.click();
    await first.until(() => expect(first.requests).toHaveLength(2));
    await first.until(() => expect(first.upload.disabled).toBe(false));
    const [confirmed, pending] = first.requests.map(({ id }) => id);
    const next = openPage(async () => 'received', 200, { storage, serverPhotos: [{ id: confirmed, state: 'received' }] });
    await next.until(() => expect(next.upload.disabled).toBe(false));
    expect(next.photos()).toHaveLength(2);
    expect(next.requests).toHaveLength(0);
    next.upload.click();
    await next.until(() => expect(next.requests).toHaveLength(1));
    expect(next.requests[0].id).toBe(pending);
    expect([...storage.values()].every((row) => !('token' in row) && row.captureId === 'capture-one')).toBe(true);
  });
  it('does not bind photos staged before any status to a replacement token', async () => {
    let code = 'offline';
    const page = openPage(async () => 'received', 200, { statusCode: () => code });
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/lost/i));
    await page.choose(false);
    code = 410;
    page.document.querySelector('#reconnect').click();
    await page.until(() => expect(page.document.querySelector('#recovery').open).toBe(true));
    code = 200;
    page.document.querySelector('#recovery-url').value = `http://192.168.1.2/camera#token=${'b'.repeat(43)}`;
    page.document.querySelector('#recovery-form').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/connected/i));
    expect(page.upload.disabled).toBe(true);
    expect([...page.document.querySelectorAll('#photos button')].filter((button) => button.textContent === 'Transfer to current connection')).toHaveLength(2);
    expect(page.requests).toHaveLength(0);
  });


  it('requires explicit transfer for other captures and never transfers received or failed rows', async () => {
    const storage = new Map([
      ['pending', { id: 'pending', batch: 'old', captureId: 'old', blob: new Blob(['a']), state: 'ready' }],
      ['received', { id: 'received', batch: 'old', captureId: 'old', blob: new Blob(['b']), state: 'received' }],
      ['failed', { id: 'failed', batch: 'old', captureId: 'old', blob: new Blob(['c']), state: 'failed' }],
    ]);
    const page = openPage(async () => 'received', 200, { storage });
    page.window.confirm = () => true;
    await page.until(() => expect(page.photos()).toHaveLength(3));
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/connected/i));
    expect(page.upload.disabled).toBe(true);
    const transfers = [...page.document.querySelectorAll('#photos button')].filter((button) => button.textContent === 'Transfer to current connection');
    expect(transfers).toHaveLength(1);
    transfers[0].click();
    await page.until(() => expect(page.upload.disabled).toBe(false));
    page.upload.click();
    await page.until(() => expect(page.requests).toHaveLength(1));
    expect(page.requests[0].id).toBe('pending');
  });

  it('keeps storage failures visible while secondary instructions can be expanded', async () => {
    const page = openPage(async () => 'received');
    const help = page.document.querySelector('.help:not(#recovery)');
    await page.until(() => expect(page.document.querySelector('#library-input').disabled).toBe(false));
    const warning = page.document.querySelector('#storage-status');
    expect(warning.hidden).toBe(false);
    expect(warning.closest('details')).toBeNull();
    expect(help.open).toBe(false);
    help.querySelector('summary').click();
    await page.until(() => expect(help.open).toBe(true));
  });

  it('retains capture and saving after the connection expires without uploading', async () => {
    const page = openPage(async () => 'received', 410);
    await page.until(() => expect(page.document.querySelector('#connection').textContent).toMatch(/expired/i));
    await page.choose(false);
    expect(page.photos()).toHaveLength(2);
    expect(page.document.querySelectorAll('#photos a[download]')).toHaveLength(2);
    expect(page.requests).toHaveLength(0);
    expect(page.upload.disabled).toBe(true);
  });

  it('keeps both selections until one action uploads each photo sequentially', async () => {
    const { promise: first, resolve: releaseFirst } = Promise.withResolvers();
    const page = openPage(async (_id, count) => {
      if (count === 1) await first;
      return 'received';
    });
    await page.choose();
    await page.until(() => expect(page.document.querySelector('#storage-status').textContent).toMatch(/storage.*(?:unavailable|failed)/i));
    expect(page.document.querySelector('#storage-status').textContent).toMatch(/(?:refresh|closing)/i);
    expect(page.requests).toHaveLength(0);
    page.upload.click();
    await page.until(() => expect(page.requests).toHaveLength(1));
    expect(page.requests[0].options.method).toBe('POST');
    expect(page.photos()).toHaveLength(2);
    releaseFirst();
    await page.until(() => expect(page.requests).toHaveLength(2));
    expect(page.requests[1].options.method).toBe('POST');
    expect(page.requests[0].id).not.toBe(page.requests[1].id);
    expect(page.requests.every(({ options }) => options.body.type === 'image/jpeg')).toBe(true);
  });

  it('preserves the interrupted photo and retries it without resending the confirmed one', async () => {
    const page = openPage(async (_id, count) => {
      if (count === 2) throw new Error('connection interrupted');
      return 'received';
    });
    await page.choose();
    page.upload.click();
    await page.until(() => {
      expect(page.requests).toHaveLength(2);
      expect(page.upload.disabled).toBe(false);
    });
    expect(page.photos()).toHaveLength(2);
    expect(page.document.querySelectorAll('#photos a[download]').length).toBeGreaterThan(0);
    const [confirmed, interrupted] = page.requests.map(({ id }) => id);
    expect(confirmed).not.toBe(interrupted);
    page.upload.click();
    await page.until(() => expect(page.requests).toHaveLength(3));
    expect(page.requests.map(({ id }) => id)).toEqual([confirmed, interrupted, interrupted]);
  });

  it('removes one unsent photo without discarding the other', async () => {
    const page = openPage(async () => 'received');
    await page.choose();
    const remove = page.document.querySelector('#photos button');
    expect(remove).not.toBeNull();
    remove.click();
    await page.until(() => expect(page.photos()).toHaveLength(1));
    expect(page.requests).toHaveLength(0);
    page.upload.click();
    await page.until(() => expect(page.requests).toHaveLength(1));
  });
});

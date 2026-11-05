(() => {
  'use strict';

  const messages = {
    'zh-CN': {
      title: '手机拍照', helpTitle: '使用说明',
      networkNotice: '仅在可信 Wi-Fi 使用 · 传输未加密',
      browserNotice: '连接最多持续 10 分钟。断线可点重新连接；到期请在电脑续期并扫码，或粘贴新链接。旧版随机端口或 IP 变化时，须先保存照片并打开新页面。',
      chooseTitle: '添加照片', chooseDescription: '可多次拍照或从相册多选。照片转换为 JPEG 并移除位置信息；点击上传前不会传输。',
      takePhoto: '拍照', choosePhoto: '从相册选择', batchTitle: '照片列表', upload: '上传待处理照片',
      limits: '每次连接最多 20 张、合计 200 MiB；原图最多 40 MiB，转换后每张最多 20 MiB。超过连接上限的照片会保留在此处供保存。',
      progress: (n, total) => `本次上传处理第 ${n} / ${total} 张`,
      connecting: '正在连接电脑…', connected: '已连接电脑', offline: '连接中断，请检查网络；未完成照片可保存到手机。',
      ended: '连接已过期或结束，请在电脑续期后重新连接。', missingToken: '链接无效，请使用电脑提供的新链接。',
      storageOK: '照片暂存在当前浏览器地址；同地址新扫码可恢复本次照片。电脑确认加入后清除缓存，浏览器也可能清理缓存。',
      storageNo: '缓存不可用或保存失败。请勿刷新或关闭页面，先将照片保存到手机。',
      preparing: '正在处理照片…', ready: '待上传', uploading: '正在上传…', received: '电脑已收到，正在加入待发送区。', attached: '已加入电脑待发送区。',
      failed: '电脑未能加入照片，请在电脑上重试。', uploadError: '上传未确认，可使用相同照片编号重试；也可保存到手机。',
      old: '来自其他或未知连接；请先保存，或确认转移待上传照片。', remove: '删除', save: '保存到手机', previewAlt: '照片预览',
      reconnect: '重新连接', recoveryTitle: '连接恢复', recoveryLabel: '粘贴电脑的新完整链接', recoverySubmit: '连接',
      recoveryHelp: '在电脑点击“重新连接”，然后拍摄新二维码。旧版随机端口或 IP 变化时，请先逐张保存照片。',
      photographQr: '拍摄电脑二维码', retryConnection: '重试当前连接', pasteTitle: '改用粘贴链接',
      qrReading: '正在读取二维码…', qrError: '无法读取二维码。请对准电脑上的新二维码重新拍摄，或粘贴链接。',
      qrLarge: '二维码照片超过 20 MiB，请重新拍摄。', qrUnavailable: '无法打开二维码相机，请使用下方按钮重试或粘贴链接。',
      invalidLink: '链接无效：请使用同一地址的完整拍照链接。', transfer: '转移到当前连接',
      transferConfirm: '将此待上传照片转移到当前草稿？已收到或失败的照片不会自动重传；请在电脑检查原草稿，避免重复。',
      tooLarge: '原照片超过 40 MiB。', outputTooLarge: '处理后的照片超过 20 MiB。', decodeError: '无法处理此照片，请选择 JPEG 或 PNG。',
      limit: '电脑正忙，或已达到本次连接的数量或容量限制。未上传的照片仍在此处，可重试或逐张保存。', conflict: '照片编号冲突，无法上传；请保存照片。', unsupported: '浏览器无法安全生成照片编号。',
      tokenStorage: '连接未能暂存，请勿刷新页面。',
      summary: (n, size) => `${n} 张待处理 · ${size} MiB`, skipped: (name, reason) => `${name}：${reason}`,
      completed: (n) => `已加入电脑 ${n} 张`,
    },
    'en-US': {
      title: 'Phone camera', helpTitle: 'How it works',
      networkNotice: 'Trusted Wi-Fi only · Transfer is not encrypted',
      browserNotice: 'Connections last at most 10 minutes. Retry a disconnect; after expiry renew on the computer and scan or paste the new link. For legacy random ports or an IP change, save photos before opening the new page.',
      chooseTitle: 'Add photos', chooseDescription: 'Take photos repeatedly or select multiple from your library. Photos are converted to JPEG with location metadata removed; nothing uploads until you choose upload.',
      takePhoto: 'Take photo', choosePhoto: 'Choose from library', batchTitle: 'Photos', upload: 'Upload pending photos',
      limits: 'Up to 20 photos and 200 MiB per connection; originals up to 40 MiB, converted photos up to 20 MiB each. Photos beyond the connection limit remain here to save.',
      progress: (n, total) => `Processing upload ${n} of ${total}`,
      connecting: 'Connecting to your computer…', connected: 'Connected to your computer', offline: 'Connection lost. Check your network or save unfinished photos to your phone.',
      ended: 'Connection expired or ended. Renew on your computer to reconnect.', missingToken: 'Invalid link. Use the new link from your computer.',
      storageOK: 'Photos are cached at this browser address; a new scan at the same address can recover this capture. Confirmed copies are removed, and the browser may evict the cache.',
      storageNo: 'Browser storage is unavailable or saving failed. Do not refresh or close this page; save photos to your phone first.',
      preparing: 'Preparing photos…', ready: 'Pending upload', uploading: 'Uploading…', received: 'Received by your computer; adding to the draft…', attached: 'Added to your computer’s draft.',
      failed: 'The computer could not add the photo. Retry on your computer.', uploadError: 'Upload not confirmed. Retry with the same photo ID or save it to your phone.',
      old: 'From another or unknown connection; save it or confirm transfer of pending photos.', remove: 'Delete', save: 'Save to phone', previewAlt: 'Photo preview',
      reconnect: 'Reconnect', recoveryTitle: 'Connection recovery', recoveryLabel: 'Paste the full new link from your computer', recoverySubmit: 'Connect',
      recoveryHelp: 'On your computer, select Reconnect, then photograph the new QR code. For a legacy port or changed IP, save each photo first.',
      photographQr: 'Photograph computer QR', retryConnection: 'Retry current connection', pasteTitle: 'Paste a link instead',
      qrReading: 'Reading QR code…', qrError: 'Could not read a QR code. Photograph the new code on your computer again, or paste the link.',
      qrLarge: 'QR photo exceeds 20 MiB. Please photograph it again.', qrUnavailable: 'Could not open the QR camera. Retry below or paste the link.',
      invalidLink: 'Invalid link: use the full camera link for this same address.', transfer: 'Transfer to current connection',
      transferConfirm: 'Transfer this pending photo to the current draft? Received or failed photos are not automatically retransmitted; check the original draft to avoid duplicates.',
      tooLarge: 'The original photo exceeds 40 MiB.', outputTooLarge: 'The processed photo exceeds 20 MiB.', decodeError: 'Cannot process this photo. Choose a JPEG or PNG.',
      limit: 'The computer is busy, or this connection has reached its count or size limit. Unsent photos remain here; retry or save them individually.', conflict: 'Photo ID conflict; save the photo instead.', unsupported: 'This browser cannot securely generate a photo ID.',
      tokenStorage: 'Connection could not be saved. Do not refresh this page.',
      summary: (n, size) => `${n} unfinished photos · ${size} MiB`, skipped: (name, reason) => `${name}: ${reason}`,
      completed: (n) => `${n} added to your computer`,
    }
  };
  const t = messages[document.documentElement.lang === 'en-US' ? 'en-US' : 'zh-CN'];
  const byId = (id) => document.getElementById(id);
  const connection = byId('connection'), storageStatus = byId('storage-status'), error = byId('error');
  const cameraInput = byId('camera-input'), libraryInput = byId('library-input');
  const photosNode = byId('photos'), summary = byId('summary'), progress = byId('progress'), upload = byId('upload');
  const recovery = byId('recovery'), recoveryUrl = byId('recovery-url');
  const qrInput = byId('qr-input'), qrStatus = byId('qr-status'), photographQr = byId('photograph-qr');
  const reconnect = byId('reconnect'), retryConnection = byId('retry-connection'), recoverySubmit = byId('recovery-submit');
  document.querySelectorAll('[data-text]').forEach((node) => { node.textContent = t[node.dataset.text]; });
  document.title = t.title;

  const storageKey = 'phone-camera-token', batchKey = 'phone-camera-batch';
  let token = '', batch = '', tokenWarning = false;
  const candidate = new URLSearchParams(location.hash.slice(1)).get('token');
  if (candidate && /^[A-Za-z0-9_-]{43}$/.test(candidate)) token = candidate;
  try {
    batch = uuid();
    if (location.hash) {
      sessionStorage.removeItem(storageKey);
      if (token) sessionStorage.setItem(storageKey, token);
      sessionStorage.setItem(batchKey, batch);
    } else {
      token = sessionStorage.getItem(storageKey) || '';
      batch = sessionStorage.getItem(batchKey) || batch;
      sessionStorage.setItem(batchKey, batch);
    }
  } catch (_) { tokenWarning = true; }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  let db = null, storageFailed = false, busy = true, ended = !token, polling = false, pollTimer, captureId = '';
  let generation = 0, reconciled = false, pollAgain = false, expiresAt = Infinity, pollController = null, qrBusy = false;
  const photos = [];
  const completed = new Set();
  const MiB = 1024 * 1024;
  function setConnection(message, isError = false) {
    connection.textContent = message;
    connection.classList.toggle('error-state', isError);
  }
  function showError(message = '') { error.textContent = message; error.hidden = !message; }
  function showQrStatus(message = '', isError = false) {
    qrStatus.textContent = message; qrStatus.hidden = !message; qrStatus.classList.toggle('error-state', isError);
  }
  function storageNotice() {
    storageStatus.hidden = !storageFailed && !tokenWarning;
    storageStatus.textContent = [storageFailed ? t.storageNo : '', tokenWarning ? t.tokenStorage : ''].filter(Boolean).join(' ');
  }
  function openStorage() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('phone-camera', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
  }
  function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      const request = action(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function persist(photo) {
    if (!db) return;
    try { await transaction('readwrite', (store) => store.put({ id: photo.id, batch: photo.batch, captureId: photo.captureId, blob: photo.blob, state: photo.state })); }
    catch (_) { storageFailed = true; storageNotice(); }
  }
  async function forget(photo) {
    if (!db) return true;
    try { await transaction('readwrite', (store) => store.delete(photo.id)); return true; }
    catch (_) { storageFailed = true; storageNotice(); return false; }
  }
  function uuid() {
    const bytes = new Uint8Array(16);
    if (!window.crypto || !window.crypto.getRandomValues) throw new Error('random');
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function decode(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      image.src = url;
    });
  }
  function jpeg(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob && blob.type === 'image/jpeg' ? resolve(blob) : reject(new Error('decode')), 'image/jpeg', 0.9));
  }
  function render() {
    if (!busy) progress.textContent = completed.size ? t.completed(completed.size) : '';
    photosNode.replaceChildren();
    summary.textContent = t.summary(photos.length, (photos.reduce((sum, p) => sum + p.blob.size, 0) / MiB).toFixed(1));
    for (const photo of photos) {
      const card = document.createElement('article'); card.className = 'photo-card';
      const image = document.createElement('img'); image.src = photo.url; image.alt = t.previewAlt;
      const details = document.createElement('div'); details.className = 'photo-details';
      const status = document.createElement('p'); status.className = 'photo-status';
      const sameCapture = captureId && photo.captureId === captureId;
      status.textContent = !sameCapture ? t.old : (t[photo.state] || t.ready) + (photo.detail ? ` ${photo.detail}` : '');
      const actions = document.createElement('div'); actions.className = 'photo-actions';
      const save = document.createElement('a'); save.className = 'button secondary'; save.href = photo.url; save.download = `photo-${photo.id}.jpg`; save.textContent = t.save;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button secondary'; remove.textContent = t.remove; remove.disabled = busy || qrBusy;
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        if (await forget(photo)) { const index = photos.indexOf(photo); if (index >= 0) { photos.splice(index, 1); URL.revokeObjectURL(photo.url); } render(); }
        else { showError(t.storageNo); remove.disabled = false; }
      });
      actions.append(save, remove);
      if (!sameCapture && captureId && ['ready', 'uploadError'].includes(photo.state)) {
        const transfer = document.createElement('button'); transfer.type = 'button'; transfer.className = 'button secondary'; transfer.textContent = t.transfer; transfer.disabled = busy || qrBusy || ended;
        transfer.addEventListener('click', async () => {
          if (!window.confirm(t.transferConfirm)) return;
          photo.captureId = captureId; photo.batch = batch; photo.state = 'ready'; await persist(photo); render();
        });
        actions.append(transfer);
      }
      details.append(status, actions); card.append(image, details); photosNode.append(card);
    }
    cameraInput.disabled = libraryInput.disabled = busy || qrBusy;
    document.querySelectorAll('label.button').forEach((label) => label.setAttribute('aria-disabled', String(busy || qrBusy)));
    reconnect.disabled = photographQr.disabled = recoverySubmit.disabled = busy || qrBusy;
    qrInput.disabled = busy || qrBusy;
    retryConnection.disabled = busy || qrBusy || ended || !token;
    photographQr.textContent = qrBusy ? t.qrReading : t.photographQr;
    upload.disabled = busy || qrBusy || ended || !captureId || !reconciled || !photos.some((p) => p.captureId === captureId && (p.state === 'ready' || p.state === 'uploadError'));
  }
  function endConnection(message) {
    ended = true; clearTimeout(pollTimer);
    try { sessionStorage.removeItem(storageKey); } catch (_) { /* Credentials may not have been stored. */ }
    recovery.open = true; setConnection(message, true); render();
  }
  async function selectPhotos(event) {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length || busy) return;
    busy = true; render(); showError();
    const errors = [];
    for (const file of files) {
      try {
        if (file.size > 40 * MiB) throw new Error('tooLarge');
        const id = uuid(), image = await decode(file);
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('decodeError');
        const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d'); if (!context) throw new Error('decodeError');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await jpeg(canvas);
        if (blob.size > 20 * MiB) throw new Error('outputTooLarge');
        const photo = { id, batch, captureId, blob, state: 'ready', url: URL.createObjectURL(blob) };
        photos.push(photo); render(); await persist(photo);
      } catch (err) { errors.push(t.skipped(file.name, t[err.message] || (err.message === 'random' ? t.unsupported : t.decodeError))); }
    }
    busy = false; render(); if (errors.length) showError(errors.join('\n'));
  }
  async function updatePhoto(photo, state, detail) {
    if (!photos.includes(photo) || photo.state === 'attached') return;
    photo.state = state; photo.detail = detail || '';
    if (state === 'attached') {
      // Keep the in-memory copy if deleting the persisted copy fails.
      if (await forget(photo)) { const index = photos.indexOf(photo); if (index >= 0) photos.splice(index, 1); URL.revokeObjectURL(photo.url); }
    } else if (state === 'received' || state === 'failed') await persist(photo);
    render();
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (ended || document.hidden) return;
    if (Date.now() >= expiresAt) { endConnection(t.ended); return; }
    if (polling) { pollAgain = true; return; }
    polling = true;
    const requestGeneration = generation;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    pollController = controller;
    try {
      const response = await fetch('/camera/status', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
      if (requestGeneration !== generation) return;
      if (response.status === 401 || response.status === 410) { endConnection(t.ended); return; }
      if (!response.ok) throw new Error('status');
      const status = await response.json();
      if (requestGeneration !== generation) return;
      if (status.state === 'expired' || status.state === 'stopped') { endConnection(t.ended); return; }
      if (typeof status.captureId !== 'string' || !status.captureId) throw new Error('status');
      expiresAt = Date.parse(status.expiresAt) || Infinity;
      if (captureId !== status.captureId) reconciled = false;
      captureId = status.captureId;
      for (const photo of photos) {
        if (!photo.captureId && photo.batch === batch) { photo.captureId = captureId; await persist(photo); }
        if (requestGeneration !== generation) return;
      }
      setConnection(t.connected);
      if (Array.isArray(status.photos)) {
        for (const item of status.photos) {
          if (item.state === 'attached') completed.add(item.id);
          const photo = photos.find((p) => p.id === item.id && p.captureId === captureId);
          if (photo && ['received', 'attached', 'failed'].includes(item.state)) await updatePhoto(photo, item.state, item.error);
          if (requestGeneration !== generation) return;
        }
      }
      reconciled = true;
      render();
    } catch (_) { if (!ended && requestGeneration === generation && !pollAgain) setConnection(t.offline, true); }
    finally {
      clearTimeout(timeout); polling = false; if (pollController === controller) pollController = null;
      if (!ended && !document.hidden) pollTimer = setTimeout(poll, pollAgain || requestGeneration !== generation ? 0 : 1000);
      pollAgain = false;
    }
  }
  async function sendPhotos() {
    if (busy || ended || !captureId || !reconciled) return;
    busy = true; showError(); render();
    const pending = photos.filter((p) => p.captureId === captureId && ['ready', 'uploadError'].includes(p.state));
    let current = 0;
    for (const photo of pending) {
      if (ended) break;
      if (photo.captureId !== captureId || !['ready', 'uploadError'].includes(photo.state)) continue;
      progress.textContent = t.progress(++current, pending.length);
      photo.state = 'uploading'; render();
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(`/camera/photos/${photo.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: photo.blob, cache: 'no-store', signal: controller.signal });
        if (response.status === 401 || response.status === 410) { photo.state = 'uploadError'; endConnection(t.ended); break; }
        if (!response.ok) throw new Error(response.status === 413 || response.status === 429 ? 'limit' : response.status === 409 ? 'conflict' : 'uploadError');
        const result = await response.json();
        await updatePhoto(photo, result.state, result.error);
      } catch (err) {
        if (photos.includes(photo) && photo.state === 'uploading') { photo.state = 'uploadError'; photo.detail = ''; showError(t[err.message] || t.uploadError); }
        break;
      } finally { clearTimeout(timeout); render(); }
    }
    busy = false; render(); if (!ended) poll();
  }
  cameraInput.addEventListener('change', selectPhotos);
  libraryInput.addEventListener('change', selectPhotos);
  upload.addEventListener('click', sendPhotos);
  function chooseQr() {
    if (busy || qrBusy) return;
    recovery.open = true;
    showQrStatus();
    try { qrInput.click(); } catch (_) { showQrStatus(t.qrUnavailable, true); }
  }
  reconnect.addEventListener('click', chooseQr);
  photographQr.addEventListener('click', chooseQr);
  retryConnection.addEventListener('click', () => {
    if (busy || qrBusy || ended || !token) return;
    setConnection(t.connecting);
    if (pollController) { generation++; pollAgain = true; pollController.abort(); }
    else poll();
  });
  function applyLink(value) {
    let link, nextToken;
    try {
      link = new URL(value);
      const fragment = new URLSearchParams(link.hash.slice(1));
      nextToken = fragment.get('token');
      if (link.origin !== location.origin || link.pathname !== '/camera' || link.search || link.username || link.password ||
          !nextToken || !/^[A-Za-z0-9_-]{43}$/.test(nextToken) || [...fragment.keys()].length !== 1) throw new Error('link');
    } catch (_) { showQrStatus(t.invalidLink, true); return false; }
    try {
      batch = uuid();
      sessionStorage.setItem(batchKey, batch);
      sessionStorage.setItem(storageKey, nextToken);
    } catch (_) { tokenWarning = true; storageNotice(); }
    token = nextToken; captureId = ''; reconciled = false; generation++; ended = false; expiresAt = Infinity; completed.clear();
    if (pollController) { pollAgain = true; pollController.abort(); }
    recoveryUrl.value = ''; recovery.open = false; showError(); showQrStatus(); setConnection(t.connecting); render(); poll();
    return true;
  }
  qrInput.addEventListener('change', async () => {
    const file = qrInput.files && qrInput.files[0]; qrInput.value = '';
    if (!file || busy || qrBusy) return;
    qrBusy = true; showQrStatus(t.qrReading); render();
    let canvas;
    try {
      if (file.size > 20 * MiB) throw new Error('qrLarge');
      if (typeof window.jsQR !== 'function') throw new Error('qrError');
      const image = await decode(file);
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('qrError');
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('qrError');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = window.jsQR(pixels.data, canvas.width, canvas.height);
      if (!result || typeof result.data !== 'string') throw new Error('qrError');
      applyLink(result.data);
    } catch (err) { showQrStatus(t[err.message] || t.qrError, true); }
    finally { if (canvas) { canvas.width = 0; canvas.height = 0; } qrBusy = false; render(); }
  });
  byId('recovery-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy && !qrBusy) applyLink(recoveryUrl.value);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(pollTimer); else poll(); });
  window.addEventListener('beforeunload', (event) => { if (photos.length) { event.preventDefault(); event.returnValue = ''; } });
  async function start() {
    try {
      db = await openStorage();
      db.onversionchange = () => { db.close(); db = null; storageFailed = true; storageNotice(); };
      const saved = await transaction('readonly', (store) => store.getAll());
      for (const item of saved) {
        if (item.blob && item.id) {
          const photo = { id: item.id, batch: item.batch || '', captureId: item.captureId || '', blob: item.blob, state: ['received', 'failed', 'uploadError'].includes(item.state) ? item.state : 'ready', url: URL.createObjectURL(item.blob) };
          photos.push(photo);
        }
      }
    } catch (_) { storageFailed = true; db = null; }
    busy = false; storageNotice(); render();
    if (ended) { recovery.open = true; setConnection(t.missingToken, true); }
    else { setConnection(t.connecting); poll(); }
  }
  render(); storageNotice(); start();
})();

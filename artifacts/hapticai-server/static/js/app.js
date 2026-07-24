const socket = io({ transports: ['polling'] });
let currentJobId = null;
let _pollInterval = null;
let _seenLogCount = 0;
let selectedMode = null;
let selectedPlugin = null;
let pluginsData = [];
let funscriptActions = [];
let viewerZoom = 1;
let viewerOffset = 0;
let fsJobId = null;

// ---- Socket ----
socket.on('connect', () => {
  setConnStatus(true);
});
socket.on('disconnect', () => {
  setConnStatus(false);
});
socket.on('progress', (data) => {
  if (data.job_id !== currentJobId) return;
  updateProgress(data.stage, data.progress, data.message, data.status);
});
socket.on('complete', (data) => {
  if (data.job_id !== currentJobId) return;
  stopJobPolling();
  onProcessingComplete(data);
});

function setConnStatus(connected) {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  dot.className = 'status-dot ' + (connected ? 'connected' : 'error');
  label.textContent = connected ? 'Connected' : 'Disconnected';
}

function stopJobPolling() {
  if (_pollInterval !== null) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

function startJobPolling(jobId) {
  stopJobPolling();
  _seenLogCount = 0;
  _pollInterval = setInterval(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/job/${jobId}`);
      if (!res.ok) return;
      const job = await res.json();

      // Feed any new log lines into the UI (deduplicate with SocketIO)
      const log = job.log || [];
      for (let i = _seenLogCount; i < log.length; i++) {
        const statusForLine = (i === log.length - 1) ? job.status : 'processing';
        updateProgress(job.stage || 1, job.progress || 0, log[i], statusForLine);
      }
      _seenLogCount = log.length;

      if (job.status === 'done') {
        stopJobPolling();
        // Fetch funscript actions separately (stripped from job endpoint for size)
        let actions = [];
        try {
          const fsRes = await fetch(`/api/funscript_data/${jobId}`);
          if (fsRes.ok) actions = (await fsRes.json()).actions || [];
        } catch (_e) {}
        onProcessingComplete({
          job_id: jobId,
          files: (job.output_files || []).map(p => p.split(/[\\/]/).pop()),
          saved_to: job.saved_to || [],
          actions,
        });
      } else if (job.status === 'error') {
        stopJobPolling();
        updateProgress(job.stage || 0, 0, 'Error: ' + (job.error || 'Processing failed'), 'error');
      }
    } catch (_e) { /* network blip — try again next tick */ }
  }, 1500);
}

// ---- Tab navigation ----
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Load settings on startup ──────────────────────────────────────────────────
fetch('/api/settings')
  .then(r => r.ok ? r.json() : null)
  .then(s => { if (s) document.getElementById('s-output').value = s.output_folder || ''; })
  .catch(() => {});

// ── Save output folder setting ────────────────────────────────────────────────
document.getElementById('btn-save-output').addEventListener('click', () => {
  const folder = document.getElementById('s-output').value.trim();
  const status = document.getElementById('output-save-status');
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ output_folder: folder }),
  }).then(r => r.json()).then(res => {
    if (res.error) {
      status.style.color = '#ef4444';
      status.textContent = '✗ ' + res.error;
    } else {
      status.style.color = '#22c55e';
      status.textContent = '✓ Saved';
      document.getElementById('s-output').value = res.output_folder || folder;
      setTimeout(() => { status.textContent = ''; }, 3000);
    }
  }).catch(() => {
    status.style.color = '#ef4444';
    status.textContent = '✗ Failed to save';
  });
});

// ── Input mode toggle (Upload / Local Path / URL·Embed) ───────────────────────
function setInputMode(mode) {
  const modes = ['upload', 'local', 'url'];
  modes.forEach(m => {
    const tab = document.getElementById('tab-' + m + '-mode');
    const panel = document.getElementById(m + '-mode');
    if (tab) tab.classList.toggle('active', m === mode);
    if (panel) panel.style.display = m === mode ? 'block' : 'none';
  });
}

document.getElementById('tab-upload-mode').addEventListener('click', () => setInputMode('upload'));
document.getElementById('tab-local-mode').addEventListener('click', () => setInputMode('local'));
document.getElementById('tab-url-mode').addEventListener('click', () => setInputMode('url'));

// ── URL / Embed import ────────────────────────────────────────────────────────
let _urlPollInterval = null;

function stopUrlPolling() {
  if (_urlPollInterval !== null) {
    clearInterval(_urlPollInterval);
    _urlPollInterval = null;
  }
}

function importUrl() {
  const raw = document.getElementById('url-input').value.trim();
  const hint = document.getElementById('url-hint');
  if (!raw) return;

  hint.textContent = '';
  hint.style.color = '';

  // Extract src from embed codes (<iframe src="...">)
  const embedMatch = raw.match(/src=["']([^"']+)["']/i);
  const url = embedMatch ? embedMatch[1] : raw;

  // Basic validation
  try { new URL(url); } catch {
    hint.style.color = '#ef4444';
    hint.textContent = '✗ That does not look like a valid URL';
    return;
  }

  document.getElementById('url-progress').style.display = 'block';
  document.getElementById('url-filename').textContent = 'Downloading…';
  document.getElementById('url-fill').style.width = '0%';
  document.getElementById('url-progress-hint').textContent = 'Starting download…';
  document.getElementById('btn-url-load').disabled = true;

  stopUrlPolling();

  fetch('/api/import-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).then(r => r.json()).then(res => {
    if (res.error) {
      hint.style.color = '#ef4444';
      hint.textContent = '✗ ' + res.error;
      document.getElementById('url-progress').style.display = 'none';
      document.getElementById('btn-url-load').disabled = false;
      return;
    }
    const jobId = res.job_id;
    _urlPollInterval = setInterval(async () => {
      try {
        const pr = await fetch('/api/job/' + jobId);
        if (!pr.ok) return;
        const job = await pr.json();

        const pct = Math.round(job.progress || 0);
        document.getElementById('url-fill').style.width = pct + '%';

        if (job.status === 'downloading') {
          document.getElementById('url-progress-hint').textContent = 'Downloading… ' + pct + '%';
        } else if (job.status === 'uploaded') {
          stopUrlPolling();
          document.getElementById('url-fill').style.width = '100%';
          document.getElementById('url-filename').textContent = job.filename || 'video';
          document.getElementById('url-progress-hint').textContent = '✓ Download complete';
          currentJobId = jobId;
          if (selectedMode) document.getElementById('btn-generate').disabled = false;
          showToast('Video downloaded: ' + (job.filename || 'video'));
          // Mirror the upload-progress panel
          document.getElementById('upload-progress').style.display = 'block';
          document.getElementById('upload-filename').textContent = job.filename || 'video';
          document.getElementById('upload-size').textContent = '';
          document.getElementById('upload-fill').style.width = '100%';
          document.getElementById('btn-url-load').disabled = false;
        } else if (job.status === 'error') {
          stopUrlPolling();
          hint.style.color = '#ef4444';
          hint.textContent = '✗ ' + (job.error || 'Download failed');
          document.getElementById('url-progress').style.display = 'none';
          document.getElementById('btn-url-load').disabled = false;
        }
      } catch (_e) { /* network blip */ }
    }, 1500);
  }).catch(e => {
    hint.style.color = '#ef4444';
    hint.textContent = '✗ ' + e.message;
    document.getElementById('url-progress').style.display = 'none';
    document.getElementById('btn-url-load').disabled = false;
  });
}

document.getElementById('btn-url-load').addEventListener('click', importUrl);
document.getElementById('url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') importUrl();
});

// ── Local path import ─────────────────────────────────────────────────────────
function importLocalPath() {
  const path = document.getElementById('local-path-input').value.trim();
  const hint = document.getElementById('local-path-hint');
  if (!path) return;
  hint.textContent = 'Loading…';
  hint.style.color = '';
  fetch('/api/import-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(r => r.json()).then(res => {
    if (res.error) {
      hint.style.color = '#ef4444';
      hint.textContent = '✗ ' + res.error;
      return;
    }
    currentJobId = res.job_id;
    hint.style.color = '#22c55e';
    hint.textContent = '✓ Loaded — funscript will be saved next to the video';
    if (selectedMode) document.getElementById('btn-generate').disabled = false;
    document.getElementById('upload-progress').style.display = 'block';
    document.getElementById('upload-filename').textContent = res.filename;
    document.getElementById('upload-size').textContent = formatSize(res.size);
    document.getElementById('upload-fill').style.width = '100%';
    showToast('Video loaded: ' + res.filename);
  }).catch(e => {
    hint.style.color = '#ef4444';
    hint.textContent = '✗ ' + e.message;
  });
}
document.getElementById('btn-local-load').addEventListener('click', importLocalPath);
document.getElementById('local-path-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') importLocalPath();
});

// ── File upload (video) ───────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) uploadVideo(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) uploadVideo(fileInput.files[0]);
});

function uploadVideo(file) {
  const allowed = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    alert('Unsupported format. Please use: ' + allowed.join(', '));
    return;
  }

  document.getElementById('upload-progress').style.display = 'block';
  document.getElementById('upload-filename').textContent = file.name;
  document.getElementById('upload-size').textContent = formatSize(file.size);
  animateProgress('upload-fill', 0, 30, 300);

  const form = new FormData();
  form.append('video', file);

  const xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      const pct = (e.loaded / e.total) * 100;
      document.getElementById('upload-fill').style.width = pct + '%';
    }
  });
  xhr.addEventListener('load', () => {
    if (xhr.status === 200) {
      const res = JSON.parse(xhr.responseText);
      currentJobId = res.job_id;
      document.getElementById('upload-fill').style.width = '100%';
      document.getElementById('btn-generate').disabled = !selectedMode;
      if (selectedMode) document.getElementById('btn-generate').disabled = false;
      showToast('Video uploaded: ' + res.filename);
    } else {
      const res = JSON.parse(xhr.responseText);
      alert('Upload failed: ' + (res.error || 'Unknown error'));
      document.getElementById('upload-progress').style.display = 'none';
    }
  });
  xhr.addEventListener('error', () => alert('Upload failed. Check your connection.'));
  xhr.open('POST', '/api/upload');
  xhr.send(form);
}

// ---- Load processing modes ----
fetch('/api/modes').then(r => r.json()).then(modes => {
  const grid = document.getElementById('mode-grid');
  grid.innerHTML = '';

  const cats = { offline: [], live: [], live_intervention: [], community: [], experimental: [] };
  modes.forEach(m => {
    const cat = m.category || 'offline';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(m);
  });

  const order = ['offline', 'live', 'live_intervention', 'experimental', 'community'];
  order.forEach(cat => {
    (cats[cat] || []).forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'mode-card';
      card.dataset.mode = m.cli || m.internal;
      card.innerHTML = `
        <div class="mode-card-name">${m.name}</div>
        <span class="mode-card-cat cat-${cat}">${cat.replace('_', ' ')}</span>
        <div class="mode-card-desc">${m.description}</div>
      `;
      card.addEventListener('click', () => selectMode(m, card));
      grid.appendChild(card);

      // Auto-select first offline mode
      if (cat === 'offline' && i === 0 && !selectedMode) {
        setTimeout(() => selectMode(m, card), 50);
      }
    });
  });

  if (modes.length === 0) {
    grid.innerHTML = '<p class="text-muted">No modes available. Ensure HapticAI dependencies are installed.</p>';
  }
});

function selectMode(mode, card) {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedMode = mode.cli || mode.internal;
  if (currentJobId) document.getElementById('btn-generate').disabled = false;
}

// ---- Load plugins ----
fetch('/api/plugins').then(r => r.json()).then(plugins => {
  pluginsData = plugins;
  const list = document.getElementById('plugin-list');
  list.innerHTML = '';
  plugins.forEach(p => {
    const item = document.createElement('div');
    item.className = 'plugin-item';
    item.dataset.plugin = p.name;
    item.innerHTML = `
      <div>
        <div class="plugin-item-name">${p.name}</div>
        <div class="plugin-item-desc">${p.description}</div>
      </div>
      <span class="plugin-item-arrow">›</span>
    `;
    item.addEventListener('click', () => selectPlugin(p, item));
    list.appendChild(item);
  });
});

function selectPlugin(plugin, item) {
  document.querySelectorAll('.plugin-item').forEach(i => i.classList.remove('selected'));
  item.classList.add('selected');
  selectedPlugin = plugin;
  renderPluginParams(plugin);
}

function renderPluginParams(plugin) {
  const container = document.getElementById('plugin-params');
  const schema = plugin.parameters_schema || {};
  const keys = Object.keys(schema);

  if (keys.length === 0) {
    container.innerHTML = `<p class="text-muted">This filter uses default parameters — no configuration needed.</p>`;
  } else {
    container.innerHTML = keys.map(key => {
      const p = schema[key];
      const val = p.default !== undefined ? p.default : '';
      let input = '';
      if (p.type === 'bool' || p.type === Boolean) {
        input = `<input type="checkbox" class="param-input" id="param-${key}" ${val ? 'checked' : ''} style="width:auto" />`;
      } else if (p.constraints && p.constraints.choices) {
        input = `<select class="param-input" id="param-${key}">${p.constraints.choices.map(c => `<option value="${c}" ${c==val?'selected':''}>${c}</option>`).join('')}</select>`;
      } else {
        input = `<input type="number" class="param-input" id="param-${key}" value="${val}" ${p.constraints ? `min="${p.constraints.min||''}" max="${p.constraints.max||''}" step="0.01"` : ''} />`;
      }
      return `
        <div class="param-group">
          <label class="param-label" for="param-${key}">${key.replace(/_/g, ' ')}</label>
          ${input}
          ${p.description ? `<p class="param-desc">${p.description}</p>` : ''}
        </div>
      `;
    }).join('');
  }

  document.getElementById('axis-select').style.display = 'flex';
  const applyBtn = document.getElementById('btn-apply-filter');
  applyBtn.style.display = 'inline-flex';
  applyBtn.disabled = !fsJobId;
}

// ---- Apply filter ----
document.getElementById('btn-apply-filter').addEventListener('click', () => {
  if (!selectedPlugin || !fsJobId) return;

  const params = {};
  const schema = selectedPlugin.parameters_schema || {};
  Object.keys(schema).forEach(key => {
    const el = document.getElementById('param-' + key);
    if (!el) return;
    if (el.type === 'checkbox') params[key] = el.checked;
    else if (el.type === 'number') params[key] = parseFloat(el.value);
    else params[key] = el.value;
  });

  const axis = document.getElementById('axis-choice').value;
  const btn = document.getElementById('btn-apply-filter');
  btn.disabled = true;
  btn.textContent = 'Applying...';

  fetch('/api/apply_filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: fsJobId, plugin: selectedPlugin.name, params, axis }),
  }).then(r => r.json()).then(res => {
    btn.disabled = false;
    btn.textContent = 'Apply Filter';
    if (res.error) {
      alert('Error: ' + res.error);
      return;
    }
    const card = document.getElementById('filter-result-card');
    card.style.display = 'block';
    document.getElementById('filter-result-msg').textContent =
      `Applied "${selectedPlugin.name}" — ${res.total} actions remaining`;

    const dl = document.getElementById('filter-downloads');
    dl.innerHTML = `
      <a class="download-btn" href="/api/download/${fsJobId}/${res.file}" download>
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        ${res.file}
      </a>
    `;

    funscriptActions = res.actions || [];
    renderViewer();
    showToast('Filter applied successfully!');
  }).catch(e => {
    btn.disabled = false;
    btn.textContent = 'Apply Filter';
    alert('Error applying filter: ' + e.message);
  });
});

// ---- Funscript upload (post-process) ----
const fsDropZone = document.getElementById('fs-drop-zone');
const fsFileInput = document.getElementById('fs-file-input');

fsDropZone.addEventListener('dragover', e => { e.preventDefault(); fsDropZone.classList.add('drag-over'); });
fsDropZone.addEventListener('dragleave', () => fsDropZone.classList.remove('drag-over'));
fsDropZone.addEventListener('drop', e => {
  e.preventDefault();
  fsDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) uploadFunscript(e.dataTransfer.files[0]);
});
fsFileInput.addEventListener('change', () => {
  if (fsFileInput.files[0]) uploadFunscript(fsFileInput.files[0]);
});

function uploadFunscript(file) {
  if (!file.name.endsWith('.funscript')) {
    alert('Please select a .funscript file');
    return;
  }
  const form = new FormData();
  form.append('funscript', file);

  fetch('/api/upload_funscript', { method: 'POST', body: form })
    .then(r => r.json())
    .then(res => {
      if (res.error) { alert(res.error); return; }
      fsJobId = res.job_id;
      document.getElementById('fs-drop-zone').style.display = 'none';
      const info = document.getElementById('fs-loaded-info');
      info.style.display = 'block';
      document.getElementById('fs-filename').textContent = res.filename;
      document.getElementById('fs-count').textContent = (res.actions || []).length;
      const dur = res.actions && res.actions.length
        ? msToTime(res.actions[res.actions.length - 1].at)
        : '—';
      document.getElementById('fs-duration').textContent = dur;

      if (document.getElementById('btn-apply-filter').style.display !== 'none') {
        document.getElementById('btn-apply-filter').disabled = false;
      }

      funscriptActions = res.actions || [];
      renderViewer();
      showToast('Funscript loaded: ' + res.filename);
    });
}

// ---- Generate ----
document.getElementById('btn-generate').addEventListener('click', () => {
  if (!currentJobId || !selectedMode) return;

  const settings = {
    autotune: document.getElementById('opt-autotune').checked,
    generate_roll: document.getElementById('opt-roll').checked,
    overwrite: document.getElementById('opt-overwrite').checked,
    vr: document.getElementById('opt-vr').checked,
  };

  document.getElementById('progress-panel').style.display = 'block';
  document.getElementById('result-panel').style.display = 'none';
  resetStages();
  updateProgress(1, 5, 'Submitting job...', 'processing');

  document.getElementById('prog-title').textContent = 'Processing: ' + selectedMode;
  document.getElementById('prog-badge').className = 'badge running';
  document.getElementById('prog-badge').textContent = 'Running';

  socket.emit('subscribe', { job_id: currentJobId });
  startJobPolling(currentJobId);

  fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: currentJobId, mode: selectedMode, settings }),
  }).then(r => r.json()).then(res => {
    if (res.error) {
      stopJobPolling();
      alert('Error: ' + res.error);
    }
  });

  document.getElementById('progress-panel').scrollIntoView({ behavior: 'smooth' });
});

function resetStages() {
  [1, 2, 3, 4].forEach(i => {
    const el = document.getElementById('stage-' + i);
    el.className = 'stage-item';
    el.querySelector('.stage-status').textContent = 'Waiting';
  });
  document.getElementById('log-box').innerHTML = '';
  document.getElementById('main-progress-fill').style.width = '0%';
  document.getElementById('main-progress-pct').textContent = '0%';
}

function updateProgress(stage, progress, message, status) {
  document.getElementById('main-progress-fill').style.width = progress + '%';
  document.getElementById('main-progress-pct').textContent = Math.round(progress) + '%';

  // Update stage indicators
  [1, 2, 3, 4].forEach(i => {
    const el = document.getElementById('stage-' + i);
    if (i < stage) {
      el.className = 'stage-item done';
      el.querySelector('.stage-status').textContent = 'Done';
    } else if (i === stage) {
      el.className = 'stage-item active';
      el.querySelector('.stage-status').textContent = status === 'error' ? 'Error' : 'Running';
    } else {
      el.className = 'stage-item';
      el.querySelector('.stage-status').textContent = 'Waiting';
    }
  });

  // Log
  const logBox = document.getElementById('log-box');
  const line = document.createElement('div');
  line.className = 'log-line' + (status === 'error' ? ' error' : status === 'done' ? ' success' : '');
  line.textContent = '[' + timestamp() + '] ' + message;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;

  if (status === 'error') {
    document.getElementById('prog-badge').className = 'badge error';
    document.getElementById('prog-badge').textContent = 'Error';
    document.getElementById('prog-title').textContent = 'Processing failed';
  }
}

function onProcessingComplete(data) {
  stopJobPolling();
  document.getElementById('main-progress-fill').style.width = '100%';
  document.getElementById('main-progress-pct').textContent = '100%';
  document.getElementById('prog-badge').className = 'badge done';
  document.getElementById('prog-badge').textContent = 'Done';
  document.getElementById('prog-title').textContent = 'Generation Complete';

  [1, 2, 3, 4].forEach(i => {
    const el = document.getElementById('stage-' + i);
    el.className = 'stage-item done';
    el.querySelector('.stage-status').textContent = 'Done';
  });

  const result = document.getElementById('result-panel');
  result.style.display = 'block';

  const dlList = document.getElementById('download-list');
  dlList.innerHTML = '';
  (data.files || []).forEach(fname => {
    const a = document.createElement('a');
    a.className = 'download-btn';
    a.href = `/api/download/${data.job_id}/${fname}`;
    a.download = fname;
    a.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      ${fname}
    `;
    dlList.appendChild(a);
  });

  // Show where the file was saved on disk
  const savedToInfo = document.getElementById('saved-to-info');
  const savedPaths = data.saved_to || [];
  if (savedPaths.length) {
    // Deduplicate folder paths
    const folders = [...new Set(savedPaths.map(p => {
      const sep = p.includes('\\') ? '\\' : '/';
      const parts = p.split(sep);
      parts.pop();
      return parts.join(sep) || p;
    }))];
    savedToInfo.style.display = 'block';
    savedToInfo.innerHTML = folders.map(f =>
      `<span class="saved-to-row">
        <svg viewBox="0 0 24 24" width="13" height="13"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        Saved to&nbsp;<code>${f}</code>
      </span>`
    ).join('');
  } else {
    savedToInfo.style.display = 'none';
  }

  if (data.actions && data.actions.length) {
    funscriptActions = data.actions;
    fsJobId = data.job_id;
    renderViewer();
  }

  showToast('Funscript generation complete!');
}

// ---- View in viewer ----
document.getElementById('btn-view-script').addEventListener('click', () => {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="viewer"]').classList.add('active');
  document.getElementById('tab-viewer').classList.add('active');
  renderViewer();
});

// ---- Script Viewer ----
function renderViewer() {
  const canvas = document.getElementById('script-canvas');
  const ctx = canvas.getContext('2d');
  const noData = document.getElementById('no-data-msg');
  const actions = funscriptActions;

  if (!actions || actions.length < 2) {
    noData.style.display = 'flex';
    return;
  }
  noData.style.display = 'none';

  const container = canvas.parentElement;
  canvas.width = container.offsetWidth * window.devicePixelRatio;
  canvas.height = container.offsetHeight * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const W = container.offsetWidth;
  const H = container.offsetHeight;
  const PAD = { top: 16, bottom: 24, left: 40, right: 10 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const minT = actions[0].at;
  const maxT = actions[actions.length - 1].at;
  const span = (maxT - minT) / viewerZoom;
  const startT = minT + viewerOffset * (maxT - minT - span);

  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#232836';
  ctx.lineWidth = 1;
  for (let y = 0; y <= 4; y++) {
    const py = PAD.top + (y / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(PAD.left, py);
    ctx.lineTo(PAD.left + plotW, py);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(100 - y * 25, PAD.left - 4, py + 4);
  }

  // Filter visible actions
  const visible = actions.filter(a => a.at >= startT && a.at <= startT + span);
  if (visible.length < 2) return;

  const toPx = (t) => PAD.left + ((t - startT) / span) * plotW;
  const toPy = (v) => PAD.top + (1 - v / 100) * plotH;

  // Filled area
  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
  grad.addColorStop(0, 'rgba(108,99,255,0.4)');
  grad.addColorStop(1, 'rgba(108,99,255,0.02)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(toPx(visible[0].at), PAD.top + plotH);
  visible.forEach(a => ctx.lineTo(toPx(a.at), toPy(a.pos)));
  ctx.lineTo(toPx(visible[visible.length - 1].at), PAD.top + plotH);
  ctx.closePath();
  ctx.fill();

  // Line
  ctx.strokeStyle = '#6c63ff';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  visible.forEach((a, i) => {
    if (i === 0) ctx.moveTo(toPx(a.at), toPy(a.pos));
    else ctx.lineTo(toPx(a.at), toPy(a.pos));
  });
  ctx.stroke();

  // Time axis labels
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) {
    const t = startT + (i / 5) * span;
    const px = PAD.left + (i / 5) * plotW;
    ctx.fillText(msToTime(t), px, H - 4);
  }

  // Stats
  const total = actions.length;
  const duration = msToTime(maxT - minT);
  let speeds = [];
  for (let i = 1; i < actions.length; i++) {
    const dt = actions[i].at - actions[i - 1].at;
    const dp = Math.abs(actions[i].pos - actions[i - 1].pos);
    if (dt > 0) speeds.push(dp / dt * 1000);
  }
  const avgSpeed = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
  const minPos = Math.min(...actions.map(a => a.pos));
  const maxPos = Math.max(...actions.map(a => a.pos));

  document.getElementById('v-actions').textContent = total;
  document.getElementById('v-duration').textContent = duration;
  document.getElementById('v-speed').textContent = avgSpeed + '/s';
  document.getElementById('v-range').textContent = minPos + '–' + maxPos;

  renderHeatmap();
}

function renderHeatmap() {
  const canvas = document.getElementById('heatmap-canvas');
  if (!funscriptActions.length) return;

  const W = canvas.parentElement.offsetWidth - 40;
  canvas.width = W;
  canvas.height = 60;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, 60);

  const actions = funscriptActions;
  const minT = actions[0].at;
  const maxT = actions[actions.length - 1].at;
  const span = maxT - minT;

  const buckets = Math.min(W, 500);
  const speeds = new Array(buckets).fill(0);
  const counts = new Array(buckets).fill(0);

  for (let i = 1; i < actions.length; i++) {
    const t = actions[i].at;
    const bucket = Math.floor(((t - minT) / span) * (buckets - 1));
    const dt = actions[i].at - actions[i - 1].at;
    const dp = Math.abs(actions[i].pos - actions[i - 1].pos);
    const speed = dt > 0 ? dp / dt : 0;
    speeds[bucket] += speed;
    counts[bucket]++;
  }

  const maxSpeed = Math.max(...speeds.map((s, i) => counts[i] ? s / counts[i] : 0));

  for (let i = 0; i < buckets; i++) {
    const spd = counts[i] ? speeds[i] / counts[i] : 0;
    const norm = maxSpeed > 0 ? spd / maxSpeed : 0;
    const x = (i / buckets) * W;
    const bw = W / buckets + 1;

    // Color: green → yellow → red
    const r = norm < 0.5 ? Math.round(norm * 2 * 255) : 255;
    const g = norm < 0.5 ? 255 : Math.round((1 - norm) * 2 * 255);
    ctx.fillStyle = `rgb(${r},${g},0)`;
    ctx.globalAlpha = 0.15 + norm * 0.7;
    ctx.fillRect(x, 0, bw, 60);
  }
  ctx.globalAlpha = 1;
}

// ---- Zoom controls ----
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  viewerZoom = Math.min(viewerZoom * 2, 64);
  renderViewer();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  viewerZoom = Math.max(viewerZoom / 2, 1);
  renderViewer();
});
document.getElementById('btn-zoom-fit').addEventListener('click', () => {
  viewerZoom = 1;
  viewerOffset = 0;
  document.getElementById('timeline-scrub').value = 0;
  renderViewer();
});
document.getElementById('timeline-scrub').addEventListener('input', e => {
  viewerOffset = e.target.value / 100;
  renderViewer();
});

window.addEventListener('resize', () => {
  if (funscriptActions.length) renderViewer();
});

// ---- Helpers ----
function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${pad(m % 60)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
function timestamp() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function animateProgress(id, from, to, duration) {
  const el = document.getElementById(id);
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    el.style.width = (from + (to - from) * t) + '%';
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1a1e28;border:1px solid #232836;color:#e8eaf0;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5);transition:opacity 0.3s`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ============================================================
// FILE: popup.js
// PURPOSE: Popup UI Controller — Universal Dynamic Folder Edition
// ============================================================

const AGY_API = 'http://localhost/CS-Stage4/api_sync.php';

// Professional SVG Icons (Lucide System) — No emojis!
const subjectIcons = {
  mobile: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`,
  iot: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M9 2v2M20 15h2M20 9h2M9 20v2M15 20v2M2 9h2M2 15h2"/></svg>`,
  security: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>`,
  data: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>`,
  project: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
  default: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
};

function getSubjectIcon(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('mobile') || lower.includes('android') || lower.includes('flutter')) return subjectIcons.mobile;
  if (lower.includes('iot') || lower.includes('internet') || lower.includes('arduino') || lower.includes('things')) return subjectIcons.iot;
  if (lower.includes('hack') || lower.includes('security') || lower.includes('ethical') || lower.includes('cyber')) return subjectIcons.security;
  if (lower.includes('data') || lower.includes('science') || lower.includes('mining') || lower.includes('machine')) return subjectIcons.data;
  if (lower.includes('grad') || lower.includes('thesis') || lower.includes('project')) return subjectIcons.project;
  return subjectIcons.default;
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function checkServer() {
  const dot = document.getElementById('connectionDot');
  const connText = document.getElementById('connectionText');
  const bar = document.getElementById('statusBar');
  const text = document.getElementById('statusText');
  const btn = document.getElementById('btnSync');

  try {
    const res = await fetch(AGY_API, { method: 'GET', signal: AbortSignal.timeout(2000) });
    const json = await res.json();

    if (json.status === 'ready') {
      dot.className = 'status-dot connected';
      connText.textContent = 'Active';
      bar.className = 'network-badge status-connected';
      text.textContent = 'Local XAMPP Workspace Connected';
      btn.disabled = false;
      return true;
    }
  } catch {
    dot.className = 'status-dot standalone';
    connText.textContent = 'Direct';
    bar.className = 'network-badge status-standalone';
    text.textContent = 'Standalone Mode (Direct Chrome Downloads)';
    btn.disabled = false;
    return false;
  }
}

function updatePreviewPath() {
  const baseSelect = document.getElementById('baseLocationSelect');
  const folderInput = document.getElementById('customFolderInput');
  const customPathInput = document.getElementById('customPathInput');
  const previewEl = document.getElementById('resolvedPreviewText');
  if (!previewEl) return;

  const base = baseSelect ? baseSelect.value : 'htdocs';
  const folder = (folderInput?.value || 'CS-Stage4').trim() || 'CS-Stage4';
  const customPath = (customPathInput?.value || '').trim();

  if (base === 'Custom') {
    previewEl.textContent = customPath ? `${customPath} \\ [Course]` : 'Custom Directory Path';
  } else {
    previewEl.textContent = `${base} \\ ${folder} \\ [Course]`;
  }
}

async function loadFolderSettings() {
  let stored = await chrome.storage.local.get(['baseLocation', 'targetRootFolder', 'customBasePath', 'storage_initialized_cs_stage4']);
  
  // Auto-set default to htdocs / CS-Stage4 on first load or version update
  if (!stored.storage_initialized_cs_stage4) {
    await chrome.storage.local.set({
      baseLocation: 'htdocs',
      targetRootFolder: 'CS-Stage4',
      storage_initialized_cs_stage4: true
    });
    stored = {
      baseLocation: 'htdocs',
      targetRootFolder: 'CS-Stage4',
      customBasePath: '',
      storage_initialized_cs_stage4: true
    };
  }

  const baseLoc = stored.baseLocation || 'htdocs';
  const folderName = stored.targetRootFolder || 'CS-Stage4';
  const customPath = stored.customBasePath || '';

  const baseSelect = document.getElementById('baseLocationSelect');
  const folderInput = document.getElementById('customFolderInput');
  const customPathInput = document.getElementById('customPathInput');
  const folderNameGroup = document.getElementById('folderNameGroup');
  const customPathGroup = document.getElementById('customPathGroup');
  const displayEl = document.getElementById('folderDisplayPath');
  const footerPath = document.getElementById('footerPath');

  if (baseSelect) baseSelect.value = baseLoc;
  if (folderInput) folderInput.value = folderName;
  if (customPathInput) customPathInput.value = customPath;

  // Highlight active base location chip
  const chips = document.querySelectorAll('.base-chip');
  chips.forEach(chip => {
    if (chip.dataset.value === baseLoc) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });

  if (baseLoc === 'Custom') {
    if (folderNameGroup) folderNameGroup.style.display = 'none';
    if (customPathGroup) customPathGroup.style.display = 'flex';
    const displayStr = customPath ? `Custom: ${customPath}` : 'Custom Path';
    if (displayEl) displayEl.textContent = displayStr;
    if (footerPath) footerPath.innerHTML = `<span>${displayStr}</span>`;
  } else {
    if (folderNameGroup) folderNameGroup.style.display = 'flex';
    if (customPathGroup) customPathGroup.style.display = 'none';
    const displayStr = `${baseLoc} / ${folderName}`;
    if (displayEl) displayEl.textContent = displayStr;
    if (footerPath) footerPath.innerHTML = `<span>${displayStr}</span>`;
  }

  updatePreviewPath();
}

async function loadStats() {
  const data = await chrome.storage.local.get(['totalSynced', 'lastSync', 'courses', 'syncedKeys']);

  document.getElementById('kpiFiles').textContent = data.totalSynced || 0;
  document.getElementById('kpiLastSync').textContent = formatRelativeTime(data.lastSync);

  const courses = data.courses || {};
  const courseCount = Object.keys(courses).length;
  document.getElementById('kpiCourses').textContent = courseCount;

  const countPill = document.getElementById('coursesCountPill');
  if (countPill) countPill.textContent = `${courseCount} active`;

  const list = document.getElementById('courseList');

  if (courseCount === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon-wrap">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2"></path>
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
          </svg>
        </div>
        <p class="empty-primary">No synced courses yet</p>
        <p class="empty-secondary">Navigate to Google Classroom to begin</p>
      </div>`;
    return;
  }

  list.innerHTML = '';
  for (const [name, count] of Object.entries(courses)) {
    const item = document.createElement('div');
    item.className = 'course-card-item';
    const icon = getSubjectIcon(name);
    item.innerHTML = `
      <div class="course-info-wrap">
        <div class="course-icon-svg">${icon}</div>
        <span class="course-label-text" title="${name}">${name}</span>
      </div>
      <span class="course-badge-count">${count} ${count === 1 ? 'file' : 'files'}</span>
    `;
    list.appendChild(item);
  }
}

async function triggerSync() {
  const btn = document.getElementById('btnSync');
  const btnText = document.getElementById('syncBtnText');

  btn.disabled = true;
  btnText.textContent = 'Deep Scanning...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('classroom.google.com')) {
      alert('Please open Google Classroom (classroom.google.com) first, then click Sync.');
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'trigger_sync' });
    } catch (err) {
      if (err.message.includes('Receiving end does not exist')) {
        console.log('[Mr.V Popup] Injecting content script...');
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await new Promise(r => setTimeout(r, 600));
        await chrome.tabs.sendMessage(tab.id, { action: 'trigger_sync' });
      } else {
        throw err;
      }
    }

    await new Promise(r => setTimeout(r, 4000));
    await loadStats();

  } catch (err) {
    console.error('[Mr.V Popup] Sync trigger error:', err);
    alert('Error triggering sync: ' + err.message);
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Sync Current Course';
  }
}

async function clearHistory() {
  if (!confirm('Reset local sync history cache? Files will be re-scanned on next sync.')) return;
  await chrome.storage.local.clear();
  await loadFolderSettings();
  await loadStats();
}

async function createBackup() {
  const btn = document.getElementById('btnBackup');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  
  try {
    const res = await fetch(AGY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_zip' })
    });
    const json = await res.json();
    if (json.status === 'success') {
      alert('Backup ZIP created successfully!\nSaved in CS-Stage4:\n' + json.zip_name);
    } else {
      alert('Backup note: ' + (json.message || 'XAMPP server offline'));
    }
  } catch (err) {
    alert('Backup note: XAMPP offline or unreachable.');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// ── Boot & Event Listeners ────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkServer();
  await loadFolderSettings();
  await loadStats();

  const data = await chrome.storage.local.get(['autoSync']);
  const autoSyncToggle = document.getElementById('autoSyncToggle');
  if (autoSyncToggle) {
    autoSyncToggle.checked = !!data.autoSync;
    autoSyncToggle.addEventListener('change', async (e) => {
      await chrome.storage.local.set({ autoSync: e.target.checked });
    });
  }

  // DOM Elements
  const btnEditFolder = document.getElementById('btnEditFolder');
  const inputRow = document.getElementById('folderInputRow');
  const btnSaveFolder = document.getElementById('btnSaveFolder');
  const baseSelect = document.getElementById('baseLocationSelect');
  const folderInput = document.getElementById('customFolderInput');
  const customPathInput = document.getElementById('customPathInput');
  const folderNameGroup = document.getElementById('folderNameGroup');
  const customPathGroup = document.getElementById('customPathGroup');
  const folderDisplay = document.getElementById('folderDisplayPath');
  const footerPath = document.getElementById('footerPath');
  const chipsGroup = document.getElementById('baseChipsGroup');

  // 1-Click Base Location Chips Controller
  if (chipsGroup) {
    chipsGroup.addEventListener('click', (e) => {
      const chip = e.target.closest('.base-chip');
      if (!chip) return;

      // Update chip active states
      document.querySelectorAll('.base-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const val = chip.dataset.value;
      if (baseSelect) baseSelect.value = val;

      if (val === 'Custom') {
        if (folderNameGroup) folderNameGroup.style.display = 'none';
        if (customPathGroup) customPathGroup.style.display = 'flex';
        if (customPathInput) customPathInput.focus();
      } else {
        if (folderNameGroup) folderNameGroup.style.display = 'flex';
        if (customPathGroup) customPathGroup.style.display = 'none';
        if (folderInput) folderInput.focus();
      }

      updatePreviewPath();
    });
  }

  // Real-time live path preview updates
  if (folderInput) {
    folderInput.addEventListener('input', updatePreviewPath);
    folderInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSaveFolder?.click();
    });
  }

  if (customPathInput) {
    customPathInput.addEventListener('input', updatePreviewPath);
    customPathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSaveFolder?.click();
    });
  }

  // Toggle Edit Panel
  if (btnEditFolder && inputRow) {
    btnEditFolder.addEventListener('click', () => {
      const isHidden = inputRow.style.display === 'none';
      inputRow.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) {
        updatePreviewPath();
        const activeChip = document.querySelector('.base-chip.active');
        const activeVal = activeChip?.dataset?.value || baseSelect?.value || 'Downloads';
        if (activeVal === 'Custom' && customPathInput) {
          customPathInput.focus();
        } else if (folderInput) {
          folderInput.focus();
        }
      }
    });
  }

  // Save Settings Controller
  if (btnSaveFolder) {
    btnSaveFolder.addEventListener('click', async () => {
      const activeChip = document.querySelector('.base-chip.active');
      const selectedBase = activeChip ? activeChip.dataset.value : (baseSelect?.value || 'htdocs');
      let rawFolder = (folderInput?.value || 'CS-Stage4').trim().replace(/[\\/:*?"<>|]/g, '_') || 'CS-Stage4';
      let rawCustomPath = (customPathInput?.value || '').trim();

      await chrome.storage.local.set({
        baseLocation: selectedBase,
        targetRootFolder: rawFolder,
        customBasePath: rawCustomPath,
        storage_initialized_cs_stage4: true
      });

      let displayStr = `${selectedBase} / ${rawFolder}`;
      if (selectedBase === 'Custom') {
        displayStr = rawCustomPath ? `Custom: ${rawCustomPath}` : 'Custom Path';
      }

      if (folderDisplay) folderDisplay.textContent = displayStr;
      if (footerPath) footerPath.innerHTML = `<span>${displayStr}</span>`;

      // Quick visual confirmation feedback
      btnSaveFolder.textContent = 'Saved!';
      btnSaveFolder.style.background = '#059669';
      setTimeout(() => {
        btnSaveFolder.textContent = 'Save Target Location';
        btnSaveFolder.style.background = '';
        if (inputRow) inputRow.style.display = 'none';
      }, 500);
    });
  }

  // Action Buttons
  document.getElementById('btnSync')?.addEventListener('click', triggerSync);
  document.getElementById('btnClear')?.addEventListener('click', clearHistory);
  document.getElementById('btnBackup')?.addEventListener('click', createBackup);
});

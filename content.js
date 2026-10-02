// ============================================================
// FILE: content.js
// PURPOSE: Mr.V Classroom Sync Engine — Content Script
// Runs inside classroom.google.com
// Full Course Deep Scanner + In-Place Modal Sync (Zero Unwanted Navigation)
// ============================================================

const AGY_API = 'http://localhost/CS-Stage4/api_sync.php';

let isSyncing = false;
let syncedItemKeys = new Set();

// ── Initialize ────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['syncedKeys', 'autoSync']);
  if (stored.syncedKeys) {
    syncedItemKeys = new Set(stored.syncedKeys);
  }
  injectSyncBadge();
  await pingServer();

  // Listen for sync trigger from popup via chrome messaging
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'trigger_sync') {
      console.log('[AGY] Sync triggered from popup via chrome.runtime.onMessage');
      scanAndSync().then(() => sendResponse({ done: true }));
      return true; // Keep channel open for async
    }
  });

  // Wait for page to fully render, then check auto-sync
  setTimeout(() => {
    if (stored.autoSync) {
      console.log('[AGY] Auto-Sync is ON. Triggering automatically.');
      scanAndSync(true);
    }
  }, 2500);

  // Watch for SPA navigation changes
  observeNavigation();
}

// ── Ping server ───────────────────────────────────────────────
async function pingServer() {
  try {
    const res = await fetch(AGY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ping' })
    });
    const json = await res.json();
    console.log('[AGY] Server ping:', json.status);
    return json.status === 'connected';
  } catch (e) {
    console.warn('[AGY] Server unreachable (will use Standalone mode):', e.message);
    return false;
  }
}

// ── Observe SPA Navigation ────────────────────────────────────
function observeNavigation() {
  let lastUrl = location.href;
  const observer = new MutationObserver(async () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const stored = await chrome.storage.local.get(['autoSync']);
      if (stored.autoSync) {
        setTimeout(() => scanAndSync(true), 2500);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Extract Course Context ────────────────────────────────────
function getCourseContext() {
  const url = location.href;
  const match = url.match(/(?:https:\/\/classroom\.google\.com)?\/(u\/\d+\/)?(?:c|w|a|m)\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const authUserPrefix = match[1] || 'u/0/';
  const courseId = match[2];
  const authUser = authUserPrefix.replace(/[^\d]/g, '') || '0';
  return {
    courseId,
    authUser,
    authUserPrefix,
    streamUrl: `https://classroom.google.com/${authUserPrefix}c/${courseId}`,
    classworkUrl: `https://classroom.google.com/${authUserPrefix}w/${courseId}/t/all`,
    courseName: getCourseName()
  };
}

// ── Clean Raw Attachment Titles ──────────────────────────────
function cleanAttachmentTitle(raw) {
  if (!raw) return '';
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^Attachment:\s*/i, '');
  cleaned = cleaned.replace(/^(PDF|Google Docs|Google Slides|Google Sheets|Document|Video|Audio|File|Image|Presentation|Spreadsheet):\s*/i, '');
  cleaned = cleaned.replace(/^PDF:\s*/i, '');
  cleaned = cleaned.replace(/^Google Drive:\s*/i, '');
  cleaned = cleaned.replace(/^Posted a new material:\s*/i, '');
  cleaned = cleaned.replace(/^Posted a new assignment:\s*/i, '');
  cleaned = cleaned.replace(/^Posted a new announcement:\s*/i, '');
  return cleaned.trim();
}

// ── Extract Google Drive File ID ──────────────────────────────
function extractDriveFileId(url) {
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{25,})/,
    /[?&]id=([a-zA-Z0-9_-]{25,})/,
    /\/open\?id=([a-zA-Z0-9_-]{25,})/,
    /\/d\/([a-zA-Z0-9_-]{25,})\//,
    /\/presentation\/d\/([a-zA-Z0-9_-]{25,})/,
    /\/document\/d\/([a-zA-Z0-9_-]{25,})/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]{25,})/
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

// ── Guess file extension ──────────────────────────────────────
function guessExtension(url, mimeType = '') {
  const mimeMap = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'image/png': 'png', 'image/jpeg': 'jpg',
    'application/zip': 'zip', 'text/plain': 'txt',
    'video/mp4': 'mp4'
  };
  if (mimeMap[mimeType]) return mimeMap[mimeType];

  const urlMatch = url.match(/\.([a-z0-9]{2,5})(\?|$)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();

  if (url.includes('presentation') || url.includes('slides')) return 'pptx';
  if (url.includes('document')) return 'docx';
  if (url.includes('spreadsheet') || url.includes('sheets')) return 'xlsx';
  if (url.includes('video') || url.includes('mp4')) return 'mp4';

  return 'pdf';
}

// ── Determine sub-folder ──────────────────────────────────────
function resolveSubCategory(title) {
  const t = title.toLowerCase();
  if (t.match(/\.mp4|\.mov|\.avi|\bvideo\b|\brecording\b/)) return 'Video_Lectures';
  if (t.includes('lab') || t.includes('practice') || t.includes('practical') || t.includes('exercise')) return 'Labs_Practice';
  if (t.includes('project') || t.includes('assignment') || t.includes('homework') || t.includes('task') || t.includes('cw')) return 'Projects';
  if (t.includes('report') || t.includes('essay') || t.includes('paper')) return 'Reports';
  if (t.includes('seminar') || t.includes('presentation')) return 'Seminars';
  return 'Lectures';
}

// ── Unescape Google JSON Data Strings ─────────────────────────
function unescapeGoogleHtml(str) {
  if (!str) return '';
  return str
    .replace(/\\\/|\\\//g, '/')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ');
}

// ── Smart Filename Extractor from JSON Snippets ───────────────
function extractFilenameNearMatch(text, matchIndex, fileId) {
  const start = Math.max(0, matchIndex - 350);
  const end = Math.min(text.length, matchIndex + 350);
  const snippet = text.substring(start, end);

  // Pattern 1: explicit file extension match (.pdf, .pptx, .docx, .zip, etc.)
  const extMatch = snippet.match(/["']([^"'\\]+\.(pdf|pptx|ppt|docx|doc|xlsx|xls|zip|rar|mp4|html|txt))["']/i);
  if (extMatch && extMatch[1] && extMatch[1].length < 100 && !extMatch[1].includes('/')) {
    return cleanAttachmentTitle(extMatch[1]);
  }

  // Pattern 2: Look for meaningful title strings near the match
  const titleMatches = [...snippet.matchAll(/["']([a-zA-Z0-9_\-\s.,()#&]{4,90})["']/g)];
  for (const tm of titleMatches) {
    const candidate = tm[1].trim();
    if (
      candidate !== fileId &&
      !candidate.startsWith('http') &&
      !candidate.startsWith('drive.google') &&
      !candidate.includes('google.com') &&
      !candidate.includes('googleapis.com') &&
      !['true', 'false', 'null', 'undefined', 'application/pdf', 'text/html', 'presentation', 'document'].includes(candidate.toLowerCase())
    ) {
      if (
        candidate.toLowerCase().includes('lecture') ||
        candidate.toLowerCase().includes('flutter') ||
        candidate.toLowerCase().includes('mobile') ||
        candidate.toLowerCase().includes('handbook') ||
        candidate.toLowerCase().includes('guide') ||
        candidate.toLowerCase().includes('tutorial') ||
        candidate.toLowerCase().includes('report') ||
        candidate.toLowerCase().includes('slide') ||
        candidate.toLowerCase().includes('chapter') ||
        candidate.toLowerCase().includes('widget') ||
        candidate.toLowerCase().includes('action') ||
        candidate.toLowerCase().includes('coursebook')
      ) {
        return cleanAttachmentTitle(candidate);
      }
    }
  }

  return `Document_${fileId.substring(0, 8)}`;
}

// ── Deep Scanner for Raw Scripts / JSON payloads ──────────────
function extractDriveUrlsFromRawHtml(rawHtml, defaultCourseName, allFoundItems, seenUrls) {
  if (!rawHtml) return;
  const cleanHtml = unescapeGoogleHtml(rawHtml);

  // 1. Google Drive files: drive.google.com/file/d/<id>
  const driveRegex = /https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{25,})/g;
  let match;
  while ((match = driveRegex.exec(cleanHtml)) !== null) {
    const fileId = match[1];
    if (!seenUrls.has(fileId)) {
      seenUrls.add(fileId);
      const url = `https://drive.google.com/file/d/${fileId}/view`;
      let title = extractFilenameNearMatch(cleanHtml, match.index, fileId);
      const ext = guessExtension(title.endsWith('.pdf') ? 'file.pdf' : url);

      allFoundItems.push({
        type: 'file',
        url,
        title,
        ext,
        dueDate: '',
        description: ''
      });
    }
  }

  // 2. Google Drive open?id=<id>
  const driveOpenRegex = /https:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]{25,})/g;
  while ((match = driveOpenRegex.exec(cleanHtml)) !== null) {
    const fileId = match[1];
    if (!seenUrls.has(fileId)) {
      seenUrls.add(fileId);
      const url = `https://drive.google.com/file/d/${fileId}/view`;
      let title = extractFilenameNearMatch(cleanHtml, match.index, fileId);
      const ext = guessExtension(title.endsWith('.pdf') ? 'file.pdf' : url);

      allFoundItems.push({
        type: 'file',
        url,
        title,
        ext,
        dueDate: '',
        description: ''
      });
    }
  }

  // 3. Google Docs / Presentation / Spreadsheets
  const docsRegex = /https:\/\/docs\.google\.com\/(presentation|document|spreadsheets)\/d\/([a-zA-Z0-9_-]{25,})/g;
  while ((match = docsRegex.exec(cleanHtml)) !== null) {
    const docType = match[1];
    const fileId = match[2];
    if (!seenUrls.has(fileId)) {
      seenUrls.add(fileId);
      const url = `https://docs.google.com/${docType}/d/${fileId}/view`;
      let title = extractFilenameNearMatch(cleanHtml, match.index, fileId);
      if (title.startsWith('Document_')) {
        title = `Material_${docType}_${fileId.substring(0, 6)}`;
      }
      const ext = docType === 'presentation' ? 'pptx' : (docType === 'spreadsheets' ? 'xlsx' : 'docx');

      allFoundItems.push({
        type: 'file',
        url,
        title,
        ext,
        dueDate: '',
        description: ''
      });
    }
  }

  // 4. Protobuf Arrays containing Drive ID paired with filename
  // Pattern: ["1aBcDeFg...", "Flutter in Action.pdf"] or ["Flutter in Action.pdf", ..., "1aBcDeFg..."]
  const protoPairRegex = /"([a-zA-Z0-9_-]{26,44})"[^\]]{1,120}?"([^"\\]+\.(pdf|pptx|ppt|docx|doc|xlsx|xls|zip|rar|mp4))"/g;
  while ((match = protoPairRegex.exec(cleanHtml)) !== null) {
    const fileId = match[1];
    const filename = match[2];
    if (!seenUrls.has(fileId) && !filename.includes('/')) {
      seenUrls.add(fileId);
      const url = `https://drive.google.com/file/d/${fileId}/view`;
      const title = cleanAttachmentTitle(filename);
      const ext = guessExtension(filename);
      allFoundItems.push({ type: 'file', url, title, ext, dueDate: '', description: '' });
    }
  }

  const protoRevPairRegex = /"([^"\\]+\.(pdf|pptx|ppt|docx|doc|xlsx|xls|zip|rar|mp4))"[^\]]{1,120}?"([a-zA-Z0-9_-]{26,44})"/g;
  while ((match = protoRevPairRegex.exec(cleanHtml)) !== null) {
    const filename = match[1];
    const fileId = match[3];
    if (!seenUrls.has(fileId) && !filename.includes('/')) {
      seenUrls.add(fileId);
      const url = `https://drive.google.com/file/d/${fileId}/view`;
      const title = cleanAttachmentTitle(filename);
      const ext = guessExtension(filename);
      allFoundItems.push({ type: 'file', url, title, ext, dueDate: '', description: '' });
    }
  }
}

// ── Extract Items from any DOM Document (Active Page or Iframe DOM) ──
function extractItemsFromDoc(doc, defaultCourseName, allFoundItems, seenUrls) {
  if (!doc) return;

  // 1. Scan all <a> tags rendered in this document
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || a.href || '';
    if (!href) return;

    let fullHref = href;
    if (fullHref.startsWith('/')) fullHref = 'https://classroom.google.com' + fullHref;

    const isDriveOrDocFile = (
      (fullHref.includes('drive.google.com/file/d/') && fullHref.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      (fullHref.includes('drive.google.com/open?id=') && fullHref.match(/id=[a-zA-Z0-9_-]{25,}/)) ||
      (fullHref.includes('docs.google.com/presentation/d/') && fullHref.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      (fullHref.includes('docs.google.com/document/d/') && fullHref.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      (fullHref.includes('docs.google.com/spreadsheets/d/') && fullHref.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      fullHref.match(/\.(pdf|pptx|ppt|docx|doc|xlsx|xls|zip|rar|py|java|cpp|c|ipynb|mp4|mkv|avi|webm|mov)(\?|$)/i)
    );

    const isClassroomNav = (
      fullHref.includes('classroom.google.com/c/') ||
      fullHref.includes('classroom.google.com/u/') ||
      fullHref.includes('classroom.google.com/w/') ||
      fullHref.includes('classroom.google.com/a/') ||
      fullHref.includes('accounts.google.com') ||
      fullHref.includes('support.google.com')
    );

    if (!isDriveOrDocFile || isClassroomNav) return;

    const fileId = extractDriveFileId(fullHref) || fullHref;
    if (seenUrls.has(fileId)) return;
    seenUrls.add(fileId);

    // Post title
    const card = a.closest('[jscontroller], [data-material-id], [data-assignment-id], [data-stream-item-id], [data-view-type], .Tc9hUd, .EE538, .n8H08c, [role="listitem"]');
    let postTitle = '';
    if (card) {
      const pHeader = card.querySelector('h1, h2, h3, .Vz355b, .y52mIf, .A6dC2c');
      if (pHeader) postTitle = cleanAttachmentTitle(pHeader.textContent);
    }
    if (!postTitle) {
      const docHeader = doc.querySelector('h1, h2, .RNmpXc h1, header h1');
      if (docHeader && !docHeader.textContent.includes('Classroom')) {
        postTitle = cleanAttachmentTitle(docHeader.textContent);
      }
    }

    // Title of file
    let rawTitle = '';
    const titleEl = a.querySelector('.Lhv62b, .ug0sa, .KF4T6b') || a.closest('.notranslate')?.querySelector('.Lhv62b');
    if (titleEl) rawTitle = titleEl.textContent || titleEl.getAttribute('title') || '';
    if (!rawTitle) rawTitle = a.getAttribute('aria-label') || a.getAttribute('title') || '';
    if (!rawTitle) {
      const txt = a.textContent.trim();
      if (txt.length > 2 && txt.length < 120 && !txt.match(/^(open|view|download|edit)$/i)) rawTitle = txt;
    }
    if (!rawTitle) {
      const urlPath = fullHref.split('/').pop().split('?')[0];
      rawTitle = decodeURIComponent(urlPath).replace(/[-_]/g, ' ').trim();
    }

    let title = cleanAttachmentTitle(rawTitle);
    if (!title || title.length < 2) title = 'Document_' + Date.now();

    if (postTitle && postTitle.length > 2 && !title.toLowerCase().includes(postTitle.toLowerCase().substring(0, 10))) {
      title = `${postTitle} — ${title}`;
    }

    const ext = guessExtension(fullHref);
    allFoundItems.push({ type: 'file', url: fullHref, title, ext, dueDate: '', description: '' });
  });
}

// ── Hidden Background Same-Origin Iframe Crawler ──────────────
// Loads the Classwork tab in a hidden 0x0 iframe, expands all accordion cards,
// extracts all attachments via live DOM, and removes the iframe.
async function crawlViaHiddenIframe(targetUrl, timeoutMs = 8000) {
  return new Promise((resolve) => {
    console.log('[AGY Crawler] Launching hidden background iframe for:', targetUrl);
    
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '1280px';
    iframe.style.height = '900px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.zIndex = '-9999';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = targetUrl;

    let isDone = false;
    const cleanup = () => {
      if (!isDone) {
        isDone = true;
        try { iframe.remove(); } catch (e) {}
      }
    };

    const timer = setTimeout(() => {
      if (!isDone) {
        console.log('[AGY Crawler] Iframe timeout, extracting current DOM state...');
        const items = extractFromIframe(iframe);
        cleanup();
        resolve(items);
      }
    }, timeoutMs);

    iframe.onload = async () => {
      console.log('[AGY Crawler] Iframe loaded, allowing Google Classroom JS to mount...');
      await new Promise(r => setTimeout(r, 1600));

      if (isDone) return;

      try {
        const idoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!idoc) {
          cleanup();
          resolve([]);
          return;
        }

        // Programmatically expand all cards inside the iframe DOM
        console.log('[AGY Crawler] Expanding all materials and assignments in hidden iframe...');
        const expandTargets = idoc.querySelectorAll(
          '[data-material-id], [data-assignment-id], [data-stream-item-id], .Tc9hUd, [role="listitem"], .n8H08c, .EE538, [aria-expanded="false"]'
        );

        expandTargets.forEach(el => {
          try {
            const btn = el.querySelector('[role="button"], button, .Vz355b, h2, h3, div') || el;
            btn.click();
          } catch (e) {}
        });

        // Wait for attachment chips to render
        await new Promise(r => setTimeout(r, 1800));

        const items = extractFromIframe(iframe);
        clearTimeout(timer);
        cleanup();
        resolve(items);
      } catch (err) {
        console.warn('[AGY Crawler] Error processing iframe:', err.message);
        clearTimeout(timer);
        cleanup();
        resolve([]);
      }
    };

    document.body.appendChild(iframe);
  });
}

function extractFromIframe(iframe) {
  const items = [];
  const seenUrls = new Set();
  try {
    const idoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!idoc) return items;

    // 1. Live DOM Extraction
    extractItemsFromDoc(idoc, '', items, seenUrls);

    // 2. Raw HTML & Script Extraction from Iframe
    const iframeHtml = idoc.documentElement.innerHTML;
    extractDriveUrlsFromRawHtml(iframeHtml, '', items, seenUrls);

  } catch (e) {
    console.warn('[AGY Crawler] extractFromIframe error:', e.message);
  }
  return items;
}

// ── Master Course Crawler (Active DOM + Scripts + Hidden Classwork Iframe) ──
async function crawlFullCourse(courseId, authUser, courseName) {
  showToast(`🔍 Deep-scanning all course materials in background...`);

  const classworkUrl = `https://classroom.google.com/u/${authUser}/w/${courseId}/t/all`;
  const streamUrl = `https://classroom.google.com/u/${authUser}/c/${courseId}`;

  const allFoundItems = [];
  const seenUrls = new Set();

  // 1. Scan current active page DOM (Read-only)
  const currentDomItems = collectAllItems();
  for (const item of currentDomItems) {
    const key = extractDriveFileId(item.url) || item.url;
    if (!seenUrls.has(key)) {
      seenUrls.add(key);
      allFoundItems.push(item);
    }
  }

  // 2. Scan active page Scripts & Embedded Data
  const activePageHtml = document.documentElement.innerHTML;
  extractDriveUrlsFromRawHtml(activePageHtml, courseName, allFoundItems, seenUrls);

  // 3. Hidden Iframe Crawler: Loads Classwork tab and expands all accordion cards!
  try {
    const iframeItems = await crawlViaHiddenIframe(classworkUrl, 8000);
    for (const item of iframeItems) {
      const key = extractDriveFileId(item.url) || item.url;
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        allFoundItems.push(item);
      }
    }
  } catch (err) {
    console.warn('[AGY] Classwork hidden iframe error:', err.message);
  }

  // 4. If still missing files and we are on Stream page, also load Stream in hidden iframe to expand any missed announcements
  if (allFoundItems.length === 0) {
    try {
      const streamIframeItems = await crawlViaHiddenIframe(streamUrl, 6000);
      for (const item of streamIframeItems) {
        const key = extractDriveFileId(item.url) || item.url;
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          allFoundItems.push(item);
        }
      }
    } catch (e) {}
  }

  // 5. Background AJAX fallback (for raw text scan)
  try {
    const [cwRes, streamRes] = await Promise.allSettled([
      fetch(classworkUrl, { credentials: 'include' }).then(r => r.text()),
      fetch(streamUrl, { credentials: 'include' }).then(r => r.text())
    ]);

    if (cwRes.status === 'fulfilled' && cwRes.value) {
      extractDriveUrlsFromRawHtml(cwRes.value, courseName, allFoundItems, seenUrls);
    }
    if (streamRes.status === 'fulfilled' && streamRes.value) {
      extractDriveUrlsFromRawHtml(streamRes.value, courseName, allFoundItems, seenUrls);
    }
  } catch (e) {}

  console.log(`[AGY] Master Course Crawler finished. Found ${allFoundItems.length} total files:`, allFoundItems);
  return allFoundItems;
}

// ── Main Scanner ──────────────────────────────────────────────
async function scanAndSync(isAuto = false) {
  if (isSyncing) return;
  isSyncing = true;
  updateBadge('syncing');
  console.log('[AGY] Scanning course context:', location.href);

  const context = getCourseContext();

  // If on home/list page without any active course
  if (!context || !context.courseId) {
    if (!isAuto) showToast('ℹ️ Please open any course home page first!');
    console.log('[AGY] Navigate into a course to sync files.');
    isSyncing = false;
    updateBadge('idle');
    return;
  }

  try {
    const courseName = context.courseName || getCourseName();
    console.log('[AGY] Crawling entire course:', courseName, '| Course ID:', context.courseId);

    // Sync Meeting Links if present
    const meetingLinks = [...new Set(Array.from(document.querySelectorAll('a[href*="meet.google.com"], a[href*="zoom.us"]')).map(a => a.href))];
    if (meetingLinks.length > 0) {
      pushToServer({ action: 'sync_meeting_links', course_name: courseName, links: meetingLinks });
    }

    // 1. Run Master Course Crawler across Stream & Classwork (All in background!)
    const items = await crawlFullCourse(context.courseId, context.authUser, courseName);

    if (items.length === 0) {
      if (!isAuto) showToast('ℹ️ No files found in this course.');
      isSyncing = false;
      updateBadge('idle');
      return;
    }

    // 2. Show Selection Modal with all discovered files from the entire class!
    showSelectionModal(items, courseName);

  } catch (err) {
    console.error('[AGY] Scan & Sync error:', err);
    showToast(`❌ Error during scan: ${err.message}`);
    isSyncing = false;
    updateBadge('idle');
  }
}

// ── Multi-Layer Category Classifier ───────────────────────────
function classifyMaterial(title = '', topic = '', dueDate = '') {
  const text = (title + ' ' + topic).toLowerCase();

  // 1. Practical / Lab Keywords
  if (text.match(/\blab\b|\bpractice\b|\bpractical\b|\bexercise\b|\bexp\b|\bexperiment\b|\bcode\b|\bhands\s*on\b|\bdemo\b|\btutorial\b/)) {
    return '02_Practical_Labs';
  }

  // 2. Assignment / Project / Deadlines
  if (dueDate || text.match(/\bassignment\b|\bhomework\b|\btask\b|\bcw\b|\bcoursework\b|\bproject\b|\breport\b|\bdeadline\b|\bquiz\b/)) {
    return '03_Assignments';
  }

  // 3. Resources / Handbook / Syllabus
  if (text.match(/\bhandbook\b|\bsyllabus\b|\bguide\b|\bcoursebook\b|\breference\b|\bbook\b|\btemplate\b|\boutline\b/)) {
    return '04_Resources_and_Notes';
  }

  // 4. Default: Theory Lectures
  return '01_Theory_Lectures';
}

// ── UI Modal for Selective Sync ───────────────────────────────
function showSelectionModal(items, courseName) {
  const existing = document.getElementById('agy-selection-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'agy-selection-modal';
  
  let listHtml = items.map((item, index) => {
    const badgeType = (item.ext || 'pdf').toUpperCase();
    const isAlreadySynced = syncedItemKeys.has(extractDriveFileId(item.url) || item.url);
    const autoCat = classifyMaterial(item.title, item.topic || '', item.dueDate || '');

    return `
      <div class="agy-file-row">
        <input type="checkbox" class="agy-file-checkbox" id="agy-cb-${index}" value="${index}" ${isAlreadySynced ? '' : 'checked'}>
        <span class="agy-file-badge agy-badge-${badgeType.toLowerCase()}">${badgeType}</span>
        <div class="agy-file-info">
          <label for="agy-cb-${index}" class="agy-file-title" title="${item.title}">${item.title}</label>
          <div class="agy-file-meta-row">
            ${isAlreadySynced ? '<span class="agy-file-synced-tag">✓ Synced</span>' : ''}
            ${item.dueDate ? `<span class="agy-file-due">Due: ${item.dueDate}</span>` : ''}
          </div>
        </div>
        <div class="agy-category-selector-wrap">
          <select class="agy-cat-select" id="agy-cat-${index}" title="Target Folder for this file">
            <option value="01_Theory_Lectures" ${autoCat === '01_Theory_Lectures' ? 'selected' : ''}>📘 Theory</option>
            <option value="02_Practical_Labs" ${autoCat === '02_Practical_Labs' ? 'selected' : ''}>🧪 Practical</option>
            <option value="03_Assignments" ${autoCat === '03_Assignments' ? 'selected' : ''}>📝 Assignment</option>
            <option value="04_Resources_and_Notes" ${autoCat === '04_Resources_and_Notes' ? 'selected' : ''}>📁 Resource</option>
          </select>
        </div>
      </div>
    `;
  }).join('');

  modal.innerHTML = `
    <div class="agy-modal-backdrop"></div>
    <div class="agy-modal-content">
      <div class="agy-modal-header">
        <div class="agy-modal-header-top">
          <div class="agy-modal-title-wrap">
            <span class="agy-modal-title">Mr.V Sync</span>
            <span class="agy-modal-pro">PRO</span>
          </div>
          <span class="agy-course-pill">${courseName}</span>
        </div>
        <p class="agy-modal-desc">Found <strong>${items.length}</strong> course files. Verify categories (Theory vs Practical) and select files to sync:</p>
      </div>
      <div class="agy-modal-actions-top">
         <button id="agy-btn-all" class="agy-btn-text">Select All</button>
         <span class="agy-divider">•</span>
         <button id="agy-btn-none" class="agy-btn-text">Deselect All</button>
         <span class="agy-count-selected" id="agy-selected-count">0 selected</span>
      </div>
      <div class="agy-file-list">
        ${listHtml}
      </div>
      <div class="agy-modal-footer">
        <button id="agy-btn-cancel" class="agy-btn agy-btn-secondary">Cancel</button>
        <button id="agy-btn-confirm" class="agy-btn agy-btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="m8 17 4 4 4-4"></path></svg>
          <span id="agy-confirm-text">Sync Selected</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const updateSelectedCount = () => {
    const selected = document.querySelectorAll('.agy-file-checkbox:checked').length;
    const countEl = document.getElementById('agy-selected-count');
    const confirmText = document.getElementById('agy-confirm-text');
    if (countEl) countEl.textContent = `${selected} of ${items.length} selected`;
    if (confirmText) confirmText.textContent = `Sync Selected (${selected})`;
  };

  updateSelectedCount();

  document.querySelectorAll('.agy-file-checkbox').forEach(cb => {
    cb.addEventListener('change', updateSelectedCount);
  });

  document.getElementById('agy-btn-all').addEventListener('click', () => {
    document.querySelectorAll('.agy-file-checkbox').forEach(cb => cb.checked = true);
    updateSelectedCount();
  });
  
  document.getElementById('agy-btn-none').addEventListener('click', () => {
    document.querySelectorAll('.agy-file-checkbox').forEach(cb => cb.checked = false);
    updateSelectedCount();
  });
  
  document.getElementById('agy-btn-cancel').addEventListener('click', () => {
    modal.remove();
    isSyncing = false;
    updateBadge('idle');
  });
  
  document.getElementById('agy-btn-confirm').addEventListener('click', async () => {
    const checkboxes = Array.from(document.querySelectorAll('.agy-file-checkbox'));
    const selectedIndices = checkboxes.filter(cb => cb.checked).map(cb => parseInt(cb.value));
    
    modal.remove();
    
    if (selectedIndices.length === 0) {
      showToast('No files selected.');
      isSyncing = false;
      updateBadge('idle');
      return;
    }
    
    showToast(`Starting download for ${selectedIndices.length} selected files...`);
    
    let count = 0;
    for (const i of selectedIndices) {
      count++;
      const item = items[i];
      const userCategory = document.getElementById(`agy-cat-${i}`)?.value || classifyMaterial(item.title, item.topic || '', item.dueDate || '');
      showToast(`[${count}/${selectedIndices.length}] Syncing: ${item.title.substring(0, 30)}...`);
      await syncItem(item, courseName, userCategory);
    }
    
    showToast(`Successfully synced ${selectedIndices.length} files for ${courseName}!`);
    console.log('[AGY] Selected files synced successfully into categorized folders!');
    isSyncing = false;
    updateBadge('idle');
  });
}

// ── Get Course Name ───────────────────────────────────────────
function getCourseName() {
  const pageTitle = document.title || '';
  if (pageTitle && pageTitle !== 'Google Classroom' && pageTitle.trim() !== '') {
    const parts = pageTitle.split('–').map(p => p.trim()).filter(Boolean);
    const coursePart = parts.find(p =>
      p !== 'Google Classroom' &&
      !['Stream', 'Classwork', 'People', 'Grades', 'Home'].includes(p)
    );
    if (coursePart && coursePart.length > 2) {
      return coursePart;
    }
  }

  const mainSelectors = [
    '.YVvGBb',
    '.mWMa4b .YVvGBb',
    'main h1',
    '.RNmpXc h1',
    'header h1'
  ];
  for (const sel of mainSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text.length > 2 && !['Home', 'Google Classroom'].includes(text)) {
        return text.replace(/\s+/g, ' ');
      }
    }
  }

  return 'General Course';
}

// ── Collect Attachments from Current Active DOM ───────────────
function collectAllItems() {
  const items = [];
  const seenUrls = new Set();

  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href || '';
    if (!href || seenUrls.has(href)) return;

    const isDriveOrDocFile = (
      (href.includes('drive.google.com/file/d/') && href.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      (href.includes('drive.google.com/open?id=') && href.match(/id=[a-zA-Z0-9_-]{25,}/)) ||
      (href.includes('docs.google.com/presentation/d/') && href.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      (href.includes('docs.google.com/document/d/') && href.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      (href.includes('docs.google.com/spreadsheets/d/') && href.match(/\/d\/[a-zA-Z0-9_-]{25,}/)) ||
      href.match(/\.(pdf|pptx|ppt|docx|doc|xlsx|xls|zip|rar|py|java|cpp|c|ipynb|mp4|mkv|avi|webm|mov)(\?|$)/i)
    );

    const isClassroomNav = (
      href.includes('classroom.google.com/c/') ||
      href.includes('classroom.google.com/u/') ||
      href.includes('classroom.google.com/w/') ||
      href.includes('classroom.google.com/a/') ||
      href.includes('accounts.google.com') ||
      href.includes('support.google.com')
    );

    if (!isDriveOrDocFile || isClassroomNav) return;

    seenUrls.add(href);

    const card = a.closest('[jscontroller], [data-material-id], [data-assignment-id], [data-stream-item-id], [data-view-type], .Tc9hUd, .EE538, .n8H08c, [role="listitem"]');
    
    let postTitle = '';
    if (card) {
      const pHeader = card.querySelector('h1, h2, h3, .Vz355b, .y52mIf, .A6dC2c');
      if (pHeader) postTitle = cleanAttachmentTitle(pHeader.textContent);
    }

    let dueDate = '';
    if (card) {
      const dateEls = card.querySelectorAll('.A6dC2c, .bfh39d, span');
      for (const d of dateEls) {
        if (d.textContent.includes('Due') || d.textContent.includes('due ')) {
          dueDate = d.textContent.trim();
          break;
        }
      }
    }
    
    let description = '';
    if (card) {
      const bodyEl = card.querySelector('.asQXV, .M6sI5d, html-blob, .d4Fgzb');
      if (bodyEl) description = bodyEl.textContent.trim();
    }

    let rawTitle = '';
    const titleEl = a.querySelector('.Lhv62b, .ug0sa, .KF4T6b') || a.closest('.notranslate')?.querySelector('.Lhv62b');
    if (titleEl) rawTitle = titleEl.textContent || titleEl.getAttribute('title') || '';
    if (!rawTitle) rawTitle = a.getAttribute('aria-label') || '';
    if (!rawTitle) {
      const txt = a.textContent.trim();
      if (txt.length > 2 && txt.length < 120 && !txt.match(/^(open|view|download|edit)$/i)) rawTitle = txt;
    }
    if (!rawTitle) rawTitle = a.getAttribute('title') || '';
    if (!rawTitle) {
      const urlPath = href.split('/').pop().split('?')[0];
      rawTitle = decodeURIComponent(urlPath).replace(/[-_]/g, ' ').trim();
    }

    let title = cleanAttachmentTitle(rawTitle);
    if (!title || title.length < 2) title = 'Document_' + Date.now();

    if (postTitle && postTitle.length > 2 && !title.toLowerCase().includes(postTitle.toLowerCase().substring(0, 10))) {
       title = `${postTitle} — ${title}`;
    }

    const ext = guessExtension(href);

    console.log('[AGY] Found attachment in active DOM:', title, '| Ext:', ext);
    items.push({ type: 'file', url: href, title, ext, dueDate, description });
  });

  return items;
}

// ── Sanitize filename ─────────────────────────────────────────
function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').substring(0, 80).trim() || 'file_' + Date.now();
}

// ── Sync a single item via Background Worker ─────────────────
async function syncItem(item, courseName, userCategory = '') {
  const fileId = extractDriveFileId(item.url);
  const itemKey = fileId || item.url;

  if (syncedItemKeys.has(itemKey)) {
    console.log('[AGY] Already synced, skipping:', item.title);
    return;
  }

  const category = userCategory || classifyMaterial(item.title, item.topic || '', item.dueDate || '');
  showToast(`⬇️ Syncing: ${item.title.substring(0, 32)}...`);
  console.log('[AGY] Sending to background worker:', item.title, '| Category:', category, '| fileId:', fileId);

  let result;
  try {
    result = await chrome.runtime.sendMessage({
      action: 'download_file',
      url: item.url,
      fileId: fileId,
      payload: {
        course_name: courseName,
        title: item.title,
        topic: item.topic || '',
        category: category,
        item_url: item.url,
        due_date: item.dueDate,
        description: item.description,
        auth_user: location.href.match(/\/u\/(\d+)\//)?.[1] || '0'
      }
    });
  } catch (err) {
    console.error('[AGY] Background message error:', err.message);
    showToast(`❌ Error: ${err.message.substring(0, 40)}`);
    return;
  }

  console.log('[AGY] Background result:', result);

  if (result?.success) {
    const res = result.result;
    if (res?.status === 'success') {
      showToast(`✅ Saved: ${item.title.substring(0, 40)}`);
    } else if (res?.status === 'exists') {
      showToast(`⏩ Already on disk: ${item.title.substring(0, 30)}`);
    } else if (res?.status === 'metadata_saved') {
      showToast(`📝 Logged (link saved): ${item.title.substring(0, 30)}`);
    } else {
      showToast(`⚠️ Issue syncing: ${item.title.substring(0, 30)}`);
      console.warn('[AGY] Unexpected result:', res);
    }
  } else {
    showToast(`❌ Failed: ${item.title.substring(0, 30)}`);
    console.error('[AGY] Background worker failed:', result?.error);
    return;
  }

  // Mark as synced
  syncedItemKeys.add(itemKey);
  await chrome.storage.local.set({ syncedKeys: [...syncedItemKeys] });

  // Update popup stats
  const stats = await chrome.storage.local.get(['totalSynced', 'courses', 'lastSync']);
  const courses = stats.courses || {};
  if (!courses[courseName]) courses[courseName] = 0;
  courses[courseName]++;
  await chrome.storage.local.set({
    totalSynced: (stats.totalSynced || 0) + 1,
    lastSync: new Date().toISOString(),
    courses
  });
}

// ── Push to server ────────────────────────────────────────────
async function pushToServer(payload) {
  try {
    const res = await fetch(AGY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('[AGY] Push failed:', err.message);
    return null;
  }
}

// ── Floating Badge ────────────────────────────────────────────
function injectSyncBadge() {
  if (document.getElementById('agy-sync-badge')) return;

  const badge = document.createElement('div');
  badge.id = 'agy-sync-badge';
  badge.innerHTML = `
    <div id="agy-badge-inner" title="Mr.V Sync — Click to sync this course">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
        <polyline points="2 12 12 17 22 12"></polyline>
        <polyline points="2 17 12 22 22 17"></polyline>
      </svg>
      <span id="agy-badge-text">Mr.V</span>
    </div>
    <div id="agy-toast-container"></div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

    #agy-sync-badge { position:fixed; bottom:24px; right:24px; z-index:2147483647; font-family:'Plus Jakarta Sans',sans-serif; }
    #agy-badge-inner { display:flex; align-items:center; gap:8px; background:#ffffff; color:#0f172a; border:1px solid #e2e8f0; padding:9px 16px; border-radius:9999px; font-size:12px; font-weight:700; box-shadow:0 6px 20px rgba(0,0,0,0.06); cursor:pointer; transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1); letter-spacing:0.02em; }
    #agy-badge-inner:hover { transform:translateY(-2px); border-color:#10b981; box-shadow:0 8px 24px rgba(16,185,129,0.18); }
    #agy-badge-inner.syncing { background:#fffbeb; color:#b45309; border-color:#fde68a; animation:agy-pulse 1s infinite; }
    #agy-badge-inner.done { background:#ecfdf5; color:#047857; border-color:#a7f3d0; }
    @keyframes agy-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
    #agy-toast-container { position:absolute; bottom:60px; right:0; display:flex; flex-direction:column-reverse; gap:8px; min-width:320px; z-index:2147483647; pointer-events:none; }
    .agy-toast { background:#ffffff; border:1px solid #e2e8f0; color:#0f172a; padding:12px 18px; border-radius:14px; font-size:12.5px; font-weight:600; box-shadow:0 12px 30px rgba(0, 0, 0, 0.08); animation:agy-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events:auto; line-height:1.4; transform-origin:bottom right; font-family:'Plus Jakarta Sans',sans-serif; }
    @keyframes agy-in { from{opacity:0;transform:translateX(60px) scale(0.95)} to{opacity:1;transform:translateX(0) scale(1)} }
    
    /* Selective Sync Modal Styles */
    #agy-selection-modal { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; font-family:'Plus Jakarta Sans',sans-serif; }
    .agy-modal-backdrop { position:absolute; inset:0; background:rgba(15, 23, 42, 0.45); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }
    .agy-modal-content { position:relative; background:#ffffff; border:1px solid #e2e8f0; border-radius:20px; width:580px; max-width:94vw; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 60px -12px rgba(0,0,0,0.18); color:#0f172a; overflow:hidden; animation:agy-modal-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes agy-modal-in { from{opacity:0;transform:scale(0.96) translateY(16px)} to{opacity:1;transform:scale(1) translateY(0)} }
    .agy-modal-header { padding:22px 24px 14px; border-bottom:1px solid #f1f5f9; }
    .agy-modal-header-top { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
    .agy-modal-title-wrap { display:flex; align-items:center; gap:8px; }
    .agy-modal-title { font-size:16px; font-weight:800; color:#0f172a; letter-spacing:-0.02em; }
    .agy-modal-pro { font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700; color:#047857; background:#ecfdf5; border:1px solid #a7f3d0; padding:1px 6px; border-radius:9999px; }
    .agy-course-pill { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; padding:3px 10px; border-radius:9999px; font-size:11px; font-weight:700; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .agy-modal-desc { margin:0; font-size:12.5px; color:#64748b; line-height:1.5; }
    .agy-modal-actions-top { padding:10px 24px; display:flex; align-items:center; gap:10px; font-size:12px; background:#f8fafc; border-bottom:1px solid #f1f5f9; }
    .agy-btn-text { background:none; border:none; color:#059669; font-size:12px; cursor:pointer; padding:0; font-weight:700; font-family:'Plus Jakarta Sans',sans-serif; }
    .agy-btn-text:hover { color:#047857; text-decoration:underline; }
    .agy-divider { color:#cbd5e1; }
    .agy-count-selected { margin-inline-start:auto; font-family:'JetBrains Mono',monospace; font-size:11px; color:#475569; font-weight:600; }
    .agy-file-list { flex:1; overflow-y:auto; padding:10px 16px; display:flex; flex-direction:column; gap:6px; max-height:360px; }
    .agy-file-list::-webkit-scrollbar { width:4px; }
    .agy-file-list::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:4px; }
    .agy-file-row { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:12px; transition:all 0.2s ease; background:#ffffff; border:1px solid #e2e8f0; }
    .agy-file-row:hover { background:#f8fafc; border-color:#cbd5e1; }
    .agy-file-checkbox { width:16px; height:16px; accent-color:#10b981; cursor:pointer; flex-shrink:0; }
    .agy-file-badge { font-family:'JetBrains Mono',monospace; font-size:9.5px; font-weight:800; padding:3px 6px; border-radius:6px; letter-spacing:0.04em; flex-shrink:0; }
    .agy-badge-pdf { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
    .agy-badge-pptx, .agy-badge-ppt { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
    .agy-badge-docx, .agy-badge-doc { background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; }
    .agy-badge-xlsx, .agy-badge-xls { background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; }
    .agy-badge-zip, .agy-badge-rar { background:#f3e8ff; color:#7e22ce; border:1px solid #e9d5ff; }
    .agy-badge-mp4 { background:#fce7f3; color:#be185d; border:1px solid #fbcfe8; }
    .agy-file-info { display:flex; flex-direction:column; gap:2px; overflow:hidden; flex:1; }
    .agy-file-title { font-size:12.5px; font-weight:600; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
    .agy-file-meta-row { display:flex; align-items:center; gap:8px; font-size:11px; }
    .agy-file-synced-tag { font-family:'JetBrains Mono',monospace; font-size:9.5px; color:#047857; background:#d1fae5; padding:1px 5px; border-radius:4px; font-weight:700; }
    .agy-file-due { font-family:'JetBrains Mono',monospace; font-size:10px; color:#e11d48; }
    
    /* Category Selector Pill */
    .agy-category-selector-wrap { flex-shrink:0; }
    .agy-cat-select { font-family:'Plus Jakarta Sans',sans-serif; font-size:11px; font-weight:600; padding:4px 8px; border-radius:8px; border:1px solid #cbd5e1; background:#f8fafc; color:#1e293b; cursor:pointer; outline:none; transition:all 0.2s; }
    .agy-cat-select:hover { border-color:#10b981; background:#ffffff; }
    .agy-cat-select:focus { border-color:#10b981; box-shadow:0 0 0 2px rgba(16,185,129,0.15); background:#ffffff; }

    .agy-modal-footer { padding:14px 24px; display:flex; justify-content:flex-end; gap:10px; background:#f8fafc; border-top:1px solid #f1f5f9; }
    .agy-btn { padding:10px 18px; border-radius:12px; font-size:13px; font-weight:700; cursor:pointer; border:none; transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1); font-family:'Plus Jakarta Sans',sans-serif; display:flex; align-items:center; gap:6px; }
    .agy-btn-secondary { background:#ffffff; color:#475569; border:1px solid #cbd5e1; }
    .agy-btn-secondary:hover { background:#f1f5f9; color:#0f172a; }
    .agy-btn-primary { background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:white; box-shadow:0 4px 14px rgba(16,185,129,0.25); }
    .agy-btn-primary:hover { background:linear-gradient(135deg, #059669 0%, #047857 100%); transform:translateY(-1px); box-shadow:0 6px 18px rgba(16,185,129,0.35); }
  `;
  document.head.appendChild(style);
  document.body.appendChild(badge);

  document.getElementById('agy-badge-inner').addEventListener('click', async () => {
    if (!isSyncing) await scanAndSync();
  });
}

function updateBadge(state) {
  const inner = document.getElementById('agy-badge-inner');
  const text = document.getElementById('agy-badge-text');
  if (!inner || !text) return;
  if (state === 'syncing') {
    inner.className = 'syncing';
    text.textContent = 'Syncing...';
  } else {
    text.textContent = 'Mr.V ✓';
    inner.className = 'done';
    setTimeout(() => { if(text) text.textContent='Mr.V'; if(inner) inner.className=''; }, 3000);
  }
}

function showToast(message) {
  const container = document.getElementById('agy-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'agy-toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transition='opacity 0.3s'; setTimeout(()=>toast.remove(),400); }, 5000);
}

// ── Boot ──────────────────────────────────────────────────────
init();


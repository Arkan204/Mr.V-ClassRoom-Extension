// ============================================================
// FILE: background.js
// PURPOSE: Background Service Worker — Universal Storage & Multi-Layer Classifier
// ============================================================

const AGY_API = 'http://localhost/CS-Stage4/api_sync.php';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download_file') {
    handleDownload(message)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function isServerOnline() {
  try {
    const res = await fetch(AGY_API, { method: 'GET', signal: AbortSignal.timeout(1500) });
    const json = await res.json();
    return json.status === 'ready';
  } catch {
    return false;
  }
}

async function handleDownload({ url, fileId, payload }) {
  const { course_name, title, topic, category, item_url, auth_user, due_date, description } = payload;
  
  // Read target storage location from settings
  const stored = await chrome.storage.local.get(['baseLocation', 'targetRootFolder', 'customBasePath']);
  const baseLocation = stored.baseLocation || 'htdocs';
  const rootFolder = stored.targetRootFolder || 'CS-Stage4';
  const customBasePath = stored.customBasePath || '';

  const courseFolder = resolveCourseFolder(course_name);
  const subCategory = category || resolveSubCategory(title, topic, due_date);
  let ext = guessExtFromUrl(url || item_url);
  
  // Base download URL construction
  let downloadUrl = item_url || url;
  if (fileId) {
    if (downloadUrl.includes('docs.google.com/presentation/d/')) {
      downloadUrl = `https://docs.google.com/presentation/d/${fileId}/export/pdf`;
      ext = 'pdf';
    } else if (downloadUrl.includes('docs.google.com/document/d/')) {
      downloadUrl = `https://docs.google.com/document/d/${fileId}/export/pdf`;
      ext = 'pdf';
    } else if (downloadUrl.includes('docs.google.com/spreadsheets/d/')) {
      downloadUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export/xlsx`;
      ext = 'xlsx';
    } else {
      downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&authuser=${auth_user || '0'}`;
    }
  } else if (downloadUrl.includes('google.com') && !downloadUrl.includes('authuser=')) {
    downloadUrl += (downloadUrl.includes('?') ? '&' : '?') + `authuser=${auth_user || '0'}`;
  }

  const filename = sanitizeFilename(title) + '.' + ext;
  console.log('[Mr.V BG] Starting download process for:', filename);

  const serverOnline = await isServerOnline();
  console.log('[Mr.V BG] Server online status:', serverOnline);

  try {
    // STEP 1: Fetch to resolve virus scan confirmation token if needed
    console.log('[Mr.V BG] Resolving Google Drive URL/Tokens...');
    let finalUrl = downloadUrl;
    
    if (downloadUrl.includes('drive.google.com/uc?')) {
      try {
        const res = await fetch(downloadUrl, { credentials: 'include' });
        const type = res.headers.get('content-type') || '';
        
        if (type.includes('text/html')) {
          const text = await res.text();
          const match = text.match(/confirm=([a-zA-Z0-9_-]+)/);
          if (match) {
            console.log('[Mr.V BG] Found virus scan token:', match[1]);
            finalUrl = `${downloadUrl}&confirm=${match[1]}`;
          }
        } else {
          finalUrl = res.url || downloadUrl;
        }
      } catch (fetchErr) {
        console.warn('[Mr.V BG] Fetch check bypassed. Proceeding with direct URL.');
        finalUrl = downloadUrl;
      }
    }

    // STEP 2: Download target path
    // If XAMPP is online, download to Temp and let PHP move it to the configured base (Desktop, htdocs, Custom, etc.)
    // If Standalone (no XAMPP), route relative to Downloads: [Base]/[RootFolder]/[Course]/[Category]/[filename]
    const basePrefix = baseLocation === 'Custom' 
      ? (customBasePath.split(/[\\/]/).filter(Boolean).pop() || 'Stage4') 
      : (baseLocation === 'Downloads' ? rootFolder : `${baseLocation}/${rootFolder}`);

    const downloadTargetPath = serverOnline 
      ? `MrV_Sync_Temp/${filename}`
      : `${basePrefix}/${courseFolder}/${subCategory}/${filename}`;

    console.log('[Mr.V BG] Initiating chrome.downloads to:', downloadTargetPath);
    console.log('[Mr.V BG] Final URL:', finalUrl);

    let downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: finalUrl,
        filename: downloadTargetPath,
        saveAs: false,
        conflictAction: 'overwrite'
      }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    // STEP 3: Wait for download to finish
    const downloadResult = await waitForDownload(downloadId, 60000);

    if (downloadResult.state === 'complete') {
      console.log('[Mr.V BG] Download complete!');
      
      if (serverOnline) {
        // STEP 4: Tell PHP to move the file into the user's selected location
        const result = await pushToServer({
          action: 'move_downloaded_file',
          course_name,
          title,
          topic: subCategory,
          filename,
          due_date,
          description,
          course_folder: courseFolder,
          sub_category: subCategory,
          base_location: baseLocation,
          root_folder: rootFolder,
          custom_base_path: customBasePath
        });
        
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Mr.V Sync PRO',
          message: `Saved to ${baseLocation === 'Custom' ? customBasePath : baseLocation + '/' + rootFolder}/${courseFolder}/${subCategory}:\n${filename}`
        });
        
        return result;
      } else {
        // Standalone Mode: Successfully downloaded directly
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Mr.V Sync (Standalone)',
          message: `Downloaded to ${basePrefix}/${courseFolder}/${subCategory}:\n${filename}`
        });

        return {
          status: 'success',
          mode: 'standalone',
          filename: filename,
          path: downloadTargetPath
        };
      }
    } else {
      throw new Error(`Download ${downloadResult.state}`);
    }

  } catch (err) {
    console.error('[Mr.V BG] Download Error:', err.message);
    if (serverOnline) {
      await pushToServer({
        action: 'sync_assignment_text',
        course_name,
        title,
        topic: subCategory,
        due_date,
        base_location: baseLocation,
        root_folder: rootFolder,
        custom_base_path: customBasePath,
        description: `📎 File available on Google Classroom: [Open File](${item_url})\n\n⚠️ Automated download failed: ${err.message}`
      });
    }
    return { status: 'metadata_saved', error: err.message };
  }
}

// ── Wait for download to finish ───────────────────────────────
function waitForDownload(downloadId, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.downloads.onChanged.removeListener(listener);
        resolve({ state: 'timeout', id: downloadId });
      }
    }, timeoutMs);

    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(listener);
          resolve({ state: 'complete' });
        }
      } else if (delta.state?.current === 'interrupted') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(listener);
          resolve({ state: 'interrupted', error: delta.error?.current });
        }
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

// ── Helpers ───────────────────────────────────────────────────
async function pushToServer(payload) {
  try {
    const res = await fetch(AGY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) return { status: 'php_error', raw: text };
    return JSON.parse(text);
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

// Universal Course Folder Resolver
function resolveCourseFolder(courseName) {
  const lower = (courseName || '').toLowerCase().trim();
  const map = [
    [['mobile', 'android', 'flutter', 'app development'], '01_Mobile_Application_Development'],
    [['iot', 'internet of things', 'arduino', 'raspberry'], '02_Internet_of_Things_IoT'],
    [['hack', 'ethical', 'cyber', 'security', 'penetration'], '03_Ethical_Hacking'],
    [['data science', 'data management', 'mining', 'machine learning', 'big data', 'python'], '04_Data_Science_Management'],
    [['grad', 'thesis', 'graduation', 'final project'], '00_Graduation_Project_I']
  ];
  for (const [keywords, folder] of map) {
    if (keywords.some(k => lower.includes(k))) return folder;
  }
  
  // Universal Fallback: dynamically sanitize the course name into a clean folder!
  let safeName = courseName.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').replace(/__+/g, '_').trim();
  return safeName || '05_General_Course';
}

// Multi-Layer Category Classifier
function resolveSubCategory(title = '', topic = '', dueDate = '') {
  const text = (title + ' ' + topic).toLowerCase();

  // 1. Practical / Lab Keywords
  if (text.match(/\blab\b|\bpractice\b|\bpractical\b|\bexercise\b|\bexp\b|\bexperiment\b|\bcode\b|\bhands\s*on\b|\bdemo\b|\btutorial\b/)) {
    return '02_Practical_Labs';
  }

  // 2. Assignment / Project / Due Date Keywords
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

function guessExtFromUrl(url = '') {
  const m = url.match(/\.([a-z0-9]{2,5})(\?|$)/i);
  if (m) return m[1].toLowerCase();
  if (url.includes('presentation') || url.includes('slides')) return 'pptx';
  if (url.includes('document')) return 'docx';
  if (url.includes('spreadsheet')) return 'xlsx';
  if (url.includes('video')) return 'mp4';
  return 'pdf';
}

function sanitizeFilename(name = 'document') {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').replace(/__+/g, '_').substring(0, 100).trim();
}

console.log('[AGY Background] Universal Storage & Multi-Layer Classifier ready.');

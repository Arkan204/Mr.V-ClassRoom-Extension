<?php
declare(strict_types=1);
// ============================================================
// FILE: api_sync.php
// PURPOSE: Local Antigravity Classroom Sync Engine Receiver
// STACK: PHP 8.2+, Apache on XAMPP (http://localhost/CS-Stage4/api_sync.php)
// ============================================================

// Allow CORS for the Chrome Extension
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$rootDir = __DIR__;

// Folder mapping dictionary
$courseFolderMap = [
    'mobile'    => '01_Mobile_Application_Development',
    'android'   => '01_Mobile_Application_Development',
    'flutter'   => '01_Mobile_Application_Development',
    'iot'       => '02_Internet_of_Things_IoT',
    'internet'  => '02_Internet_of_Things_IoT',
    'things'    => '02_Internet_of_Things_IoT',
    'arduino'   => '02_Internet_of_Things_IoT',
    'hack'      => '03_Ethical_Hacking',
    'ethical'   => '03_Ethical_Hacking',
    'cyber'     => '03_Ethical_Hacking',
    'security'  => '03_Ethical_Hacking',
    'data'      => '04_Data_Science_Management',
    'science'   => '04_Data_Science_Management',
    'mining'    => '04_Data_Science_Management',
    'grad'      => '00_Graduation_Project_I',
    'thesis'    => '00_Graduation_Project_I',
    'project'   => '00_Graduation_Project_I'
];

function sanitizeFilename($filename) {
    // Remove invalid characters for Windows filesystem
    $clean = preg_replace('/[\\/:*?"<>|]/', '_', $filename);
    $clean = trim($clean);
    return !empty($clean) ? $clean : 'document_' . time();
}

function resolveCourseFolder($courseName, $rootDir, $courseFolderMap) {
    $lower = mb_strtolower(trim($courseName));
    foreach ($courseFolderMap as $keyword => $folder) {
        if (str_contains($lower, $keyword)) {
            $path = $rootDir . DIRECTORY_SEPARATOR . $folder;
            if (!is_dir($path)) {
                @mkdir($path, 0777, true);
            }
            return ['folder' => $folder, 'path' => $path];
        }
    }
    // Universal Fallback: dynamically create a clean folder for ANY course!
    $cleanName = preg_replace('/[\\/:*?"<>|]/', '_', $courseName);
    $cleanName = preg_replace('/\s+/', '_', trim($cleanName));
    $cleanName = !empty($cleanName) ? $cleanName : '05_General_Course';
    $path = $rootDir . DIRECTORY_SEPARATOR . $cleanName;
    if (!is_dir($path)) {
        @mkdir($path, 0777, true);
    }
    return ['folder' => $cleanName, 'path' => $path];
}

function resolveSubCategory($title, $topic = '', $subCatOverride = '') {
    if (!empty($subCatOverride)) {
        return $subCatOverride;
    }
    $text = mb_strtolower($title . ' ' . $topic);
    if (preg_match('/\blab\b|\bpractice\b|\bpractical\b|\bexercise\b|\bexp\b|\bexperiment\b|\bcode\b|\bhands\s*on\b|\bdemo\b|\btutorial\b/', $text)) {
        return '02_Practical_Labs';
    }
    if (preg_match('/\bassignment\b|\bhomework\b|\btask\b|\bcw\b|\bcoursework\b|\bproject\b|\breport\b|\bdeadline\b|\bquiz\b/', $text)) {
        return '03_Assignments';
    }
    if (preg_match('/\bhandbook\b|\bsyllabus\b|\bguide\b|\bcoursebook\b|\breference\b|\bbook\b|\btemplate\b|\boutline\b/', $text)) {
        return '04_Resources_and_Notes';
    }
    return '01_Theory_Lectures';
}

function resolveTargetBaseDirectory(string $baseLocation, string $rootFolder, string $customBasePath, string $defaultHtdocsDir): string {
    $userProfile = getenv('USERPROFILE') 
        ?: getenv('HOME') 
        ?: ((isset($_SERVER['HOMEDRIVE'], $_SERVER['HOMEPATH'])) ? $_SERVER['HOMEDRIVE'] . $_SERVER['HOMEPATH'] : __DIR__);
    
    if ($baseLocation === 'Custom' && !empty($customBasePath)) {
        $target = rtrim($customBasePath, "\\/");
        if (!is_dir($target)) {
            @mkdir($target, 0777, true);
        }
        return $target;
    }
    
    $cleanFolder = preg_replace('/[\\/:*?"<>|]/', '_', $rootFolder);
    $cleanFolder = trim($cleanFolder);
    if (empty($cleanFolder)) {
        $cleanFolder = 'Stage4';
    }

    switch ($baseLocation) {
        case 'Desktop':
            $target = $userProfile . DIRECTORY_SEPARATOR . 'Desktop' . DIRECTORY_SEPARATOR . $cleanFolder;
            break;
        case 'Downloads':
            $target = $userProfile . DIRECTORY_SEPARATOR . 'Downloads' . DIRECTORY_SEPARATOR . $cleanFolder;
            break;
        case 'Documents':
            $target = $userProfile . DIRECTORY_SEPARATOR . 'Documents' . DIRECTORY_SEPARATOR . $cleanFolder;
            break;
        case 'htdocs':
        default:
            $target = dirname($defaultHtdocsDir) . DIRECTORY_SEPARATOR . $cleanFolder;
            if ($cleanFolder === 'CS-Stage4' || empty($rootFolder)) {
                $target = $defaultHtdocsDir;
            }
            break;
    }

    if (!is_dir($target)) {
        @mkdir($target, 0777, true);
    }
    return $target;
}

// ── GET: Status / Healthcheck ─────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $syncStateFile = $rootDir . DIRECTORY_SEPARATOR . 'classroom_sync_state.json';
    $syncState = file_exists($syncStateFile) ? json_decode(file_get_contents($syncStateFile), true) : [];
    
    echo json_encode([
        'status'         => 'ready',
        'engine'         => 'Mr.V CS-Stage4 Classroom Sync Engine',
        'root_dir'       => $rootDir,
        'synced_courses' => array_keys($syncState['courses'] ?? []),
        'total_files'    => $syncState['total_files_synced'] ?? 0,
        'last_sync'      => $syncState['last_sync'] ?? null
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── POST: File & Metadata Receiver ────────────────────────────
$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);

if (!$data || !isset($data['action'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON payload or missing action']);
    exit;
}

$action = $data['action'];

// 1. PING ACTION
if ($action === 'ping') {
    echo json_encode(['status' => 'connected', 'timestamp' => time()]);
    exit;
}

// 1.5 BROWSE FOLDER VIA NATIVE WINDOWS FORMS DIALOG
if ($action === 'browse_folder') {
    $psScript = '[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = "Select Destination Folder for Mr.V Sync"; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }';
    
    $command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ' . escapeshellarg($psScript);
    $selectedPath = trim((string)shell_exec($command));

    if (!empty($selectedPath) && is_dir($selectedPath)) {
        $folderName = basename($selectedPath);
        echo json_encode([
            'status'      => 'success',
            'path'        => $selectedPath,
            'folder_name' => $folderName
        ]);
    } else {
        echo json_encode([
            'status'  => 'cancelled_or_unsupported',
            'message' => 'No folder selected or dialog cancelled'
        ]);
    }
    exit;
}

// 2. SYNC FILE ITEM (PDF, Slide, Attachment)
if ($action === 'sync_file') {
    $courseName     = trim($data['course_name'] ?? 'General');
    $title          = trim($data['title'] ?? 'Material');
    $topic          = trim($data['topic'] ?? '');
    $filename       = sanitizeFilename($data['filename'] ?? 'file.pdf');
    $base64Data     = $data['file_base64'] ?? null;
    $itemUrl        = $data['item_url'] ?? '';
    $dueDate        = $data['due_date'] ?? null;
    $notes          = $data['description'] ?? '';
    $baseLocation   = trim($data['base_location'] ?? 'Desktop');
    $rootFolder     = trim($data['root_folder'] ?? 'Stage4');
    $customBasePath = trim($data['custom_base_path'] ?? '');

    $targetBaseDir = resolveTargetBaseDirectory($baseLocation, $rootFolder, $customBasePath, $rootDir);
    $courseInfo    = resolveCourseFolder($courseName, $targetBaseDir, $courseFolderMap);
    $subCategory   = resolveSubCategory($title, $topic);
    $targetDir     = $courseInfo['path'] . DIRECTORY_SEPARATOR . $subCategory;

    if (!is_dir($targetDir)) {
        mkdir($targetDir, 0777, true);
    }

    $filePath = $targetDir . DIRECTORY_SEPARATOR . $filename;
    $bytesWritten = 0;
    $isNew = true;

    if (!empty($base64Data)) {
        // Strip data: URI prefix if present
        if (str_contains($base64Data, ';base64,')) {
            $base64Data = explode(';base64,', $base64Data)[1];
        }
        $binary = base64_decode($base64Data);
        if ($binary !== false) {
            // Check if already exists with same size
            if (file_exists($filePath) && filesize($filePath) === strlen($binary)) {
                $isNew = false;
                $bytesWritten = strlen($binary);
            } else {
                $bytesWritten = file_put_contents($filePath, $binary);
            }
        }
    }

    // Update Course Index & Mr.V Markdown dossier
    $courseIndexFile = $courseInfo['path'] . DIRECTORY_SEPARATOR . 'Classroom_Coursework_Index.md';
    $entry = "- **[" . date('Y-m-d H:i') . "]** `{$subCategory}/{$filename}`\n  - **Item:** {$title}\n  - **Topic:** " . ($topic ?: 'General') . ($dueDate ? "\n  - **Deadline:** `{$dueDate}`" : "") . ($notes ? "\n  - **Notes:** " . mb_substr(strip_tags($notes), 0, 160) . "..." : "") . "\n\n";

    if (!file_exists($courseIndexFile)) {
        $header = "# " . $courseName . " — Coursework & Materials Dossier\n\n*Auto-synchronized by Mr.V Classroom Sync Engine*\n\n---\n\n## Synchronized Files & Lectures\n\n";
        file_put_contents($courseIndexFile, $header . $entry);
    } else {
        $existing = file_get_contents($courseIndexFile);
        if (!str_contains($existing, $filename)) {
            file_put_contents($courseIndexFile, $entry, FILE_APPEND);
        }
    }

    // Update Global Master Sync State
    $syncStateFile = $rootDir . DIRECTORY_SEPARATOR . 'classroom_sync_state.json';
    $syncState = file_exists($syncStateFile) ? json_decode(file_get_contents($syncStateFile), true) : [
        'courses' => [],
        'total_files_synced' => 0,
        'last_sync' => date('c')
    ];

    if (!isset($syncState['courses'][$courseInfo['folder']])) {
        $syncState['courses'][$courseInfo['folder']] = [
            'course_name' => $courseName,
            'files' => []
        ];
    }

    if (!in_array($filename, $syncState['courses'][$courseInfo['folder']]['files'])) {
        $syncState['courses'][$courseInfo['folder']]['files'][] = $filename;
        if ($isNew) {
            $syncState['total_files_synced'] = ($syncState['total_files_synced'] ?? 0) + 1;
        }
    }
    $syncState['last_sync'] = date('c');
    file_put_contents($syncStateFile, json_encode($syncState, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

    echo json_encode([
        'status'         => 'success',
        'is_new'         => $isNew,
        'course_folder'  => $courseInfo['folder'],
        'sub_category'   => $subCategory,
        'filename'       => $filename,
        'saved_path'     => $filePath,
        'bytes'          => $bytesWritten
    ]);
    exit;
}

// 3. LOG METADATA / ASSIGNMENT PROMPT (Even if no file is attached)
if ($action === 'sync_assignment_text') {
    $courseName     = trim($data['course_name'] ?? 'General');
    $title          = trim($data['title'] ?? 'Assignment');
    $topic          = trim($data['topic'] ?? '');
    $dueDate        = $data['due_date'] ?? 'No deadline specified';
    $notes          = $data['description'] ?? '';
    $baseLocation   = trim($data['base_location'] ?? 'Desktop');
    $rootFolder     = trim($data['root_folder'] ?? 'Stage4');
    $customBasePath = trim($data['custom_base_path'] ?? '');

    $targetBaseDir = resolveTargetBaseDirectory($baseLocation, $rootFolder, $customBasePath, $rootDir);
    $courseInfo    = resolveCourseFolder($courseName, $targetBaseDir, $courseFolderMap);
    $subCategory   = resolveSubCategory($title, $topic);
    $targetDir     = $courseInfo['path'] . DIRECTORY_SEPARATOR . $subCategory;
    if (!is_dir($targetDir)) mkdir($targetDir, 0777, true);

    // Save as a text file
    $safeTitle = sanitizeFilename($title);
    $readmePath = $targetDir . DIRECTORY_SEPARATOR . $safeTitle . '.md';
    $content = "# {$title}\n\n"
             . "- **Course:** {$courseName}\n"
             . "- **Category:** {$subCategory}\n"
             . "- **Due Date:** `{$dueDate}`\n"
             . "- **Synced At:** " . date('Y-m-d H:i:s') . "\n\n"
             . "## Notes\n\n"
             . ($notes ? $notes : "*No description provided.*") . "\n\n"
             . "---\n*Synced by Mr.V Classroom Sync Engine*\n";

    file_put_contents($readmePath, $content);

    echo json_encode([
        'status'  => 'metadata_saved',
        'path'    => $readmePath,
        'folder'  => $targetDir
    ]);
    exit;
}

// 3.5 SYNC MEETING LINKS
if ($action === 'sync_meeting_links') {
    $courseName     = trim($data['course_name'] ?? 'General');
    $links          = $data['links'] ?? [];
    $baseLocation   = trim($data['base_location'] ?? 'Desktop');
    $rootFolder     = trim($data['root_folder'] ?? 'Stage4');
    $customBasePath = trim($data['custom_base_path'] ?? '');

    $targetBaseDir = resolveTargetBaseDirectory($baseLocation, $rootFolder, $customBasePath, $rootDir);
    
    if (!empty($links)) {
        $courseInfo = resolveCourseFolder($courseName, $targetBaseDir, $courseFolderMap);
        $linksFile = $targetBaseDir . DIRECTORY_SEPARATOR . 'Meeting_Links.md';
        
        if (!file_exists($linksFile)) {
            $header = "# Master Meeting Links Aggregator\n\n*Auto-generated by Mr.V*\n\n| Course | Meeting Link | Discovered |\n|---|---|---|\n";
            file_put_contents($linksFile, $header);
        }
        
        $existing = file_get_contents($linksFile);
        $added = 0;
        foreach ($links as $link) {
            if (!str_contains($existing, $link)) {
                $entry = "| {$courseName} | [Join Meeting]({$link}) | " . date('Y-m-d') . " |\n";
                file_put_contents($linksFile, $entry, FILE_APPEND);
                $added++;
            }
        }
        
        echo json_encode(['status' => 'success', 'added' => $added]);
        exit;
    }
}

// 3.6 BACKUP WORKSPACE TO ZIP
if ($action === 'create_zip') {
    $zipName = "MrV_Backup_" . date('Y_m_d_H_i') . ".zip";
    $zipPath = $rootDir . DIRECTORY_SEPARATOR . $zipName;
    
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) === TRUE) {
        
        $files = new RecursiveIteratorIterator(
            new RecursiveCallbackFilterIterator(
                new RecursiveDirectoryIterator($rootDir, RecursiveDirectoryIterator::SKIP_DOTS),
                function ($current, $key, $iterator) {
                    // Skip the extension folder, git folders, and other zip files
                    $filename = $current->getFilename();
                    if ($current->isDir() && in_array($filename, ['classroom_extension', '.git'])) {
                        return false;
                    }
                    if ($current->isFile() && pathinfo($filename, PATHINFO_EXTENSION) === 'zip') {
                        return false;
                    }
                    return true;
                }
            )
        );

        foreach ($files as $name => $file) {
            if (!$file->isDir()) {
                $filePath = $file->getRealPath();
                $relativePath = substr($filePath, strlen($rootDir) + 1);
                $zip->addFile($filePath, $relativePath);
            }
        }
        $zip->close();
        
        echo json_encode(['status' => 'success', 'zip_name' => $zipName]);
    } else {
        echo json_encode(['status' => 'error', 'message' => 'Failed to create zip archive. Check permissions.']);
    }
    exit;
}

// 4. INDEX A FILE (update markdown index after chrome.downloads saves it)
if ($action === 'index_file') {
    $courseName     = trim($data['course_name'] ?? 'General');
    $title          = trim($data['title'] ?? 'file');
    $filename       = sanitizeFilename($data['filename'] ?? 'file.pdf');
    $subCategory    = trim($data['sub_category'] ?? '01_Theory_Lectures');
    $baseLocation   = trim($data['base_location'] ?? 'Desktop');
    $rootFolder     = trim($data['root_folder'] ?? 'Stage4');
    $customBasePath = trim($data['custom_base_path'] ?? '');

    $targetBaseDir = resolveTargetBaseDirectory($baseLocation, $rootFolder, $customBasePath, $rootDir);
    $courseInfo    = resolveCourseFolder($courseName, $targetBaseDir, $courseFolderMap);

    $courseIndexFile = $courseInfo['path'] . DIRECTORY_SEPARATOR . 'Classroom_Index.md';
    $entry = "- **[" . date('Y-m-d H:i') . "]** `{$subCategory}/{$filename}` — {$title}\n";

    file_put_contents($courseIndexFile, $entry, FILE_APPEND);
    echo json_encode(['status' => 'indexed', 'entry' => $entry]);
    exit;
}

// 5. MOVE DOWNLOADED FILE — Grabs the file from Chrome's Downloads folder and moves it to the target location
if ($action === 'move_downloaded_file') {
    $courseName     = trim($data['course_name'] ?? 'General');
    $title          = trim($data['title'] ?? 'file');
    $topic          = trim($data['topic'] ?? '');
    $filename       = sanitizeFilename($data['filename'] ?? 'file.pdf');
    $dueDate        = trim($data['due_date'] ?? '');
    $notes          = trim($data['description'] ?? '');
    $baseLocation   = trim($data['base_location'] ?? 'Desktop');
    $rootFolder     = trim($data['root_folder'] ?? 'Stage4');
    $customBasePath = trim($data['custom_base_path'] ?? '');

    // If no extension, try to determine from URL
    if (!pathinfo($filename, PATHINFO_EXTENSION)) {
        $filename .= '.pdf';
    }

    $targetBaseDir = resolveTargetBaseDirectory($baseLocation, $rootFolder, $customBasePath, $rootDir);
    $courseInfo    = resolveCourseFolder($courseName, $targetBaseDir, $courseFolderMap);
    $subCategory   = resolveSubCategory($title, $topic, $data['sub_category'] ?? '');
    $targetDir     = $courseInfo['path'] . DIRECTORY_SEPARATOR . $subCategory;

    if (!is_dir($targetDir)) {
        mkdir($targetDir, 0777, true);
    }

    $targetPath = $targetDir . DIRECTORY_SEPARATOR . $filename;
    
    // Check both MrV_Sync_Temp and AGY_Sync_Temp in user's Downloads folder
    $userProfile = getenv('USERPROFILE') ?: 'C:\Users\Ari Tech';
    $tempFolders = [
        $userProfile . DIRECTORY_SEPARATOR . 'Downloads' . DIRECTORY_SEPARATOR . 'MrV_Sync_Temp',
        $userProfile . DIRECTORY_SEPARATOR . 'Downloads' . DIRECTORY_SEPARATOR . 'AGY_Sync_Temp'
    ];

    $sourcePath = null;
    foreach ($tempFolders as $tempFolder) {
        if (!is_dir($tempFolder)) {
            @mkdir($tempFolder, 0777, true);
        }
        $candidate = $tempFolder . DIRECTORY_SEPARATOR . $filename;
        if (file_exists($candidate)) {
            $sourcePath = $candidate;
            break;
        }
    }

    // Check if the file actually downloaded
    if (!$sourcePath || !file_exists($sourcePath)) {
        // Look for the most recent file in the temp folders
        $allFound = [];
        foreach ($tempFolders as $tempFolder) {
            $found = glob($tempFolder . DIRECTORY_SEPARATOR . '*.*');
            if (!empty($found)) {
                $allFound = array_merge($allFound, $found);
            }
        }
        if (!empty($allFound)) {
            usort($allFound, function($a, $b) { return filemtime($b) - filemtime($a); });
            $sourcePath = $allFound[0];
            $filename = basename($sourcePath);
            $targetPath = $targetDir . DIRECTORY_SEPARATOR . $filename;
        } else {
            echo json_encode([
                'status'  => 'error',
                'message' => "File not found in temporary downloads folder."
            ]);
            exit;
        }
    }

    // Move the file
    if (rename($sourcePath, $targetPath)) {
        // Update course index
        $courseIndexFile = $courseInfo['path'] . DIRECTORY_SEPARATOR . 'Classroom_Index.md';
        $entry = "- **[" . date('Y-m-d H:i') . "]** `{$subCategory}/{$filename}` — {$title}\n";
        file_put_contents($courseIndexFile, $entry, FILE_APPEND);

        // Update Deadlines.md if due_date is provided
        if (!empty($dueDate)) {
            $deadlineFile = $targetBaseDir . DIRECTORY_SEPARATOR . 'Deadlines.md';
            if (!file_exists($deadlineFile)) {
                $header = "# Master Deadlines Tracker\n\n*Auto-generated by Mr.V*\n\n| Course | Assignment | Due Date | File |\n|---|---|---|---|\n";
                file_put_contents($deadlineFile, $header);
            }
            $existing = file_get_contents($deadlineFile);
            if (!str_contains($existing, $filename)) {
                $deadlineEntry = "| {$courseName} | {$title} | **{$dueDate}** | `{$filename}` |\n";
                file_put_contents($deadlineFile, $deadlineEntry, FILE_APPEND);
            }
        }
        
        // Write Teacher Notes Extractor
        if (!empty($notes)) {
            $notesFile = $targetDir . DIRECTORY_SEPARATOR . pathinfo($filename, PATHINFO_FILENAME) . '_Instructions.md';
            if (!file_exists($notesFile)) {
                $notesContent = "# Instructions: {$title}\n\n- **Course:** {$courseName}\n- **Saved:** " . date('Y-m-d H:i:s') . "\n\n---\n\n" . $notes;
                file_put_contents($notesFile, $notesContent);
            }
        }

        echo json_encode([
            'status'        => 'success',
            'filename'      => $filename,
            'course_folder' => $courseInfo['folder'],
            'sub_category'  => $subCategory,
            'path'          => $targetPath,
            'base_dir'      => $targetBaseDir
        ]);
    } else {
        echo json_encode([
            'status'  => 'error',
            'message' => "Failed to move file from {$sourcePath} to {$targetPath}"
        ]);
    }
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unknown action: ' . $action]);

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let splashWindow;
const activeProcesses = new Map();

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 600,
        height: 400,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        center: true
    });
    splashWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 800,
        show: false,
        frame: false,
        transparent: true,
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'scripts', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        if (splashWindow) {
            setTimeout(() => {
                splashWindow.close();
                mainWindow.show();
            }, 2000); // Show splash for 2 seconds
        } else {
            mainWindow.show();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.on('restore', () => {
        mainWindow.webContents.send('window-restored');
    });
}

app.on('ready', () => {
    createSplashWindow();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// --- Window Control Handshake ---
ipcMain.on('minimize-window', () => {
    mainWindow.webContents.send('start-minimize-animation');
    ipcMain.once('animation-finished', () => {
        mainWindow.minimize();
    });
});

ipcMain.on('close-window', () => {
    mainWindow.webContents.send('start-close-animation');
    ipcMain.once('animation-finished', () => {
        mainWindow.close();
    });
});

ipcMain.on('maximize-window', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

// --- Backend Process Listeners ---

// NEW: Listener for fetching GitHub releases
ipcMain.on('fetch-github-releases', (event, repoUrl) => {
    const processKey = `fetch:${repoUrl}`;
    if (activeProcesses.has(processKey)) {
        console.warn(`[MAIN PROCESS] Fetch process already running for: ${repoUrl}`);
        return;
    }

    console.log(`[MAIN PROCESS] Fetching releases for: ${repoUrl}`);
    const pythonScript = path.join(__dirname, 'backend', 'DebMaster.py');
    const pythonProcess = spawn('python', [pythonScript, '--github', repoUrl, '--verbose']);
    activeProcesses.set(processKey, pythonProcess);

    let buffer = '';
    pythonProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
            const line = buffer.substring(0, boundary);
            buffer = buffer.substring(boundary + 1);
            if (line) {
                try {
                    const jsonData = JSON.parse(line);
                    if (jsonData.type === 'github_releases' && jsonData.status === 'completed') {
                        mainWindow.webContents.send('github-releases-data', jsonData.releases);
                    } else if (jsonData.type === 'github' && jsonData.status === 'failed') {
                         mainWindow.webContents.send('github-releases-error', jsonData.error);
                    }
                } catch (e) {
                    console.warn(`[MAIN PROCESS] Non-JSON line from backend during fetch: ${line}`);
                }
            }
            boundary = buffer.indexOf('\n');
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[BACKEND STDERR] ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`[MAIN PROCESS] Backend fetch process for ${repoUrl} exited with code ${code}`);
        activeProcesses.delete(processKey);
    });
});

// NEW: Listener for downloading and converting/analyzing a .deb file
ipcMain.on('download-and-compile-deb', (event, downloadUrl) => {
    const processKey = `download:${downloadUrl}`;
    if (activeProcesses.has(processKey)) {
        console.warn(`[MAIN PROCESS] Download process already running for: ${downloadUrl}`);
        return;
    }

    console.log(`[MAIN PROCESS] Starting download/convert for: ${downloadUrl}`);
    const pythonScript = path.join(__dirname, 'backend', 'DebMaster.py');
    const pythonProcess = spawn('python', [pythonScript, '--download-url', downloadUrl, '--verbose']);
    activeProcesses.set(processKey, pythonProcess);

    let buffer = '';
    pythonProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        let boundary = buffer.indexOf('\n');
        while (boundary !== -1) {
            const line = buffer.substring(0, boundary);
            buffer = buffer.substring(boundary + 1);
            if (line) {
                try {
                    const jsonData = JSON.parse(line);
                    mainWindow.webContents.send('backend-message', jsonData);
                } catch (e) {
                    console.warn(`[MAIN PROCESS] Non-JSON line from backend during download: ${line}`);
                }
            }
            boundary = buffer.indexOf('\n');
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[BACKEND STDERR] ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`[MAIN PROCESS] Backend download process for ${downloadUrl} exited with code ${code}`);
        activeProcesses.delete(processKey);
        mainWindow.webContents.send('backend-message', {
            type: 'process_exit',
            status: code === 0 ? 'completed' : 'failed',
            download_url: downloadUrl,
            code: code
        });
    });
});

// Listener for the new patching process
ipcMain.on('start-patching', (event, data) => {
    const { ipaBuffer, tweakPath, identifier, ipaName } = data;

    const processKey = `patch:${identifier}`;
    if (activeProcesses.has(processKey)) {
        console.warn(`[MAIN PROCESS] Patching process already running for identifier: ${identifier}`);
        return;
    }

    if (!ipaBuffer || !tweakPath) {
        console.error(`[MAIN PROCESS] Invalid data for patching. IPA Buffer present: ${!!ipaBuffer}, Tweak: ${tweakPath}`);
        mainWindow.webContents.send('backend-message', {
            type: 'operation',
            status: 'failed',
            error: 'Invalid file data provided.',
            identifier: identifier,
        });
        return;
    }

    const tempDir = os.tmpdir();
    const tempIpaPath = path.join(tempDir, ipaName || `temp_ipa_${Date.now()}.ipa`);

    const nodeBuffer = Buffer.from(ipaBuffer);
    fs.writeFile(tempIpaPath, nodeBuffer, (err) => {
        if (err) {
            console.error('[MAIN PROCESS] Error writing temporary IPA file:', err);
            mainWindow.webContents.send('backend-message', {
                type: 'operation',
                status: 'failed',
                error: 'Could not save IPA file for patching.',
                identifier: identifier,
            });
            return;
        }

        console.log(`[MAIN PROCESS] Starting patch process. IPA: ${tempIpaPath}, Tweak: ${tweakPath}`);
        const pythonScript = path.join(__dirname, 'backend', 'DebMaster.py');
        const absoluteTweakPath = path.join(__dirname, tweakPath);

        const pythonProcess = spawn('python', [
            pythonScript,
            '--patch', tempIpaPath,
            '--with-data-tar', tweakPath, // Use the new argument
            '--verbose'
        ]);
        console.log(`[MAIN PROCESS] Spawned patch process with PID: ${pythonProcess.pid} for identifier: ${identifier}`);
        activeProcesses.set(processKey, pythonProcess);

        let buffer = '';
        pythonProcess.stdout.on('data', (data) => {
            console.log(`[PATCH STDOUT] Raw data for ${identifier}: ${data.toString().trim()}`);
            buffer += data.toString();
            let boundary = buffer.indexOf('\n');
            while (boundary !== -1) {
                const line = buffer.substring(0, boundary);
                buffer = buffer.substring(boundary + 1);
                if (line) {
                    try {
                        const jsonData = JSON.parse(line);
                        jsonData.identifier = identifier;
                        mainWindow.webContents.send('backend-message', jsonData);
                    } catch (e) {
                        console.warn(`[MAIN PROCESS] Non-JSON line from backend during patch: ${line}`);
                    }
                }
                boundary = buffer.indexOf('\n');
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`[PATCH STDERR] For ${identifier}: ${data.toString().trim()}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`[MAIN PROCESS] Backend patch process for ${identifier} exited with code ${code}`);
            activeProcesses.delete(processKey);

            // Clean up the temporary file
            fs.unlink(tempIpaPath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error(`[MAIN PROCESS] Error deleting temporary IPA file: ${tempIpaPath}`, unlinkErr);
                } else {
                    console.log(`[MAIN PROCESS] Successfully deleted temporary IPA file: ${tempIpaPath}`);
                }
            });

            mainWindow.webContents.send('backend-message', {
                type: 'process_exit',
                status: code === 0 ? 'completed' : 'failed',
                identifier: identifier,
                code: code
            });
        });
    });
});



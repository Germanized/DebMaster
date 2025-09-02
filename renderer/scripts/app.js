document.addEventListener('DOMContentLoaded', () => {
    // --- Global Elements & State ---
    const views = {
        dashboard: document.getElementById('dashboard-view'),
        local: document.getElementById('local-view'),
        github: document.getElementById('github-view'),
        sideloaders: document.getElementById('sideloaders-view'),
        history: document.getElementById('history-view'),
        settings: document.getElementById('settings-view'),
        about: document.getElementById('about-view'),
    };
    let activeView = views.dashboard;
    let activeLink = document.querySelector('.sidebar-item.active');

    // --- Initial Page Load ---
    function init() {
        setupWindowControls();
        setupNavigation();
        initDashboard();
        initLocalFiles();
        initGitHubRepos();
        initSideloaders();
        initHistory();
        initSettings();
        initAbout();
    }

    // --- Setup Functions ---
    function setupWindowControls() {
        document.getElementById('minimize-btn')?.addEventListener('click', () => window.electronAPI.send('minimize-window'));
        document.getElementById('maximize-btn')?.addEventListener('click', () => window.electronAPI.send('maximize-window'));
        document.getElementById('close-btn')?.addEventListener('click', () => window.electronAPI.send('close-window'));
        window.electronAPI.receive('start-minimize-animation', () => document.body.classList.add('fade-out'));
        window.electronAPI.receive('start-close-animation', () => document.body.classList.add('fade-out'));
        document.body.addEventListener('animationend', (event) => {
            if (event.animationName === 'fadeOut') {
                window.electronAPI.send('animation-finished');
            }
        });
        window.electronAPI.receive('window-restored', () => document.body.classList.remove('fade-out'));
    }

    function setupNavigation() {
        document.querySelectorAll('.sidebar-item').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const viewName = link.getAttribute('data-view');
                const viewToShow = views[viewName];
                if (viewToShow === activeView) return;

                activeLink?.classList.remove('active');
                link.classList.add('active');
                activeLink = link;

                if (activeView) {
                    activeView.classList.add('view-exit');
                    activeView.addEventListener('animationend', () => {
                        activeView.classList.remove('active', 'view-exit');
                        viewToShow.classList.add('active', 'view-enter');
                        activeView = viewToShow;
                        viewToShow.addEventListener('animationend', () => viewToShow.classList.remove('view-enter'), { once: true });
                    }, { once: true });
                } else {
                    viewToShow.classList.add('active', 'view-enter');
                    activeView = viewToShow;
                    viewToShow.addEventListener('animationend', () => viewToShow.classList.remove('view-enter'), { once: true });
                }
            });
        });
    }

    // --- Page Initializers ---
    function initDashboard() {
        views.dashboard.innerHTML = `
            <div class="hero-section">
                <h1 class="hero-title">Transform iOS Packages</h1>
                <p class="hero-subtitle">The ultimate tool for converting .deb packages to .ipa format, with seamless GitHub integration.</p>
            </div>
            <div class="quick-actions-grid">
                <div class="action-card floating-card" data-view="local">
                    <div class="card-icon-container"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></div>
                    <h3>Local Files</h3><p>Convert files from your computer.</p>
                </div>
                <div class="action-card floating-card" data-view="github">
                    <div class="card-icon-container"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg></div>
                    <h3>GitHub Repos</h3><p>Fetch releases directly from GitHub.</p>
                </div>
                <div class="action-card floating-card" data-view="history">
                    <div class="card-icon-container"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg></div>
                    <h3>History</h3><p>Review past conversions.</p>
                </div>
            </div>`;
        views.dashboard.querySelectorAll('.action-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelector(`.sidebar-item[data-view="${card.getAttribute('data-view')}"]`).click();
            });
        });
    }

    function initLocalFiles() {
        views.local.innerHTML = `
            <div class="page-header"><h1>Local File Conversion</h1><p>Drag and drop .deb files to get started.</p></div>
            <div id="dropZone" class="drop-zone"><p>Drop .deb files here or click to browse</p></div>
            <input type="file" id="fileInput" multiple accept=".deb" style="display: none;">
            <div id="fileQueue" class="file-queue"></div>
            <div id="batchActions" class="batch-actions" style="display: none;">
                <button id="clearQueueBtn" class="btn-secondary">Clear Queue</button>
                <button id="convertAllBtn" class="btn-primary">Convert All</button>
            </div>
            <div id="conversion-progress-container" class="progress-container" style="display: none;">
                <h4>Conversion Progress</h4>
                <div class="progress-bar">
                    <div class="progress-bar-inner"></div>
                </div>
                <p class="progress-status"></p>
            </div>
        `;

        const dropZone = views.local.querySelector('#dropZone');
        const fileInput = views.local.querySelector('#fileInput');
        const fileQueue = views.local.querySelector('#fileQueue');
        const batchActions = views.local.querySelector('#batchActions');
        const clearQueueBtn = views.local.querySelector('#clearQueueBtn');
        const convertAllBtn = views.local.querySelector('#convertAllBtn');
        const progressContainer = views.local.querySelector('#conversion-progress-container');
        const progressBar = views.local.querySelector('.progress-bar-inner');
        const progressStatus = views.local.querySelector('.progress-status');

        let filesToConvert = [];

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover'); });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
            const files = [...e.dataTransfer.files].filter(f => f.name.endsWith('.deb'));
            handleFiles(files);
        });
        fileInput.addEventListener('change', (e) => handleFiles([...e.target.files]));

        function handleFiles(files) {
            files.forEach(file => {
                if (!filesToConvert.some(f => f.path === file.path)) {
                    filesToConvert.push(file);
                }
            });
            updateFileQueue();
        }

        function updateFileQueue() {
            fileQueue.innerHTML = '';
            if (filesToConvert.length > 0) {
                const list = document.createElement('ul');
                filesToConvert.forEach((file, index) => {
                    const listItem = document.createElement('li');
                    listItem.textContent = file.name;
                    const removeBtn = document.createElement('button');
                    removeBtn.textContent = 'Remove';
                    removeBtn.addEventListener('click', () => {
                        filesToConvert.splice(index, 1);
                        updateFileQueue();
                    });
                    listItem.appendChild(removeBtn);
                    list.appendChild(listItem);
                });
                fileQueue.appendChild(list);
                batchActions.style.display = 'flex';
            } else {
                batchActions.style.display = 'none';
            }
        }

        clearQueueBtn.addEventListener('click', () => {
            filesToConvert = [];
            updateFileQueue();
        });

        convertAllBtn.addEventListener('click', () => {
            window.electronAPI.send('run-conversion', filesToConvert.map(f => f.path));
            progressContainer.style.display = 'block';
            progressBar.style.width = `0%`;
            progressStatus.textContent = 'Starting conversion...';
        });

        window.electronAPI.receive('conversion-progress', (data) => {
            progressBar.style.width = `${data.progress}%`;
            progressStatus.textContent = `Converting ${data.filename}: ${data.status}...`;
        });
        window.electronAPI.receive('conversion-error', (data) => {
            progressStatus.textContent = `Error converting ${data.filename}: ${data.message}`;
            progressBar.style.backgroundColor = 'red';
        });
        window.electronAPI.receive('conversion-complete', () => {
            progressStatus.textContent = `Conversion process finished.`;
            progressBar.style.backgroundColor = 'green';
        });
    }

    function initGitHubRepos() {
        views.github.innerHTML = `
            <div class="page-header"><h1>GitHub Repository Browser</h1><p>Fetch releases directly from a repository.</p></div>
            <div class="repo-search"><input type="text" id="repoUrlInput" class="repo-input" placeholder="e.g., Germanized/DebMaster"><button id="fetchRepoBtn" class="btn-primary">Fetch</button></div>
            <details class="deb-guide floating-card">
                <summary>Which .deb file should I choose?</summary>
                <div class="guide-content">
                    <h4>A Simple Guide for iPhone Users</h4>
                    <p>Choosing the right <code>.deb</code> file depends on your iPhone's processor (CPU) and iOS version.</p>
                    <ul>
                        <li>If your iPhone is on <strong>iOS 11 or newer</strong>, you should almost always choose the <strong>arm64</strong> file.</li>
                        <li>If your iPhone is on <strong>iOS 10 or older</strong>, you might need the <strong>arm</strong> file.</li>
                    </ul>
                    <h4>Quick Reference Table</h4>
                    <table class="styled-table">
                        <thead><tr><th>Device Series</th><th>CPU</th><th>iOS Version Range</th><th>Correct Architecture</th></tr></thead>
                        <tbody>
                            <tr><td>iPhone 3G → iPhone 5</td><td>32-bit ARM</td><td>iOS 3 → iOS 10.3.4</td><td><code>iphoneos-arm</code></td></tr>
                            <tr><td>iPhone 5s → iPhone 8</td><td>ARM64 (A7–A11)</td><td>iOS 7 → iOS 16</td><td><code>iphoneos-arm64</code></td></tr>
                            <tr><td>iPhone X → iPhone 16</td><td>ARM64 / ARM64e (A12–A18)</td><td>iOS 12 → iOS 18+</td><td><code>iphoneos-arm64</code></td></tr>
                        </tbody>
                    </table>
                    <p class="note"><strong>Note:</strong> Modern iPhones (5s and newer) use 64-bit processors (arm64) and cannot run older 32-bit (arm) applications.</p>
                </div>
            </details>
            <div id="repoInfoCard" class="repo-info-card floating-card" style="display: none;"></div>
            <div id="releasesList" class="releases-container"></div>`;
        
        const repoUrlInput = views.github.querySelector('#repoUrlInput');
        const fetchRepoBtn = views.github.querySelector('#fetchRepoBtn');
        const releasesList = views.github.querySelector('#releasesList');

        fetchRepoBtn.addEventListener('click', () => {
            const repoUrl = repoUrlInput.value.trim();
            if (repoUrl) {
                window.electronAPI.send('fetch-github-releases', repoUrl);
                releasesList.innerHTML = '<p>Fetching releases...</p>';
            }
        });

        releasesList.addEventListener('click', (e) => {
            const button = e.target.closest('.download-btn');
            if (button) {
                const downloadUrl = button.dataset.url;
                const buttonText = button.querySelector('.btn-text');
                
                if (button.disabled) return;

                buttonText.textContent = 'Starting...';
                button.disabled = true;

                const progressBar = document.createElement('div');
                progressBar.className = 'btn-progress-bar';
                button.appendChild(progressBar);
                button.style.position = 'relative';

                console.log(`Requesting download for: ${downloadUrl}`);
                window.electronAPI.send('download-and-compile-deb', downloadUrl);
            }
        });

        window.electronAPI.receive('backend-message', (data) => {
            console.log('Received backend message:', data);
        
            const identifier = data.identifier || data.download_url;
            if (!identifier) {
                console.log("Message received without identifier, cannot update UI.", data);
                return;
            }
        
            const button = releasesList.querySelector(`.download-btn[data-url="${identifier}"]`);
            if (!button) {
                console.log("Could not find a button to update for message:", data);
                return;
            }
        
            const buttonText = button.querySelector('.btn-text');
            let progressBar = button.querySelector('.btn-progress-bar');
        
            if (data.type === 'tweak_detected') {
                button.disabled = true;
                if (progressBar) progressBar.remove();
        
                const promptDiv = document.createElement('div');
                promptDiv.className = 'tweak-prompt';
                promptDiv.innerHTML = `
                    <p>This is a tweak. Please provide the decrypted IPA to patch.</p>
                    <p>Go to the Telegram bot <a href="#" class="telegram-link">@eeveedecrypterbot</a>. You can use the bot in any chat by sending an App Store link to get the decrypted file.</p>
                    <p class="note">For privacy, it's best to use the bot in a personal channel or private chat.</p>
                    <p>Example: <code>@eeveedecrypterbot &lt;App Store App Link&gt;</code></p>
                    <input type="file" class="ipa-input" accept=".ipa">`;
                
                const listItem = button.closest('li');
                listItem.after(promptDiv);
        
                promptDiv.querySelector('.telegram-link').addEventListener('click', (e) => {
                    e.preventDefault();
                    window.electronAPI.send('open-external-link', 'https://t.me/eeveedecrypterbot');
                });
        
                promptDiv.querySelector('.ipa-input').addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        const selectedFile = e.target.files[0];
                        
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const ipaBuffer = event.target.result;
                            
                            console.log('[FRONTEND] File read into ArrayBuffer:', selectedFile.name);

                            const tweakPath = data.tweak_path;
                            const uniqueIdentifier = data.download_url;
                            
                            const payload = { ipaBuffer, tweakPath, identifier: uniqueIdentifier, ipaName: selectedFile.name };
                            console.log('[FRONTEND] Sending payload with ArrayBuffer...');
                            
                            window.electronAPI.send('start-patching', payload);
                            
                            buttonText.textContent = 'Patching...';
                            promptDiv.remove();
                        };
                        reader.onerror = (error) => {
                            console.error('[FRONTEND] Error reading file:', error);
                            buttonText.textContent = 'File Read Error';
                            button.classList.add('btn-error');
                        };
                        reader.readAsArrayBuffer(selectedFile);
                    }
                });
                return;
            }
        
            if (!progressBar) {
                progressBar = document.createElement('div');
                progressBar.className = 'btn-progress-bar';
                button.appendChild(progressBar);
                console.log("Dynamically created progress bar for button:", button);
            }
        
            let message = data.status ? data.status.replace(/_/g, ' ') : buttonText.textContent;
            if (data.progress !== undefined) {
                message += ` (${Math.round(data.progress)}%)`;
            }
            buttonText.textContent = message.charAt(0).toUpperCase() + message.slice(1);
        
            if (data.progress !== undefined) {
                progressBar.style.width = `${data.progress}%`;
            }
        
            if (data.type === 'operation' && data.status === 'completed') {
                buttonText.textContent = 'Success!';
                button.classList.add('btn-success');
                progressBar.style.width = '100%';
                button.disabled = true;
            } else if (data.type === 'operation' && data.status === 'failed') {
                buttonText.textContent = `Error: ${data.error || 'Failed'}`;
                button.classList.add('btn-error');
                progressBar.style.width = '100%';
                button.disabled = false;
            } else if (data.type === 'process_exit' && data.code !== 0 && !button.classList.contains('btn-success')) {
                buttonText.textContent = 'Process Failed';
                button.classList.add('btn-error');
                button.disabled = false;
            }
        });

        window.electronAPI.receive('github-releases-data', (releases) => {
            releasesList.innerHTML = '';
            if (releases.length > 0) {
                releases.forEach(release => {
                    const releaseCard = document.createElement('div');
                    releaseCard.className = 'floating-card release-card';
                    releaseCard.innerHTML = `
                        <h3>${release.name} (${release.tag_name})</h3>
                        <p>Published: ${new Date(release.published_at).toLocaleDateString()}</p>
                        <ul>
                            ${release.deb_assets.map(asset => `<li>${asset.name} <button class="btn-secondary download-btn" data-url="${asset.download_url}"><span class="btn-text">${asset.name}</span></button></li>`).join('')}
                        </ul>`;
                    releasesList.appendChild(releaseCard);
                });
            } else {
                releasesList.innerHTML = '<p>No releases with .deb assets found.</p>';
            }
        });

        window.electronAPI.receive('github-releases-error', (error) => {
            releasesList.innerHTML = `<p class="error">Error fetching releases: ${error}</p>`;
        });
    }

    function initSideloaders() {
        views.sideloaders.innerHTML = `
            <div class="page-header">
                <h1>iOS Sideloading Tools</h1>
                <p>A ranked list of popular tools for installing apps on your iPhone.</p>
            </div>
            <div class="sideloaders-container">
                <div class="sideloading-section">
                    <h2>For Non-Jailbroken Devices</h2>
                    <div class="sideload-card floating-card rank-1">
                        <div class="sideload-card-header"><img src="assets/sideloaders/altstore.png" alt="AltStore Logo"></div>
                        <div class="sideload-card-body">
                            <h3>1. AltStore / AltServer</h3>
                            <p><strong>Website:</strong> <a href="https://altstore.io" class="external-link">altstore.io</a></p>
                            <p><strong>Pros:</strong> Uses your personal Apple ID (secure), automatically refreshes apps over Wi-Fi, open-source and trusted.</p>
                            <p><strong>Cons:</strong> Requires a PC/Mac running AltServer, limited to 3 sideloaded apps on a free Apple ID.</p>
                        </div>
                    </div>
                    <div class="sideload-card floating-card rank-2">
                        <div class="sideload-card-header"><img src="assets/sideloaders/scarlet.png" alt="Scarlet iOS Logo"></div>
                        <div class="sideload-card-body">
                            <h3>2. Scarlet iOS</h3>
                            <p><strong>Website:</strong> <a href="https://usescarletapp.com" class="external-link">usescarletapp.com</a></p>
                            <p><strong>Pros:</strong> No PC needed for installation, modern UI, supports app repositories, certificate management, and fast app signing.</p>
                            <p><strong>Cons:</strong> Relies on shared enterprise certificates which can be revoked frequently, making it less stable than AltStore.</p>
                        </div>
                    </div>
                    <div class="sideload-card floating-card rank-3">
                        <div class="sideload-card-header"><img src="assets/sideloaders/sideloadly.png" alt="Sideloadly Logo"></div>
                        <div class="sideload-card-body">
                            <h3>3. Sideloadly</h3>
                            <p><strong>Website:</strong> <a href="https://sideloadly.io" class="external-link">sideloadly.io</a></p>
                            <p><strong>Pros:</strong> Works on both Windows and macOS, simple drag-and-drop interface, supports larger or custom IPAs.</p>
                            <p><strong>Cons:</strong> Requires you to manually re-sign apps every 7 days with a free Apple ID, no auto-refresh feature.</p>
                        </div>
                    </div>
                </div>
                <div class="sideloading-section">
                    <h2>For Jailbroken or Exploit-Supported Devices</h2>
                     <div class="sideload-card floating-card rank-none">
                        <div class="sideload-card-header"><img src="assets/sideloaders/trollstore.png" alt="TrollStore Logo"></div>
                        <div class="sideload-card-body">
                            <h3>TrollStore</h3>
                            <p><strong>Website:</strong> <a href="https://trollstore.app" class="external-link">trollstore.app</a></p>
                            <p><strong>Pros:</strong> Apps are installed permanently and never expire (no 7-day limit), no PC needed once installed, supports unlimited apps.</p>
                            <p><strong>Cons:</strong> Requires a specific exploit or jailbreak to install, only works on a limited range of iOS versions.</p>
                        </div>
                    </div>
                </div>
            </div>`;
        views.sideloaders.querySelectorAll('.external-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                window.electronAPI.send('open-external-link', e.target.href);
            });
        });
    }

    function initHistory() {
        views.history.innerHTML = `
            <div class="page-header"><h1>Conversion History</h1><p>A log of all your past conversions.</p></div>
            <div id="historyList" class="history-timeline">
                <p class="empty-state">No conversions recorded yet.</p>
            </div>`;
    }

    function initSettings() {
        views.settings.innerHTML = `
            <div class="page-header"><h1>Settings</h1><p>Customize the application to your needs.</p></div>
            <div class="settings-sections">
                <div class="settings-section floating-card">
                    <h3>Output</h3>
                    <div class="setting-item">
                        <label for="outputPath">Output Directory</label>
                        <div class="path-selector">
                            <input type="text" id="outputPath" class="path-input" readonly value="Not Set">
                            <button class="btn-secondary">Browse</button>
                        </div>
                    </div>
                </div>
                <div class="settings-section floating-card">
                    <h3>GitHub</h3>
                    <div class="setting-item">
                        <label for="githubToken">Personal Access Token</label>
                        <input type="password" id="githubToken" class="token-input" placeholder="ghp_...">
                        <small>Recommended for higher API rate limits.</small>
                    </div>
                </div>
            </div>`;
    }

    function initAbout() {
        views.about.innerHTML = `
            <div class="about-hero">
                <img src="assets/DebMasterLogo.png" class="about-logo" alt="DebMaster Logo"/>
                <h1>DebMaster</h1>
                <p class="version">Version 1.0.0</p>
                <p class="tagline">Created by <a href="https://github.com/Germanized" id="author-link">Germanized</a></p>
            </div>
            <div class="stats-dashboard">
                <div class="stats-grid">
                    <div class="stat-card floating-card"><div class="stat-number">0</div><div class="stat-label">Total Conversions</div></div>
                    <div class="stat-card floating-card"><div class="stat-number">N/A</div><div class="stat-label">Success Rate</div></div>
                    <div class="stat-card floating-card"><div class="stat-number">0 MB</div><div class="stat-label">Data Processed</div></div>
                </div>
            </div>`;
        
        const authorLink = views.about.querySelector('#author-link');
        authorLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.send('open-external-link', authorLink.href);
        });
    }

    init();
});

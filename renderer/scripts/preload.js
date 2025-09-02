const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, limited API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    // Whitelist channels for sending data from renderer to main
    const validChannels = [
        'minimize-window', 
        'maximize-window', 
        'close-window',
        'run-conversion',
        'open-external-link',
        'fetch-github-releases',
        'download-and-compile-deb',
        'start-patching', // Added channel
        'animation-finished'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    // Whitelist channels for receiving data from main to renderer
    const validChannels = [
        'conversion-progress',
        'conversion-error',
        'conversion-complete',
        'github-releases-data',
        'github-releases-error',
        'backend-message', // Added channel
        'start-minimize-animation',
        'start-close-animation',
        'window-restored'
    ];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});

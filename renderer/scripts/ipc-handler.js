// renderer/scripts/ipc-handler.js

const ipcHandler = {
    // --- Conversion ---
    startConversion(filePaths) {
        console.log('Sending files to main process for conversion:', filePaths);
        window.electronAPI.send('run-conversion', filePaths);
    },

    // --- Event Listeners ---
    onConversionProgress(callback) {
        window.electronAPI.receive('conversion-progress', (data) => {
            console.log('IPC Progress:', data);
            callback(data);
        });
    },

    onConversionError(callback) {
        window.electronAPI.receive('conversion-error', (error) => {
            console.error('IPC Error:', error);
            callback(error);
        });
    },

    onConversionComplete(callback) {
        window.electronAPI.receive('conversion-complete', (message) => {
            console.log('IPC Complete:', message);
            callback(message);
        });
    }
};
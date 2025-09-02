# Contributing to DebMaster

Thank you for your interest in contributing to DebMaster! This guide will help you get the project up and running on your local machine for development, testing, or personal use.

## Getting Started: Running from Source

If you want to run the latest version of DebMaster directly from the source code, follow these steps.

### Prerequisites

- [Node.js](https://nodejs.org/) (which includes npm)
- [Python](https://www.python.org/downloads/)
- [7-Zip](https://www.7-zip.org/download.html) (ensure it's added to your system's PATH)

### 1. Clone the Repository

First, clone this repository to your local machine using Git:

```bash
git clone https://github.com/your-username/DebMaster.git
cd DebMaster
```

### 2. Install Dependencies

DebMaster uses Node.js for its frontend and Python for its backend. You'll need to install dependencies for both.

**Frontend (Node.js):**
Open your terminal in the project root and run:

```bash
npm install
```

This will install Electron and other required packages.

**Backend (Python):**
The backend requires the `lief` library for patching. Install it using pip:

```bash
pip install lief aiohttp
```

### 3. Run the Application

Once all dependencies are installed, you can start the application in development mode by running:

```bash
npm start
```

This will launch the DebMaster application window.

## How to Use DebMaster

DebMaster is designed to be intuitive, but here’s a quick walkthrough of its core features.

### Fetching from GitHub

1.  Navigate to the **GitHub Repos** tab.
2.  Enter the URL of a GitHub repository that contains `.deb` releases (e.g., `whoeevee/EeveeSpotifyReborn`).
3.  Click **Fetch**. The application will display all available releases with `.deb` assets.
4.  Click the download button next to the asset you want.

### Converting and Patching

- **Standard Applications**: If the downloaded `.deb` is a standard application, DebMaster will automatically convert it to an `.ipa` file and save it in the `converted` folder.
- **Tweaks**: If the `.deb` is a tweak, the process will pause, and you will be prompted to provide a decrypted `.ipa` file to patch.
    1.  An input field will appear asking for the base `.ipa` file.
    2.  Select the correct `.ipa` file from your computer.
    3.  DebMaster will automatically patch the tweak into the `.ipa` and save the new, modified file in the `converted` folder.

## Building the Application

If you want to compile the application into a distributable format, you can use the built-in build scripts.

- **On Windows**: Simply run the `build.bat` file.
- **On macOS/Linux**: Open your terminal and run `npm run dist`.

The compiled application (as a portable executable or installer, depending on the configuration) will be located in the `dist` directory.

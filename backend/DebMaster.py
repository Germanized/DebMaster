#!/usr/bin/env python3
"""
DebMaster - Advanced DEB to IPA Conversion & Patching Engine
Created by: Germanized
Enhanced with robust tweak detection and IPA patching capabilities.
Now supports data.tar and various tar format patching.
"""

import os
import json
import asyncio
import aiohttp
import zipfile
import shutil
import tempfile
import subprocess
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import hashlib
import time
import sys
from urllib.parse import urlparse
import argparse
import tarfile

# Attempt to import LIEF, which is required for patching
try:
    import lief
    LIEF_AVAILABLE = True
except ImportError:
    LIEF_AVAILABLE = False

class EnhancedLogger:
    """Enhanced logging system with file and console output"""
    def __init__(self, name: str, log_dir: str = "logs"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.DEBUG)
        if self.logger.hasHandlers(): self.logger.handlers.clear()
        self._setup_handlers()
    
    def _setup_handlers(self):
        try:
            fh = RotatingFileHandler(self.log_dir / 'debmaster.log', maxBytes=5*1024*1024, backupCount=3, encoding='utf-8')
            fh.setFormatter(logging.Formatter('%(asctime)s|%(levelname)-8s|%(funcName)-15s|%(message)s', '%Y-%m-%d %H:%M:%S'))
            fh.setLevel(logging.DEBUG)
            self.logger.addHandler(fh)
        except Exception as e: print(f"Warning: Could not setup file logging: {e}", file=sys.stderr)
        ch = logging.StreamHandler(sys.stderr)
        ch.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', '%H:%M:%S'))
        ch.setLevel(logging.INFO)
        self.logger.addHandler(ch)

    def log(self, level, msg, **kwargs): self.logger.log(level, f"{msg}" + (f" | {kwargs}" if kwargs else ""))
    def debug(self, msg, **kwargs): self.log(logging.DEBUG, msg, **kwargs)
    def info(self, msg, **kwargs): self.log(logging.INFO, msg, **kwargs)
    def warning(self, msg, **kwargs): self.log(logging.WARNING, msg, **kwargs)
    def error(self, msg, **kwargs): self.log(logging.ERROR, msg, **kwargs)

class TweakDetectedException(Exception): pass

class DebMaster:
    def __init__(self, config_path: str = "debmaster_config.json"):
        self.config_path = config_path
        self.session = None
        self.logger = EnhancedLogger('DebMaster')
        self.config = self._load_config()
        self.logger.info("DebMaster initializing", config=config_path)
        
    def _load_config(self) -> Dict:
        default_config = {"download_dir": "./downloads", "output_dir": "./converted", "github_token": None}
        if Path(self.config_path).exists():
            try:
                with open(self.config_path, 'r') as f: return {**default_config, **json.load(f)}
            except Exception as e: self.logger.error(f"Config load failed: {e}")
        try:
            with open(self.config_path, 'w') as f: json.dump(default_config, f, indent=2)
        except Exception as e: self.logger.warning(f"Could not save config: {e}")
        return default_config
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(headers={'User-Agent': 'DebMaster/3.2'})
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session: await self.session.close()
    
    def _notify_progress(self, event_type: str, status: str, **kwargs):
        message = {"type": event_type, "status": status, "timestamp": datetime.now().isoformat(), **kwargs}
        print(json.dumps(message), flush=True)
        self.logger.debug(f"Progress: {event_type} -> {status}", **kwargs)
    
    async def fetch_github_releases(self, repo_url: str):
        try:
            url_parts = urlparse(repo_url); path_parts = url_parts.path.strip('/').split('/')
            owner, repo = path_parts[0], path_parts[1]
            api_url = f"https://api.github.com/repos/{owner}/{repo}/releases"
            async with self.session.get(api_url) as response:
                if response.status == 200:
                    self._notify_progress('github_releases', 'completed', releases=self._process_releases(await response.json()))
                else:
                    self._notify_progress('github', 'failed', error=f"GitHub API Error: {response.status}")
        except Exception as e: self._notify_progress('github', 'failed', error=str(e))

    def _process_releases(self, releases: List[Dict]) -> List[Dict]:
        processed = []
        for r in releases:
            assets = [{'name': a['name'], 'download_url': a['browser_download_url']} 
                      for a in r.get('assets', []) if a['name'].lower().endswith('.deb')]
            if assets: processed.append({'name': r['name'], 'tag_name': r['tag_name'], 'published_at': r['published_at'], 'deb_assets': assets})
        return processed

    async def download_deb(self, download_url: str) -> Path:
        filename = download_url.split('/')[-1]
        file_path = Path(self.config['download_dir']) / filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        if file_path.exists():
            self._notify_progress('download', 'exists', filename=filename, download_url=download_url, path=str(file_path))
            return file_path
        self._notify_progress('download', 'started', filename=filename, download_url=download_url)
        async with self.session.get(download_url) as response:
            response.raise_for_status()
            with open(file_path, 'wb') as f: f.write(await response.read())
        self._notify_progress('download', 'completed', filename=filename, download_url=download_url, path=str(file_path))
        return file_path

    async def download_and_convert(self, download_url: str):
        try:
            downloaded_path = await self.download_deb(download_url)
            self.convert_deb_to_ipa(downloaded_path, download_url=download_url)
        except TweakDetectedException as e: self.logger.info(str(e))
        except Exception as e:
            self._notify_progress('operation', 'failed', download_url=download_url, error=str(e))
            raise

    def convert_deb_to_ipa(self, deb_path: Path, output_name: str = None, download_url: str = None):
        temp_dir = tempfile.mkdtemp()
        temp_path = Path(temp_dir)
        data_tar_path = self._extract_deb(deb_path, temp_path)
        app_bundle = self._find_app_bundle(temp_path)
        if app_bundle:
            output_path = Path(self.config['output_dir']) / (output_name or deb_path.stem + '.ipa')
            output_path.parent.mkdir(parents=True, exist_ok=True)
            payload_dir = temp_path / "Payload"; payload_dir.mkdir()
            shutil.copytree(app_bundle, payload_dir / app_bundle.name)
            self._create_ipa(temp_path, output_path)
            self._notify_progress('conversion', 'completed', filename=deb_path.name, final_path=str(output_path), download_url=download_url)
            shutil.rmtree(temp_dir)
        elif self._is_tweak(temp_path):
            self._notify_progress('tweak_detected', 'awaiting_ipa', filename=deb_path.name, download_url=download_url, tweak_path=str(data_tar_path))
            raise TweakDetectedException("Halting: Tweak detected.")
        else:
            shutil.rmtree(temp_dir)
            raise Exception("No .app bundle found and not a recognized tweak structure.")

    def _extract_deb(self, deb_path: Path, extract_to: Path) -> Optional[Path]:
        try:
            subprocess.run(['7z', 'x', str(deb_path), f'-o{extract_to}', '-y'], check=True, capture_output=True)
            for data_file in extract_to.glob('data.tar*'):
                subprocess.run(['7z', 'x', str(data_file), f'-o{extract_to}', '-y'], check=True, capture_output=True)
                return data_file # Return the path to the data.tar file
        except FileNotFoundError: raise Exception("7-Zip is not installed or not in system's PATH.")
        except subprocess.CalledProcessError as e: raise Exception(f"Extraction failed: {e.stderr.decode(errors='ignore')}")
        return None

    def _extract_tar_archive(self, tar_path: Path, extract_to: Path):
        """Enhanced tar extraction supporting various formats including data.tar"""
        self.logger.info(f"Extracting tar archive: {tar_path}")
        try:
            # Try with tarfile first (handles most formats)
            with tarfile.open(tar_path, 'r:*') as tar:
                tar.extractall(extract_to)
                self.logger.info(f"Successfully extracted {tar_path} using tarfile")
                return True
        except Exception as e:
            self.logger.warning(f"tarfile extraction failed: {e}, trying 7z")
            
        try:
            # Fallback to 7z
            subprocess.run(['7z', 'x', str(tar_path), f'-o{extract_to}', '-y'], 
                         check=True, capture_output=True)
            self.logger.info(f"Successfully extracted {tar_path} using 7z")
            return True
        except Exception as e:
            self.logger.error(f"Both tarfile and 7z extraction failed for {tar_path}: {e}")
            return False

    def _find_app_bundle(self, search_path: Path) -> Optional[Path]:
        for root, dirs, _ in os.walk(search_path):
            if any(d.endswith('.app') for d in dirs): return Path(root) / next(d for d in dirs if d.endswith('.app'))
        return None

    def _is_tweak(self, search_path: Path) -> bool:
        for root, dirs, _ in os.walk(search_path):
            if "MobileSubstrate" in dirs and "DynamicLibraries" in os.listdir(Path(root) / "MobileSubstrate"):
                self.logger.info(f"Tweak structure found in: {root}")
                return True
        return False

    def _create_ipa(self, source_dir: Path, output_path: Path):
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as ipa:
            payload_path = source_dir / "Payload"
            for root, _, files in os.walk(payload_path):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(source_dir)
                    ipa.write(file_path, arcname)
    
    def _analyze_tweak_structure(self, tweak_path: Path) -> Dict:
        """Analyze the structure of extracted tweak to determine patching strategy"""
        analysis = {
            'dylibs': [],
            'frameworks': [],
            'bundles': [],
            'preferences': [],
            'substrate_filters': [],
            'other_files': [],
            'mobile_substrate_path': None,
            'library_path': None
        }
        
        for root, dirs, files in os.walk(tweak_path):
            root_path = Path(root)
            
            # Look for MobileSubstrate directory
            if "MobileSubstrate" in dirs:
                analysis['mobile_substrate_path'] = root_path / "MobileSubstrate"
                
            # Look for Library directory
            if "Library" in dirs:
                analysis['library_path'] = root_path / "Library"
            
            # Analyze files
            for file in files:
                file_path = root_path / file
                file_lower = file.lower()
                
                if file_lower.endswith('.dylib'):
                    analysis['dylibs'].append(file_path)
                elif file_lower.endswith('.framework'):
                    analysis['frameworks'].append(file_path)
                elif file_lower.endswith('.bundle'):
                    analysis['bundles'].append(file_path)
                elif file_lower.endswith('.plist') and 'preferences' in str(file_path).lower():
                    analysis['preferences'].append(file_path)
                elif file_lower.endswith('.plist') and any(x in str(file_path).lower() for x in ['filter', 'substrate']):
                    analysis['substrate_filters'].append(file_path)
                else:
                    analysis['other_files'].append(file_path)
        
        self.logger.info(f"Tweak analysis: {len(analysis['dylibs'])} dylibs, {len(analysis['frameworks'])} frameworks, {len(analysis['bundles'])} bundles")
        return analysis

    def patch_ipa_with_data_tar(self, ipa_path_str: str, data_tar_path_str: str):
        """Enhanced patching function that can handle data.tar and various tar formats"""
        if not LIEF_AVAILABLE:
            self.logger.error("LIEF library not found. Please install it by running: pip install lief")
            self._notify_progress('operation', 'failed', error="Patching engine (LIEF) not found. Please run 'pip install lief' in your terminal.")
            return

        ipa_path = Path(ipa_path_str)
        data_tar_path = Path(data_tar_path_str)

        # Validate input files
        if not ipa_path.exists():
            self.logger.error(f"IPA file not found: {ipa_path}")
            return
        if not data_tar_path.exists():
            self.logger.error(f"Data tar file not found: {data_tar_path}")
            return

        with tempfile.TemporaryDirectory() as temp_dir:
            self.logger.info(f"Created temporary directory: {temp_dir}")
            self._notify_progress('patch', 'started', ipa=ipa_path.name, data_tar=data_tar_path.name)
            
            # Setup subdirectories
            base_path = Path(temp_dir)
            ipa_extract_path = base_path / 'ipa_extracted'
            tar_extract_path = base_path / 'tar_extracted'
            ipa_extract_path.mkdir()
            tar_extract_path.mkdir()

            try:
                # Extract IPA
                self._notify_progress('patch', 'extracting_ipa')
                with zipfile.ZipFile(ipa_path, 'r') as ipa_zip:
                    ipa_zip.extractall(ipa_extract_path)
                
                app_bundle_path = next((p for p in (ipa_extract_path / 'Payload').iterdir() if p.suffix == '.app'), None)
                if not app_bundle_path:
                    raise FileNotFoundError("Could not find .app bundle in the IPA payload.")
                
                binary_name = app_bundle_path.stem
                main_binary_path = app_bundle_path / binary_name
                if not main_binary_path.exists():
                    raise FileNotFoundError(f"Could not find main binary: {main_binary_path}")
                
                self.logger.info(f"Found app bundle: {app_bundle_path.name}, binary: {main_binary_path.name}")

                # Extract data.tar or tar file
                self._notify_progress('patch', 'extracting_tar')
                if not self._extract_tar_archive(data_tar_path, tar_extract_path):
                    raise Exception("Failed to extract tar archive")

                # Analyze the extracted tweak structure
                tweak_analysis = self._analyze_tweak_structure(tar_extract_path)
                
                if not tweak_analysis['dylibs'] and not tweak_analysis['frameworks']:
                    raise Exception("No dylibs or frameworks found in the tar archive")

                # Copy tweak files to app bundle
                self._notify_progress('patch', 'copying_tweak_files')
                injected_libraries = []
                
                # Handle dylibs
                for dylib_path in tweak_analysis['dylibs']:
                    target_dylib_path = app_bundle_path / dylib_path.name
                    shutil.copy(dylib_path, target_dylib_path)
                    injected_libraries.append(f"@executable_path/{dylib_path.name}")
                    self.logger.info(f"Copied dylib: {dylib_path.name}")

                # Handle frameworks
                for framework_path in tweak_analysis['frameworks']:
                    if framework_path.is_dir():
                        target_framework_path = app_bundle_path / framework_path.name
                        if target_framework_path.exists():
                            shutil.rmtree(target_framework_path)
                        shutil.copytree(framework_path, target_framework_path)
                        # For frameworks, we typically inject the main framework binary
                        framework_binary = target_framework_path / framework_path.stem
                        if framework_binary.exists():
                            injected_libraries.append(f"@executable_path/{framework_path.name}/{framework_path.stem}")
                            self.logger.info(f"Copied framework: {framework_path.name}")

                # Handle bundles (copy but don't inject)
                for bundle_path in tweak_analysis['bundles']:
                    if bundle_path.is_dir():
                        target_bundle_path = app_bundle_path / bundle_path.name
                        if target_bundle_path.exists():
                            shutil.rmtree(target_bundle_path)
                        shutil.copytree(bundle_path, target_bundle_path)
                        self.logger.info(f"Copied bundle: {bundle_path.name}")

                # Handle preference bundles (if any)
                for pref_path in tweak_analysis['preferences']:
                    target_pref_path = app_bundle_path / pref_path.name
                    shutil.copy(pref_path, target_pref_path)
                    self.logger.info(f"Copied preference file: {pref_path.name}")

                if not injected_libraries:
                    raise Exception("No libraries found to inject into the binary")

                # Inject libraries into the main binary using LIEF
                self._notify_progress('patch', 'injecting_libraries')
                self.logger.info(f"Parsing Mach-O binary at {main_binary_path}")
                fat_binary = lief.MachO.parse(str(main_binary_path))
                
                if not fat_binary:
                    raise ValueError("LIEF failed to parse the main binary.")

                # Handle fat binaries by iterating through architectures
                if isinstance(fat_binary, lief.MachO.FatBinary):
                    binaries_to_patch = []
                    for binary in fat_binary:
                        try:
                            # Try different ways to access CPU types based on LIEF version
                            cpu_type = None
                            if hasattr(lief.MachO, 'CPU_TYPES'):
                                cpu_type = binary.header.cpu_type
                                target_types = [lief.MachO.CPU_TYPES.ARM64, lief.MachO.CPU_TYPES.ARM]
                            elif hasattr(lief, 'MachO') and hasattr(lief.MachO, 'CPU_TYPE'):
                                cpu_type = binary.header.cpu_type
                                target_types = [lief.MachO.CPU_TYPE.ARM64, lief.MachO.CPU_TYPE.ARM]
                            elif hasattr(binary.header, 'cpu_type'):
                                cpu_type = binary.header.cpu_type
                                # Use numeric values as fallback (ARM64=12, ARM=7)
                                target_types = [12, 7]
                            
                            if cpu_type and cpu_type in target_types:
                                binaries_to_patch.append(binary)
                        except Exception as e:
                            self.logger.warning(f"Error checking CPU type: {e}")
                            binaries_to_patch.append(binary)  # Add anyway as fallback
                    
                    if not binaries_to_patch:
                        # Try to patch all binaries if no ARM found
                        binaries_to_patch = list(fat_binary)
                        self.logger.warning("No ARM architectures detected, will patch all architectures")
                    
                    self.logger.info(f"Fat binary detected. Will patch {len(binaries_to_patch)} architectures.")
                else:
                    binaries_to_patch = [fat_binary]

                # Inject all libraries into each binary architecture
                for binary_to_patch in binaries_to_patch:
                    for injection_path in injected_libraries:
                        try:
                            binary_to_patch.add_library(injection_path)
                            cpu_info = getattr(binary_to_patch.header, 'cpu_type', 'unknown')
                            self.logger.info(f"Injected '{injection_path}' into architecture {cpu_info}")
                        except Exception as e:
                            self.logger.warning(f"Failed to inject {injection_path}: {e}")

                # Write the patched binary
                fat_binary.write(str(main_binary_path))
                self.logger.info("Successfully injected all libraries into binary.")

                # Re-package the IPA
                self._notify_progress('patch', 'repackaging_ipa')
                output_dir = Path(self.config['output_dir'])
                output_dir.mkdir(parents=True, exist_ok=True)
                output_ipa_name = f"{ipa_path.stem}-patched-{data_tar_path.stem}.ipa"
                output_ipa_path = output_dir / output_ipa_name
                
                self.logger.info(f"Creating final IPA at {output_ipa_path}")
                self._create_ipa(ipa_extract_path, output_ipa_path)
                
                self.logger.info("Advanced patching process completed successfully.")
                self._notify_progress('operation', 'completed', 
                                   final_path=str(output_ipa_path),
                                   libraries_injected=len(injected_libraries),
                                   dylibs_count=len(tweak_analysis['dylibs']),
                                   frameworks_count=len(tweak_analysis['frameworks']))

            except Exception as e:
                self.logger.error(f"Patching failed: {str(e)}")
                self._notify_progress('operation', 'failed', error=str(e))
                raise
    
    def patch_ipa_with_tweak(self, ipa_path_str: str, tweak_deb_path_str: str):
        """Legacy method - redirects to enhanced patching after extracting deb"""
        if not LIEF_AVAILABLE:
            self.logger.error("LIEF library not found. Please install it by running: pip install lief")
            self._notify_progress('operation', 'failed', error="Patching engine (LIEF) not found. Please run 'pip install lief' in your terminal.")
            return

        tweak_deb_path = Path(tweak_deb_path_str)
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Extract the deb file
            self._extract_deb(tweak_deb_path, temp_path)
            
            # Look for data.tar files
            data_tar_files = list(temp_path.glob('data.tar*'))
            if data_tar_files:
                # Use the first data.tar file found
                self.patch_ipa_with_data_tar(ipa_path_str, str(data_tar_files[0]))
            else:
                # Fallback to original method for direct dylib injection
                self._legacy_patch_ipa_with_tweak(ipa_path_str, tweak_deb_path_str, temp_path)

    def _legacy_patch_ipa_with_tweak(self, ipa_path_str: str, tweak_deb_path_str: str, extracted_path: Path):
        """Original patching method for backward compatibility"""
        ipa_path = Path(ipa_path_str)
        tweak_deb_path = Path(tweak_deb_path_str)

        with tempfile.TemporaryDirectory() as temp_dir:
            self.logger.info(f"Created temporary directory: {temp_dir}")
            self._notify_progress('patch', 'started', ipa=ipa_path.name, tweak=tweak_deb_path.name)
            
            # Setup subdirectories
            base_path = Path(temp_dir)
            ipa_extract_path = base_path / 'ipa_extracted'
            ipa_extract_path.mkdir()

            # Extract IPA
            self._notify_progress('patch', 'extracting_ipa')
            with zipfile.ZipFile(ipa_path, 'r') as ipa_zip:
                ipa_zip.extractall(ipa_extract_path)
            
            app_bundle_path = next((p for p in (ipa_extract_path / 'Payload').iterdir() if p.suffix == '.app'), None)
            if not app_bundle_path: raise FileNotFoundError("Could not find .app bundle in the IPA payload.")
            
            binary_name = app_bundle_path.stem
            main_binary_path = app_bundle_path / binary_name
            if not main_binary_path.exists(): raise FileNotFoundError(f"Could not find main binary: {main_binary_path}")
            self.logger.info(f"Found app bundle: {app_bundle_path.name}, binary: {main_binary_path.name}")

            # Find dylib in extracted tweak
            dylib_path = next(extracted_path.glob('**/*.dylib'), None)
            if not dylib_path: raise FileNotFoundError("Could not find .dylib in tweak files.")
            self.logger.info(f"Found tweak dylib: {dylib_path.name}")

            # Copy dylib to .app bundle
            target_dylib_path = app_bundle_path / dylib_path.name
            shutil.copy(dylib_path, target_dylib_path)
            self.logger.info(f"Copied dylib to {target_dylib_path}")

            # Inject dylib into the main binary using LIEF
            self._notify_progress('patch', 'injecting_dylib')
            self.logger.info(f"Parsing Mach-O binary at {main_binary_path}")
            fat_binary = lief.MachO.parse(str(main_binary_path))
            if not fat_binary: raise ValueError("LIEF failed to parse the main binary.")

            # Handle fat binaries by iterating through architectures
            if isinstance(fat_binary, lief.MachO.FatBinary):
                binary_to_patch = None
                for binary in fat_binary:
                    try:
                        # Try different ways to access CPU types based on LIEF version
                        cpu_type = binary.header.cpu_type
                        
                        # Check for ARM64 using different API approaches
                        is_arm64 = False
                        if hasattr(lief.MachO, 'CPU_TYPES') and hasattr(lief.MachO.CPU_TYPES, 'ARM64'):
                            is_arm64 = (cpu_type == lief.MachO.CPU_TYPES.ARM64)
                        elif hasattr(lief, 'MachO') and hasattr(lief.MachO, 'CPU_TYPE') and hasattr(lief.MachO.CPU_TYPE, 'ARM64'):
                            is_arm64 = (cpu_type == lief.MachO.CPU_TYPE.ARM64)
                        elif cpu_type == 12:  # ARM64 = 12 (fallback to numeric value)
                            is_arm64 = True
                        
                        if is_arm64:
                            binary_to_patch = binary
                            self.logger.info("Fat binary detected. Selected ARM64 slice.")
                            break
                    except Exception as e:
                        self.logger.warning(f"Error checking CPU type: {e}")
                        continue
                        
                if not binary_to_patch:
                    # Fallback: use first binary
                    binary_to_patch = next(iter(fat_binary), None)
                    if binary_to_patch:
                        self.logger.warning("Could not find ARM64 slice, using first available architecture.")
                    else:
                        raise ValueError("Could not find any binary slice in the fat binary.")
            else:
                binary_to_patch = fat_binary

            injection_path = f"@executable_path/{target_dylib_path.name}"
            binary_to_patch.add_library(injection_path)
            
            # Overwrite the original binary with the patched version
            fat_binary.write(str(main_binary_path))
            self.logger.info(f"Successfully injected '{injection_path}' into binary.")

            # Re-package the IPA
            self._notify_progress('patch', 'repackaging_ipa')
            output_dir = Path(self.config['output_dir'])
            output_dir.mkdir(parents=True, exist_ok=True)
            output_ipa_name = f"{ipa_path.stem}-patched.ipa"
            output_ipa_path = output_dir / output_ipa_name
            
            self.logger.info(f"Creating final IPA at {output_ipa_path}")
            self._create_ipa(ipa_extract_path, output_ipa_path)
            
            self.logger.info("Patching process completed successfully.")
            self._notify_progress('operation', 'completed', final_path=str(output_ipa_path))

async def main():
    parser = argparse.ArgumentParser(description='DebMaster - DEB to IPA Converter & Advanced Patcher')
    parser.add_argument('--github', help='GitHub repository URL')
    parser.add_argument('--convert', help='Local .deb file to convert')
    parser.add_argument('--download-url', help='URL of .deb file to download and convert')
    parser.add_argument('--patch', help='Path to the base .ipa file to be patched')
    parser.add_argument('--with-tweak', help='Path to the tweak .deb file')
    parser.add_argument('--with-data-tar', help='Path to data.tar or tar file for advanced patching')
    parser.add_argument('--config', default='debmaster_config.json')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    async with DebMaster(config_path=args.config) as manager:
        try:
            if args.github: 
                await manager.fetch_github_releases(args.github)
            elif args.download_url: 
                await manager.download_and_convert(args.download_url)
            elif args.convert: 
                manager.convert_deb_to_ipa(Path(args.convert), download_url=f"local:{args.convert}")
            elif args.patch and args.with_data_tar:
                manager.patch_ipa_with_data_tar(args.patch, args.with_data_tar)
            elif args.patch and args.with_tweak: 
                manager.patch_ipa_with_tweak(args.patch, args.with_tweak)
            else: 
                parser.print_help()
                print("\nExamples:")
                print("  # Patch IPA with data.tar file:")
                print("  python debmaster.py --patch app.ipa --with-data-tar data.tar")
                print("  # Patch IPA with .deb file (legacy):")
                print("  python debmaster.py --patch app.ipa --with-tweak tweak.deb")
        except TweakDetectedException: 
            sys.exit(0)
        except Exception as e:
            manager.logger.error(f"A fatal error occurred in main: {str(e)}", exc_info=args.verbose)
            manager._notify_progress('fatal_error', 'failed', error=str(e))
            sys.exit(1)

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())

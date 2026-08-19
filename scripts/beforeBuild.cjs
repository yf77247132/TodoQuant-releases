const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ELECTRON_PROCESS_NAMES = ['TodoQuant.exe', 'electron.exe'];

function findElectronProcesses() {
  try {
    if (process.platform === 'win32') {
      const output = execSync('tasklist /FI "IMAGENAME eq TodoQuant.exe" /FI "IMAGENAME eq electron.exe" /FO CSV /NH', {
        encoding: 'utf-8',
        timeout: 5000
      }).toString();
      
      const processes = [];
      const lines = output.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.includes('TodoQuant.exe') || line.includes('electron.exe')) {
          const match = line.match(/"([^"]+)"/g);
          if (match && match[1]) {
            const pid = match[1].replace(/"/g, '');
            if (pid && !isNaN(parseInt(pid))) {
              processes.push({
                name: match[0].replace(/"/g, ''),
                pid: parseInt(pid)
              });
            }
          }
        }
      }
      return processes;
    }
    return [];
  } catch (e) {
    console.log('[BeforeBuild] Warning: Failed to check running processes:', e.message);
    return [];
  }
}

function killElectronProcesses() {
  const processes = findElectronProcesses();
  
  if (processes.length === 0) {
    console.log('[BeforeBuild] No running Electron processes found.');
    return true;
  }
  
  console.log(`[BeforeBuild] Found ${processes.length} running Electron process(es):`);
  processes.forEach(p => console.log(`  - ${p.name} (PID: ${p.pid})`));
  
  console.log('[BeforeBuild] Attempting to terminate Electron processes...');
  
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM TodoQuant.exe', { 
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }
  } catch (e) {
    if (!e.message.includes('not found') && !e.message.includes('找不到')) {
      console.log('[BeforeBuild] Warning: Failed to kill processes:', e.message);
    }
  }
  
  const remaining = findElectronProcesses();
  if (remaining.length > 0) {
    console.error('[BeforeBuild] ERROR: Could not terminate all Electron processes.');
    console.error('[BeforeBuild] Please manually close the Electron client and try again.');
    return false;
  }
  
  console.log('[BeforeBuild] All Electron processes terminated successfully.');
  return true;
}

function cleanLockedFiles(projectRoot) {
  const releaseDir = path.join(projectRoot, 'release');
  
  if (!fs.existsSync(releaseDir)) {
    return true;
  }
  
  console.log('[BeforeBuild] Checking release directory for locked files...');
  
  try {
    const testFile = path.join(releaseDir, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('[BeforeBuild] Release directory is writable.');
    return true;
  } catch (e) {
    console.log('[BeforeBuild] Warning: Release directory may have locked files:', e.message);
    console.log('[BeforeBuild] Attempting to clean release directory...');
    
    try {
      fs.rmSync(releaseDir, { recursive: true, force: true });
      fs.mkdirSync(releaseDir, { recursive: true });
      console.log('[BeforeBuild] Release directory cleaned successfully.');
      return true;
    } catch (cleanErr) {
      console.error('[BeforeBuild] Failed to clean release directory:', cleanErr.message);
      console.error('[BeforeBuild] Please close any applications using these files and try again.');
      return false;
    }
  }
}

function cleanNodeFiles(projectRoot) {
  console.log('[BeforeBuild] Cleaning .node native module files...');
  
  const nodeModulesDir = path.join(projectRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    return true;
  }
  
  let cleaned = 0;
  
  function cleanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          cleanDir(fullPath);
        } else if (entry.name.endsWith('.node')) {
          try {
            fs.unlinkSync(fullPath);
            cleaned++;
          } catch (e) {
          }
        }
      }
    } catch (e) {
    }
  }
  
  cleanDir(nodeModulesDir);
  
  if (cleaned > 0) {
    console.log(`[BeforeBuild] Cleaned ${cleaned} .node files (will be rebuilt by @electron/rebuild).`);
  }
  
  return true;
}

exports.default = async function beforeBuild(context) {
  console.log('[BeforeBuild] Running pre-build tasks...');
  
  const projectRoot = context.appDir;
  
  if (!killElectronProcesses()) {
    throw new Error('Electron processes could not be terminated. Please close the application manually.');
  }
  
  if (!cleanLockedFiles(projectRoot)) {
    throw new Error('Failed to clean locked files in release directory.');
  }
  
  const buildDir = path.join(projectRoot, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  const distDir = path.join(projectRoot, 'dist');
  const distServerDir = path.join(projectRoot, 'dist-server');
  
  if (!fs.existsSync(distDir)) {
    console.log('[BeforeBuild] Creating empty dist directory...');
    fs.mkdirSync(distDir, { recursive: true });
  }
  
  if (!fs.existsSync(distServerDir)) {
    console.log('[BeforeBuild] Creating empty dist-server directory...');
    fs.mkdirSync(distServerDir, { recursive: true });
  }
  
  console.log('[BeforeBuild] Pre-build tasks completed successfully.');
};

import { spawn, ChildProcess, execFileSync } from 'child_process';
import path from 'path';
import { LogService } from './logService.ts';

type TunnelStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopped';

const MAX_START_RETRIES = 2;
const TUNNEL_TIMEOUT_MS = 30000;

class TunnelManager {
  private process: ChildProcess | null = null;
  private url: string = '';
  private status: TunnelStatus = 'idle';
  private static instance: TunnelManager;

  static getInstance(): TunnelManager {
    if (!TunnelManager.instance) {
      TunnelManager.instance = new TunnelManager();
    }
    return TunnelManager.instance;
  }

  getStatus(): { status: TunnelStatus; url: string } {
    return { status: this.status, url: this.url };
  }

  async start(localPort: number): Promise<string> {
    if (this.status === 'running' && this.url) {
      return this.url;
    }

    const cloudflared = await this.findCloudflared();
    if (!cloudflared) {
      this.status = 'error';
      throw new Error('未找到 cloudflared（bin/ 目录缺少 cloudflared 文件），请手动安装: winget install Cloudflare.cloudflared');
    }

    const TUNNEL_STARTUP_DELAY_MS = 5000;
    LogService.logKey('system', 'bootstrap.tunnel.waiting', { sec: TUNNEL_STARTUP_DELAY_MS / 1000 }, 'info');
    await new Promise(r => setTimeout(r, TUNNEL_STARTUP_DELAY_MS));

    for (let attempt = 0; attempt <= MAX_START_RETRIES; attempt++) {
      try {
        return await this.attemptStart(cloudflared, localPort, attempt);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (attempt < MAX_START_RETRIES && this.shouldRetry(err)) {
          LogService.logKey('system', 'bootstrap.tunnel.retry', { attempt: attempt + 1, max: MAX_START_RETRIES }, 'warn');
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Cloudflare Tunnel 启动失败');
  }

  private shouldRetry(err: Error): boolean {
    const retryableMessages = [
      'invalid UUID length', 'invalid character', 'unmarshaling',
      'timeout', 'ETIMEDOUT', 'ECONNREFUSED', 'i/o timeout',
      'EOF', 'failed to dial', 'failed to request', 'status_code=500',
      'quick Tunnel ID', 'no recent network activity',
      '网络问题', 'Cloudflare 服务端临时故障',
    ];
    return retryableMessages.some(msg => err.message.toLowerCase().includes(msg.toLowerCase()));
  }

  private attemptStart(cloudflared: string, localPort: number, attempt: number): Promise<string> {
    this.status = 'starting';
    this.url = '';

    if (attempt > 0) {
      LogService.logKey('system', 'bootstrap.tunnel.starting', { bin: cloudflared, attempt: attempt + 1 }, 'info');
    } else {
      LogService.logKey('system', 'bootstrap.tunnel.starting', { bin: cloudflared }, 'info');
    }

    return new Promise((resolve, reject) => {
      const targetUrl = `http://localhost:${localPort}`;
      let child: ChildProcess;

      if (process.platform === 'win32') {
        child = spawn(`"${cloudflared}" tunnel --protocol http2 --url "${targetUrl}"`, [], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: true,
          env: { ...process.env },
        });
      } else {
        child = spawn(cloudflared, ['tunnel', '--protocol', 'http2', '--url', targetUrl], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: { ...process.env },
        });
      }

      this.process = child;

      let resolved = false;
      const cleanup = () => { clearTimeout(timeout); };

      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this.status = 'error';
        this.kill();
        reject(new Error('Cloudflare Tunnel 启动超时（30秒），请检查防火墙是否允许 cloudflared 访问网络'));
      }, TUNNEL_TIMEOUT_MS);

      const onTunnelUrl = (output: string) => {
        const match = output.match(/https:\/\/(?!api\.)[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          cleanup();
          this.url = match[0];
          this.status = 'running';
          LogService.logKey('system', 'bootstrap.tunnel.ready', { url: this.url }, 'info');
          resolve(this.url);
        }
      };

      this.process.stdout?.on('data', (d: Buffer) => onTunnelUrl(d.toString()));

      this.process.stderr?.on('data', (d: Buffer) => {
        onTunnelUrl(d.toString().trim());
      });

      this.process.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          const errMsg = code === 1
            ? '网络问题或 Cloudflare 服务端临时故障'
            : `进程退出，退出码: ${code}`;
          this.status = 'error';
          this.process = null;
          reject(new Error(errMsg));
        } else {
          this.status = 'stopped';
          this.url = '';
          this.process = null;
          if (code !== 0) {
            LogService.addLog('system', `Cloudflare Tunnel 进程异常退出，退出码: ${code}`, 'warn');
          }
        }
      });

      this.process.on('error', (err) => {
        if (!resolved) { resolved = true; cleanup(); }
        this.status = 'error';
        reject(err);
      });
    });
  }

  stop(): void {
    this.kill();
    this.status = 'stopped';
    this.url = '';
  }

  private kill(): void {
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch {  }
      this.process = null;
    }
  }

  private findCloudflared(): string | null {
    const binDir = path.join(process.cwd(), 'bin');

    const archFileMap: Record<string, string> = {
      x64: 'cloudflared',
      ia32: 'cloudflared-windows-386',
    };
    const localBin = path.join(binDir, archFileMap[process.arch] || 'cloudflared');

    for (const cmd of [localBin, 'cloudflared', 'C:\\Program Files\\cloudflared\\cloudflared.exe']) {
      try {
        execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 5000 });
        return cmd;
      } catch {
        continue;
      }
    }
    return null;
  }
}

export const tunnelManager = TunnelManager.getInstance();

// Playwright MCP для Claude Code (.mcp.json): браузер, которым Claude сам открывает программу и смотрит окна (стенд
// tests/ui/progon.py или запущенный сервер). Версия закреплена; в облачном сеансе — Chromium из /opt/pw-browsers
// (без скачивания), на ПК — браузер Playwright или установленный Chrome. Только своя временная папка профиля (--isolated).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

class PlaywrightMcp {
  static VERSION = '@playwright/mcp@0.0.83';
  static BROWSERS = '/opt/pw-browsers';

  static chromium(){
    if (process.env.KP_CHROMIUM && existsSync(process.env.KP_CHROMIUM)) return process.env.KP_CHROMIUM;
    if (!existsSync(this.BROWSERS)) return null;
    const dirs = readdirSync(this.BROWSERS).filter(d => /^chromium-\d+$/.test(d)).sort();
    const exe = dirs.length ? `${this.BROWSERS}/${dirs[dirs.length - 1]}/chrome-linux/chrome` : null;
    return exe && existsSync(exe) ? exe : null;
  }

  static run(){
    const args = ['--yes', this.VERSION, '--headless', '--isolated'];
    const exe = this.chromium();
    if (exe) args.push('--executable-path', exe);
    // облачный контейнер работает от root — там песочница Chromium не запускается; на ПК песочница остаётся
    if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
    const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('exit', code => process.exit(code ?? 0));
  }
}

PlaywrightMcp.run();

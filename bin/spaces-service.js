#!/usr/bin/env node

'use strict';

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const readline = require('readline');

const SPACES_DIR = path.join(os.homedir(), '.spaces');
const CONFIG_PATH = path.join(SPACES_DIR, 'server.json');
const LOGS_DIR = path.join(SPACES_DIR, 'logs');
const SERVICE_NAME = 'spaces';
const LABEL = 'com.agentspaces.spaces';
const TASK_NAME = 'Spaces';

// ─── Helpers ──────────────────────────────────────────────────
function log(msg) { console.log(`  ${msg}`); }
function logOk(msg) { console.log(`  ✓ ${msg}`); }
function logErr(msg) { console.error(`  ✗ ${msg}`); }

function resolveConfig() {
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  }
  return {
    port: config.port || 3457,
    tier: config.tier || 'community',
    basePath: config.basePath || '',
    allowedOrigins: config.allowedOrigins || '',
  };
}

function resolveSpacesPath() {
  return path.join(__dirname, 'spaces.js');
}

function resolveProjectDir() {
  return path.join(__dirname, '..');
}

function resolveNodePath() {
  return process.execPath;
}

function promptLevel() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('');
    log('Install as:');
    log('  1. System service (starts on boot, all users)');
    log('  2. User service (starts on login, current user only)');
    console.log('');
    rl.question('  Choice [2]: ', (answer) => {
      rl.close();
      const choice = answer.trim() || '2';
      resolve(choice === '1' ? 'system' : 'user');
    });
  });
}

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const LEVEL_PATH = path.join(SPACES_DIR, 'service-level');

function saveLevel(level) {
  fs.mkdirSync(SPACES_DIR, { recursive: true });
  fs.writeFileSync(LEVEL_PATH, level);
}

function loadLevel() {
  try { return fs.readFileSync(LEVEL_PATH, 'utf-8').trim(); } catch { return null; }
}

// ─── Platform detection ───────────────────────────────────────
function getPlatform() {
  switch (process.platform) {
    case 'linux': return 'linux';
    case 'darwin': return 'darwin';
    case 'win32': return 'win32';
    default:
      logErr(`Unsupported platform: ${process.platform}`);
      process.exit(1);
  }
}

// ─── Linux (systemd) ─────────────────────────────────────────
function linuxServicePath(level) {
  if (level === 'system') {
    return `/etc/systemd/system/${SERVICE_NAME}.service`;
  }
  const userDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  fs.mkdirSync(userDir, { recursive: true });
  return path.join(userDir, `${SERVICE_NAME}.service`);
}

function linuxUnitFile(level) {
  const config = resolveConfig();
  const nodePath = resolveNodePath();
  const spacesPath = resolveSpacesPath();
  const projectDir = resolveProjectDir();

  let envLines = [
    `Environment=SPACES_PORT=${config.port}`,
    `Environment=SPACES_TIER=${config.tier}`,
  ];
  if (config.basePath) {
    envLines.push(`Environment=SPACES_BASE_PATH=${config.basePath}`);
  }
  if (config.allowedOrigins) {
    envLines.push(`Environment=SPACES_ALLOWED_ORIGINS=${config.allowedOrigins}`);
  }

  let serviceSection = [
    'Type=simple',
    `ExecStart=${nodePath} ${spacesPath}`,
    `WorkingDirectory=${projectDir}`,
    ...envLines,
    'Restart=on-failure',
    'RestartSec=5',
  ];

  if (level === 'system') {
    const username = os.userInfo().username;
    serviceSection.push(`User=${username}`);
    serviceSection.push(`Group=${username}`);
  }

  const wantedBy = level === 'system' ? 'multi-user.target' : 'default.target';

  return [
    '[Unit]',
    'Description=Spaces - Agent Workspace Manager',
    'After=network.target',
    '',
    '[Service]',
    ...serviceSection,
    '',
    '[Install]',
    `WantedBy=${wantedBy}`,
    '',
  ].join('\n');
}

function linuxSystemctl(level, ...args) {
  if (level === 'system') {
    execFileSync('sudo', ['systemctl', ...args], { stdio: 'inherit' });
  } else {
    execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' });
  }
}

async function linuxInstall() {
  const level = await promptLevel();
  const unitContent = linuxUnitFile(level);
  const servicePath = linuxServicePath(level);

  log(`Writing unit file to ${servicePath}`);
  if (level === 'system') {
    const result = spawnSync('sudo', ['tee', servicePath], {
      input: unitContent,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    if (result.status !== 0) {
      logErr('Failed to write unit file');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(servicePath, unitContent);
  }
  logOk('Unit file written');

  saveLevel(level);

  linuxSystemctl(level, 'daemon-reload');
  logOk('Reloaded systemd daemon');

  linuxSystemctl(level, 'enable', `${SERVICE_NAME}.service`);
  logOk('Service enabled');

  linuxSystemctl(level, 'start', `${SERVICE_NAME}.service`);
  logOk('Service started');

  if (level === 'user') {
    try {
      execFileSync('loginctl', ['enable-linger', os.userInfo().username], { stdio: 'inherit' });
      logOk('Enabled login lingering for user service');
    } catch {
      log('Warning: could not enable-linger (user service may not start on boot)');
    }
  }

  logOk(`Spaces installed as ${level} service`);
}

async function linuxUninstall() {
  const level = loadLevel() || 'user';
  const servicePath = linuxServicePath(level);

  try {
    linuxSystemctl(level, 'stop', `${SERVICE_NAME}.service`);
    logOk('Service stopped');
  } catch {
    log('Service was not running');
  }

  try {
    linuxSystemctl(level, 'disable', `${SERVICE_NAME}.service`);
    logOk('Service disabled');
  } catch {
    log('Service was not enabled');
  }

  try {
    if (level === 'system') {
      execFileSync('sudo', ['rm', '-f', servicePath], { stdio: 'inherit' });
    } else {
      fs.unlinkSync(servicePath);
    }
    logOk('Unit file removed');
  } catch {
    log('Unit file was already removed');
  }

  try {
    linuxSystemctl(level, 'daemon-reload');
    logOk('Reloaded systemd daemon');
  } catch {
    log('Warning: daemon-reload failed');
  }

  try {
    fs.unlinkSync(LEVEL_PATH);
  } catch {}

  logOk('Spaces service uninstalled');
}

async function linuxStart() {
  const level = loadLevel() || 'user';
  linuxSystemctl(level, 'start', `${SERVICE_NAME}.service`);
  logOk('Service started');
}

async function linuxStop() {
  const level = loadLevel() || 'user';
  linuxSystemctl(level, 'stop', `${SERVICE_NAME}.service`);
  logOk('Service stopped');
}

async function linuxStatus() {
  const level = loadLevel() || 'user';
  try {
    linuxSystemctl(level, 'status', `${SERVICE_NAME}.service`);
  } catch {
    // systemctl status returns non-zero for stopped/failed services
  }
}

async function linuxLogs() {
  const level = loadLevel() || 'user';
  if (level === 'user') {
    spawnSync('journalctl', ['--user', '-u', SERVICE_NAME, '-f', '--no-pager'], { stdio: 'inherit' });
  } else {
    spawnSync('sudo', ['journalctl', '-u', SERVICE_NAME, '-f', '--no-pager'], { stdio: 'inherit' });
  }
}

// ─── macOS (launchd) ─────────────────────────────────────────
function darwinPlistPath(level) {
  if (level === 'system') {
    return `/Library/LaunchDaemons/${LABEL}.plist`;
  }
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function darwinPlistContent(level) {
  ensureLogsDir();
  const config = resolveConfig();
  const nodePath = resolveNodePath();
  const spacesPath = resolveSpacesPath();
  const projectDir = resolveProjectDir();
  const outLog = path.join(LOGS_DIR, 'spaces.out.log');
  const errLog = path.join(LOGS_DIR, 'spaces.err.log');

  let envEntries = [
    `      <key>SPACES_PORT</key>`,
    `      <string>${config.port}</string>`,
    `      <key>SPACES_TIER</key>`,
    `      <string>${config.tier}</string>`,
  ];
  if (config.basePath) {
    envEntries.push(`      <key>SPACES_BASE_PATH</key>`);
    envEntries.push(`      <string>${config.basePath}</string>`);
  }
  if (config.allowedOrigins) {
    envEntries.push(`      <key>SPACES_ALLOWED_ORIGINS</key>`);
    envEntries.push(`      <string>${config.allowedOrigins}</string>`);
  }

  let extraKeys = '';
  if (level === 'system') {
    extraKeys = `    <key>UserName</key>\n    <string>${os.userInfo().username}</string>\n`;
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `    <key>Label</key>`,
    `    <string>${LABEL}</string>`,
    `    <key>ProgramArguments</key>`,
    `    <array>`,
    `      <string>${nodePath}</string>`,
    `      <string>${spacesPath}</string>`,
    `    </array>`,
    `    <key>WorkingDirectory</key>`,
    `    <string>${projectDir}</string>`,
    `    <key>EnvironmentVariables</key>`,
    `    <dict>`,
    ...envEntries,
    `    </dict>`,
    `    <key>RunAtLoad</key>`,
    `    <true/>`,
    `    <key>KeepAlive</key>`,
    `    <true/>`,
    `    <key>StandardOutPath</key>`,
    `    <string>${outLog}</string>`,
    `    <key>StandardErrorPath</key>`,
    `    <string>${errLog}</string>`,
    extraKeys ? extraKeys.trimEnd() : null,
    '</dict>',
    '</plist>',
    '',
  ].filter((line) => line !== null).join('\n');
}

async function darwinInstall() {
  const level = await promptLevel();
  const plistPath = darwinPlistPath(level);
  const plistContent = darwinPlistContent(level);

  // Unload existing (ignore errors)
  try {
    execFileSync('launchctl', ['unload', '-w', plistPath], { stdio: 'pipe' });
  } catch {}

  log(`Writing plist to ${plistPath}`);
  if (level === 'system') {
    const result = spawnSync('sudo', ['tee', plistPath], {
      input: plistContent,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    if (result.status !== 0) {
      logErr('Failed to write plist file');
      process.exit(1);
    }
    execFileSync('sudo', ['chown', 'root:wheel', plistPath], { stdio: 'inherit' });
    execFileSync('sudo', ['chmod', '644', plistPath], { stdio: 'inherit' });
  } else {
    const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(plistPath, plistContent);
  }
  logOk('Plist file written');

  saveLevel(level);

  if (level === 'system') {
    execFileSync('sudo', ['launchctl', 'load', '-w', plistPath], { stdio: 'inherit' });
  } else {
    execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' });
  }
  logOk('Service loaded');

  logOk(`Spaces installed as ${level} service`);
}

async function darwinUninstall() {
  const level = loadLevel() || 'user';
  const plistPath = darwinPlistPath(level);

  try {
    if (level === 'system') {
      execFileSync('sudo', ['launchctl', 'unload', '-w', plistPath], { stdio: 'inherit' });
    } else {
      execFileSync('launchctl', ['unload', '-w', plistPath], { stdio: 'inherit' });
    }
    logOk('Service unloaded');
  } catch {
    log('Service was not loaded');
  }

  try {
    if (level === 'system') {
      execFileSync('sudo', ['rm', '-f', plistPath], { stdio: 'inherit' });
    } else {
      fs.unlinkSync(plistPath);
    }
    logOk('Plist file removed');
  } catch {
    log('Plist file was already removed');
  }

  try {
    fs.unlinkSync(LEVEL_PATH);
  } catch {}

  logOk('Spaces service uninstalled');
}

async function darwinStart() {
  const level = loadLevel() || 'user';
  const plistPath = darwinPlistPath(level);
  if (level === 'system') {
    execFileSync('sudo', ['launchctl', 'load', '-w', plistPath], { stdio: 'inherit' });
  } else {
    execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' });
  }
  logOk('Service started');
}

async function darwinStop() {
  const level = loadLevel() || 'user';
  const plistPath = darwinPlistPath(level);
  if (level === 'system') {
    execFileSync('sudo', ['launchctl', 'unload', '-w', plistPath], { stdio: 'inherit' });
  } else {
    execFileSync('launchctl', ['unload', '-w', plistPath], { stdio: 'inherit' });
  }
  logOk('Service stopped');
}

async function darwinStatus() {
  try {
    const result = execFileSync('launchctl', ['list'], { encoding: 'utf-8' });
    const lines = result.split('\n').filter((line) => line.includes(LABEL));
    if (lines.length > 0) {
      log('Spaces service status:');
      lines.forEach((line) => log(line));
    } else {
      log('Spaces service is not loaded');
    }
  } catch {
    log('Spaces service is not loaded');
  }
}

async function darwinLogs() {
  ensureLogsDir();
  const outLogPath = path.join(LOGS_DIR, 'spaces.out.log');
  if (!fs.existsSync(outLogPath)) {
    logErr(`Log file not found: ${outLogPath}`);
    log('Service may not have started yet');
    process.exit(1);
  }
  spawnSync('tail', ['-f', outLogPath], { stdio: 'inherit' });
}

// ─── Windows (Task Scheduler) ────────────────────────────────
async function win32Install() { logErr('Windows service: not yet implemented'); process.exit(1); }
async function win32Uninstall() { logErr('Windows service: not yet implemented'); process.exit(1); }
async function win32Start() { logErr('Windows service: not yet implemented'); process.exit(1); }
async function win32Stop() { logErr('Windows service: not yet implemented'); process.exit(1); }
async function win32Status() { logErr('Windows service: not yet implemented'); process.exit(1); }
async function win32Logs() { logErr('Windows service: not yet implemented'); process.exit(1); }

// ─── Dispatch table ──────────────────────────────────────────
const platforms = {
  linux: { install: linuxInstall, uninstall: linuxUninstall, start: linuxStart, stop: linuxStop, status: linuxStatus, logs: linuxLogs },
  darwin: { install: darwinInstall, uninstall: darwinUninstall, start: darwinStart, stop: darwinStop, status: darwinStatus, logs: darwinLogs },
  win32: { install: win32Install, uninstall: win32Uninstall, start: win32Start, stop: win32Stop, status: win32Status, logs: win32Logs },
};

// ─── CLI ──────────────────────────────────────────────────────
async function main() {
  const action = process.argv[2];
  const platform = getPlatform();
  const dispatch = platforms[platform];

  if (!action || !dispatch[action]) {
    log('Usage: spaces service <install|uninstall|start|stop|status|logs>');
    process.exit(action ? 1 : 0);
  }

  await dispatch[action]();
}

main().catch((err) => {
  logErr(err.message);
  process.exit(1);
});

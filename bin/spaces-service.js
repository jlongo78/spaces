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
async function linuxInstall() { logErr('Linux service: not yet implemented'); process.exit(1); }
async function linuxUninstall() { logErr('Linux service: not yet implemented'); process.exit(1); }
async function linuxStart() { logErr('Linux service: not yet implemented'); process.exit(1); }
async function linuxStop() { logErr('Linux service: not yet implemented'); process.exit(1); }
async function linuxStatus() { logErr('Linux service: not yet implemented'); process.exit(1); }
async function linuxLogs() { logErr('Linux service: not yet implemented'); process.exit(1); }

// ─── macOS (launchd) ─────────────────────────────────────────
async function darwinInstall() { logErr('macOS service: not yet implemented'); process.exit(1); }
async function darwinUninstall() { logErr('macOS service: not yet implemented'); process.exit(1); }
async function darwinStart() { logErr('macOS service: not yet implemented'); process.exit(1); }
async function darwinStop() { logErr('macOS service: not yet implemented'); process.exit(1); }
async function darwinStatus() { logErr('macOS service: not yet implemented'); process.exit(1); }
async function darwinLogs() { logErr('macOS service: not yet implemented'); process.exit(1); }

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

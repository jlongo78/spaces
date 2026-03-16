import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { readConfig } from '@/lib/config';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  const userHome = require('os').homedir();
  const config = readConfig(user);
  const devDirs = (config.devDirectories.length > 0 ? config.devDirectories : [userHome])
    .map(d => path.resolve(d));

  const dir = request.nextUrl.searchParams.get('path') || devDirs[0];

  try {
    const resolved = path.resolve(dir);

    // Validate the path is within an allowed dev directory
    const allowedRoot = devDirs.find(d => resolved === d || resolved.startsWith(d + path.sep));
    if (!allowedRoot) {
      return NextResponse.json({ current: dir, parent: null, folders: [], error: 'Access denied' }, { status: 403 });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });

    const folders = entries
      .filter(e => {
        if (!e.isDirectory()) return false;
        if (e.name.startsWith('.') || e.name === 'node_modules') return false;
        return true;
      })
      .map(e => ({
        name: e.name,
        path: path.join(resolved, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Prevent navigating above the dev directory root
    const parent = path.dirname(resolved);
    const isAtRoot = resolved === allowedRoot;

    return NextResponse.json({
      current: resolved,
      parent: isAtRoot ? null : parent,
      folders,
    });
  } catch {
    return NextResponse.json({ current: dir, parent: null, folders: [], error: 'Cannot read directory' });
  }
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  const config = readConfig(user);
  const userHome = require('os').homedir();
  const devDirs = (config.devDirectories.length > 0 ? config.devDirectories : [userHome])
    .map((d: string) => path.resolve(d));

  try {
    const body = await request.json();
    const { parent, name } = body;

    if (!parent || !name) {
      return NextResponse.json({ error: 'parent and name are required' }, { status: 400 });
    }

    // Validate name
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 });
    }
    if (name.length > 255) {
      return NextResponse.json({ error: 'Folder name too long' }, { status: 400 });
    }

    const resolvedParent = path.resolve(parent);

    // Validate parent is within allowed dev directories
    const allowedRoot = devDirs.find((d: string) => resolvedParent === d || resolvedParent.startsWith(d + path.sep));
    if (!allowedRoot) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const newPath = path.join(resolvedParent, name);

    // Check if already exists
    if (fs.existsSync(newPath)) {
      return NextResponse.json({ error: 'Folder already exists' }, { status: 409 });
    }

    fs.mkdirSync(newPath, { recursive: true });

    return NextResponse.json({ path: newPath }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}

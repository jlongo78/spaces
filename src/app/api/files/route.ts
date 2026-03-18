import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp', '.svg']);

const BINARY_EXTS = new Set([
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.gz', '.tar', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.node',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.db', '.sqlite', '.sqlite3',
]);

const IGNORE = new Set(['node_modules', '.git', '.next', '__pycache__', '.turbo', 'dist', '.cache']);

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

// Max text file size for JSON response (5MB)
const MAX_TEXT_SIZE = 5 * 1024 * 1024;
// Max image size for base64 response (20MB)
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const dir = request.nextUrl.searchParams.get('path');
    const file = request.nextUrl.searchParams.get('file');
    const raw = request.nextUrl.searchParams.get('raw');
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '2000', 10);

    // Serve raw file (for images in <img> tags)
    if (raw) {
      try {
        const resolved = path.resolve(raw);
        const ext = path.extname(resolved).toLowerCase();
        const stat = fs.statSync(resolved);
        const mime = MIME[ext] || 'application/octet-stream';
        const data = fs.readFileSync(resolved);
        return new NextResponse(data, {
          headers: {
            'Content-Type': mime,
            'Content-Length': String(stat.size),
            'Cache-Control': 'private, max-age=60',
          },
        });
      } catch {
        return new NextResponse('Not found', { status: 404 });
      }
    }

    // Read file contents
    if (file) {
      try {
        const resolved = path.resolve(file);
        const stat = fs.statSync(resolved);
        const ext = path.extname(resolved).toLowerCase();

        // Images — return metadata with base64 data URL for small ones, raw URL for large
        if (IMAGE_EXTS.has(ext)) {
          if (stat.size > MAX_IMAGE_SIZE) {
            return NextResponse.json({ image: true, tooLarge: true, ext, size: stat.size, name: path.basename(resolved) });
          }
          return NextResponse.json({
            name: path.basename(resolved),
            path: resolved,
            image: true,
            ext,
            size: stat.size,
            // Client will use the raw endpoint to load the image
            rawUrl: `/api/files?raw=${encodeURIComponent(resolved)}`,
          });
        }

        // PDF
        if (ext === '.pdf') {
          return NextResponse.json({
            name: path.basename(resolved),
            path: resolved,
            pdf: true,
            ext,
            size: stat.size,
            rawUrl: `/api/files?raw=${encodeURIComponent(resolved)}`,
          });
        }

        // Binary files we can't display
        if (BINARY_EXTS.has(ext)) {
          return NextResponse.json({ binary: true, ext, size: stat.size, name: path.basename(resolved) });
        }

        // Text files
        if (stat.size > MAX_TEXT_SIZE) {
          return NextResponse.json({ error: 'File too large', size: stat.size, name: path.basename(resolved) });
        }

        const content = fs.readFileSync(resolved, 'utf-8');
        const lines = content.split('\n');
        return NextResponse.json({
          name: path.basename(resolved),
          path: resolved,
          content: lines.length > limit ? lines.slice(0, limit).join('\n') : content,
          lines: lines.length,
          truncated: lines.length > limit,
          size: stat.size,
          ext,
        });
      } catch {
        return NextResponse.json({ error: 'Cannot read file' }, { status: 404 });
      }
    }

    // List directory
    if (!dir) {
      return NextResponse.json({ error: 'path parameter required' }, { status: 400 });
    }

    try {
      const resolved = path.resolve(dir);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });

      const items = entries
        .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
        .map(e => ({
          name: e.name,
          path: path.join(resolved, e.name),
          isDir: e.isDirectory(),
          ext: e.isDirectory() ? null : path.extname(e.name).toLowerCase(),
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return NextResponse.json({
        current: resolved,
        parent: path.dirname(resolved),
        items,
      });
    } catch {
      return NextResponse.json({ error: 'Cannot read directory' }, { status: 404 });
    }
  });
}

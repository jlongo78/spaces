import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function GET() {
  const updateCheckPath = path.join(os.homedir(), '.spaces', 'update-check.json');
  try {
    if (fs.existsSync(updateCheckPath)) {
      const data = JSON.parse(fs.readFileSync(updateCheckPath, 'utf-8'));
      return NextResponse.json(data);
    }
  } catch { /* */ }
  return NextResponse.json({ available: false });
}

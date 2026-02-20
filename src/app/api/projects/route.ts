import { NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { getAllProjects } from '@/lib/db/queries';

export async function GET() {
  await ensureInitialized();
  const projects = getAllProjects();
  return NextResponse.json(projects);
}

import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';

export const runtime = 'nodejs';

const allowed: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const form = await request.formData();
  const file = form.get('file');
  const slugRaw = String(form.get('slug') || 'dispensary');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Image file is required.' }, { status: 400 });
  if (!allowed[file.type]) return NextResponse.json({ error: 'Only JPEG, PNG, and WebP images are supported.' }, { status: 400 });
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'Image must be 20 MB or smaller.' }, { status: 400 });

  const slug = slugRaw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'dispensary';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${allowed[file.type]}`;
  const dir = path.join(process.cwd(), 'public', 'uploads', 'dispensaries', slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({
    provider: 'geoweedo',
    photoId: `geoweedo:${slug}:${filename}`,
    imageUrl: `/uploads/dispensaries/${slug}/${filename}`,
  }, { status: 201 });
}

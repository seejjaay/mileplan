import { supabase } from '../lib/supabase'
import { canonicalMime, validateUpload } from '../lib/validateUpload'

export type Bucket = 'documents' | 'attachments' | 'payment-proofs' | 'avatars'
export type Attachment = { path: string; name: string; size: number; mime: string }

/** Keeps the readable part of a file name; drops directories, traversal and odd characters. */
function safeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '')
  return (base || 'file').slice(-100)
}

/** {projectId}/{uuid}-{filename}: the first segment is what the storage policies check. */
export function objectPath(projectId: string, file: File): string {
  return `${projectId}/${crypto.randomUUID()}-${safeName(file.name)}`
}

/** Validates (size, extension AND type) before any network call, then uploads under the project's folder. */
export async function uploadTo(bucket: Bucket, projectId: string, file: File): Promise<Attachment> {
  const problem = validateUpload(file)
  if (problem) throw new Error(problem)
  const path = objectPath(projectId, file)
  const mime = canonicalMime(file)
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: mime, upsert: false })
  if (error) throw error
  return { path, name: file.name, size: file.size, mime }
}

/** 60-second signed URL; with `downloadName` the browser saves the file instead of navigating away. */
export async function signedUrl(bucket: Bucket, path: string, downloadName?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60, downloadName ? { download: downloadName } : undefined)
  if (error) throw error
  return data.signedUrl
}

/** Best-effort cleanup after a failed write; never throws. */
export async function removeObjects(bucket: Bucket, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await supabase.storage.from(bucket).remove(paths).catch(() => undefined)
}

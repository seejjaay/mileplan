import { supabase } from '../lib/supabase'
import { sha256Hex } from '../lib/sha256'
import { removeObjects, uploadTo } from './storage'

export type DocumentKind = 'contract' | 'agreement' | 'srs' | 'milestone_plan' | 'amendment' | 'other'

export const DOCUMENT_KINDS: { value: DocumentKind; label: string }[] = [
  { value: 'contract', label: 'Contract' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'srs', label: 'SRS' },
  { value: 'milestone_plan', label: 'Milestone plan' },
  { value: 'amendment', label: 'Amendment' },
  { value: 'other', label: 'Other' },
]

export type DocumentRow = {
  id: string
  project_id: string
  kind: DocumentKind
  title: string
  version: number
  storage_path: string
  sha256: string | null
  signed_at: string | null
  status: 'signed' | 'superseded'
  uploaded_by: string | null
  created_at: string
}

/** Signed documents first, superseded after; newest version first within each. */
export async function listDocuments(projectId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*').eq('project_id', projectId)
  if (error) throw error
  const rank = (d: DocumentRow) => (d.status === 'signed' ? 0 : 1)
  return (data as DocumentRow[]).sort((a, b) => rank(a) - rank(b) || b.version - a.version || b.created_at.localeCompare(a.created_at))
}

export type UploadDocumentInput = {
  projectId: string
  uploadedBy: string
  file: File
  kind: DocumentKind
  title: string
  version: number
  signedAt?: string
  supersedes?: string
}

/** Hashes the file in the browser, uploads it, records it, and (optionally) marks the document it replaces as superseded. */
export async function uploadDocument(input: UploadDocumentInput): Promise<void> {
  const sha256 = await sha256Hex(input.file)
  const stored = await uploadTo('documents', input.projectId, input.file)
  const { error } = await supabase.from('documents').insert({
    project_id: input.projectId,
    kind: input.kind,
    title: input.title.trim(),
    version: input.version,
    storage_path: stored.path,
    sha256,
    signed_at: input.signedAt || null,
    status: 'signed',
    uploaded_by: input.uploadedBy,
  })
  if (error) {
    await removeObjects('documents', [stored.path])
    throw error
  }
  if (input.supersedes) {
    const { error: supersedeError } = await supabase.from('documents').update({ status: 'superseded' }).eq('id', input.supersedes)
    if (supersedeError) throw new Error('The new document was saved, but the old version could not be marked as superseded. Mark it manually.')
  }
}

/** The original file name, recovered from {projectId}/{uuid}-{name}. */
export function fileNameFromPath(path: string): string {
  return (path.split('/').pop() ?? path).replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, '')
}

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDocuments } from '../../api/documents'
import { listMilestones } from '../../api/milestones'
import { qk } from '../../api/keys'

/** id -> current name for milestones, tasks and documents, so activity sentences can say which one they mean. */
export function useEntityNames(projectId: string): Map<string, string> {
  const milestones = useQuery({ queryKey: qk.milestones(projectId), queryFn: () => listMilestones(projectId) })
  const documents = useQuery({ queryKey: qk.documents(projectId), queryFn: () => listDocuments(projectId) })
  return useMemo(() => {
    const names = new Map<string, string>()
    for (const m of milestones.data ?? []) {
      names.set(m.id, m.title)
      for (const t of m.tasks) names.set(t.id, t.title)
    }
    for (const d of documents.data ?? []) names.set(d.id, d.title)
    return names
  }, [milestones.data, documents.data])
}

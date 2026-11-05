import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useTitle } from '../../lib/useTitle'
import { AsyncView } from '../../ui/AsyncView'
import { StatusChip, type ChipStatus } from '../../ui/StatusChip'

type ProjectRow = { id: string; title: string; status: 'setup' | 'active' | 'completed' | 'terminated' }

const chip: Record<ProjectRow['status'], { status: ChipStatus; label: string }> = {
  setup: { status: 'upcoming', label: 'Setting up' },
  active: { status: 'active', label: 'Active' },
  completed: { status: 'done', label: 'Completed' },
  terminated: { status: 'inactive', label: 'Terminated' },
}

export default function MyProjectsPage() {
  useTitle('My projects')
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: async (): Promise<ProjectRow[]> => {
      const { data, error } = await supabase.from('projects').select('id, title, status').order('created_at', { ascending: false })
      if (error) throw error
      return data as ProjectRow[]
    },
  })
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">My projects</h1>
      <AsyncView
        query={query}
        onRetry={() => void query.refetch()}
        empty={<p className="text-[var(--muted)]">No projects yet — CJ will add you once your project starts.</p>}
      >
        {(projects) => (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                <span>{p.title}</span>
                <StatusChip {...chip[p.status]} />
              </li>
            ))}
          </ul>
        )}
      </AsyncView>
    </div>
  )
}

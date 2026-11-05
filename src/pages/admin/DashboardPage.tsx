import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useTitle } from '../../lib/useTitle'
import { AsyncView } from '../../ui/AsyncView'

type ProjectRow = { id: string; title: string; status: string }

export default function DashboardPage() {
  useTitle('Dashboard')
  const query = useQuery({
    queryKey: ['projects'],
    queryFn: async (): Promise<ProjectRow[]> => {
      const { data, error } = await supabase.from('projects').select('id, title, status').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <AsyncView query={query} onRetry={() => void query.refetch()} empty={<p className="text-[var(--muted)]">No projects yet.</p>}>
        {(projects) => (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                {p.title}
              </li>
            ))}
          </ul>
        )}
      </AsyncView>
    </div>
  )
}

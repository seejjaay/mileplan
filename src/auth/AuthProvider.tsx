import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Profile = { id: string; role: 'admin' | 'client'; full_name: string | null; active: boolean }

export type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export const profileKey = (userId: string | undefined) => ['profile', userId] as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    // Keep this callback synchronous: awaiting supabase calls inside it can deadlock the auth lock.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: profileKey(userId),
    enabled: !!userId,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase.from('profiles').select('id, role, full_name, active').eq('id', userId!).single()
      if (error) throw error
      return data as Profile
    },
  })

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    queryClient.clear()
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile: session ? (profileQuery.data ?? null) : null,
      loading: !sessionLoaded || (!!session && profileQuery.isPending),
      signOut,
    }),
    [session, profileQuery.data, profileQuery.isPending, sessionLoaded, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

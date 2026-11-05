import { supabase } from '../lib/supabase'

export type ReviewDecision = 'approved' | 'changes_requested'

export type Review = {
  id: string
  milestone_id: string
  user_id: string
  decision: ReviewDecision
  comment: string | null
  created_at: string
  reviewer_name: string | null
}

/** Every review in the project, newest first. */
export async function listReviews(projectId: string): Promise<Review[]> {
  const { data, error } = await supabase
    .from('milestone_reviews')
    .select('*, reviewer_name, milestones!inner(project_id)')
    .eq('milestones.project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as unknown as Review[]
}

/**
 * Records a client's decision. The database does the rest: approve moves the milestone to Approved, request changes
 * (comment required) sends it back to In progress, and a review of a milestone that is no longer in review fails with 42501.
 */
export async function submitReview(milestoneId: string, userId: string, decision: ReviewDecision, comment?: string): Promise<void> {
  const { error } = await supabase
    .from('milestone_reviews')
    .insert({ milestone_id: milestoneId, user_id: userId, decision, comment: comment?.trim() || null })
  if (error) throw error
}

export function latestReview(reviews: Review[], milestoneId: string): Review | undefined {
  return reviews
    .filter((r) => r.milestone_id === milestoneId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
}

export function describeReview(review: Review): string {
  const who = review.reviewer_name ?? 'a client'
  return review.decision === 'approved'
    ? `Approved by ${who}`
    : `Changes requested by ${who}${review.comment ? `: “${review.comment}”` : ''}`
}

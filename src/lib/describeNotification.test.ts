import type { NotificationKind, NotificationRow } from '../api/notifications'
import { describeNotification } from './describeNotification'
import { formatMoney } from './format'

function n(kind: NotificationKind, data: Record<string, unknown> = {}, extra: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n1',
    project_id: 'p1',
    kind,
    needs_action: false,
    count: 1,
    data,
    created_at: '2026-11-09T10:00:00Z',
    updated_at: '2026-11-09T10:00:00Z',
    read_at: null,
    project: { title: 'Acme storefront', currency: 'PHP' },
    ...extra,
  }
}

const money = formatMoney(35000, 'PHP')

describe('describeNotification', () => {
  it('milestone_in_review', () => {
    expect(describeNotification(n('milestone_in_review', { milestone_title: 'Discovery' }))).toEqual({
      text: 'Discovery is ready for your review',
      tab: 'milestones',
    })
  })

  it('update_posted', () => {
    expect(describeNotification(n('update_posted', { actor_name: 'CJ', snippet: 'Week 2 progress' }))).toEqual({
      text: 'CJ posted an update: Week 2 progress',
      tab: 'updates',
    })
    expect(describeNotification(n('update_posted', { actor_name: 'CJ', snippet: '' })).text).toBe('CJ posted an update')
  })

  it('document_added', () => {
    expect(describeNotification(n('document_added', { document_title: 'Service Agreement' }))).toEqual({
      text: 'New document: Service Agreement',
      tab: 'files',
    })
  })

  it('payment_confirmed, with and without a request', () => {
    expect(describeNotification(n('payment_confirmed', { request_title: 'Deposit', amount: 35000 }))).toEqual({
      text: 'Your payment for Deposit was confirmed',
      tab: 'payments',
    })
    expect(describeNotification(n('payment_confirmed', { request_title: null, amount: 35000 })).text).toBe(`Your payment of ${money} was confirmed`)
  })

  it('payment_rejected, with and without a note', () => {
    expect(describeNotification(n('payment_rejected', { request_title: 'Deposit', amount: 35000, note: 'Wrong amount' }))).toEqual({
      text: 'Your payment for Deposit was rejected: Wrong amount',
      tab: 'payments',
    })
    expect(describeNotification(n('payment_rejected', { request_title: 'Deposit', amount: 35000, note: null })).text).toBe(
      'Your payment for Deposit was rejected',
    )
  })

  it('plan_change counts its changes', () => {
    expect(describeNotification(n('plan_change', {}, { count: 1 }))).toEqual({
      text: 'The plan changed: 1 change to acknowledge',
      tab: 'overview',
    })
    expect(describeNotification(n('plan_change', {}, { count: 3 })).text).toBe('The plan changed: 3 changes to acknowledge')
  })

  it('payment_proof', () => {
    expect(describeNotification(n('payment_proof', { client_name: 'Acme', request_title: 'Deposit', amount: 35000 }))).toEqual({
      text: `Acme sent a payment proof for Deposit, ${money}`,
      tab: 'payments',
    })
  })

  it('milestone_approved and changes_requested', () => {
    expect(describeNotification(n('milestone_approved', { client_name: 'Acme', milestone_title: 'Build' }))).toEqual({
      text: 'Acme approved Build',
      tab: 'milestones',
    })
    expect(describeNotification(n('changes_requested', { client_name: 'Acme', milestone_title: 'Build' }))).toEqual({
      text: 'Acme requested changes on Build',
      tab: 'milestones',
    })
  })

  it('plan_change_acked', () => {
    expect(describeNotification(n('plan_change_acked', { client_name: 'Acme' }))).toEqual({
      text: 'Acme acknowledged the plan change',
      tab: 'timeline',
    })
  })

  it('uses the project currency, and PHP when the project is hidden', () => {
    const usd = n('payment_confirmed', { request_title: null, amount: 35000 }, { project: { title: 'X', currency: 'USD' } })
    expect(describeNotification(usd).text).toBe(`Your payment of ${formatMoney(35000, 'USD')} was confirmed`)
    const hidden = n('payment_confirmed', { request_title: null, amount: 35000 }, { project: null })
    expect(describeNotification(hidden).text).toBe(`Your payment of ${money} was confirmed`)
  })

  it('falls back to a plain name when the data has none', () => {
    expect(describeNotification(n('milestone_approved', { milestone_title: 'Build' })).text).toBe('A client approved Build')
  })
})

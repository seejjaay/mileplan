import { createContext, useContext } from 'react'
import type { TabKey } from './tabs'

export type ChangeMarkers = {
  milestones: Set<string>
  tabs: Set<TabKey>
  /** a milestone whose status just changed while the page was open (drives the marker tick) */
  tick: { id: string; at: number } | null
}

const none: ChangeMarkers = { milestones: new Set(), tabs: new Set(), tick: null }

/** Provided by ProjectPage; anything rendered outside it simply sees no markers. */
export const ChangeMarkersContext = createContext<ChangeMarkers>(none)

export const useChangeMarkers = (): ChangeMarkers => useContext(ChangeMarkersContext)

import { createContext, useContext } from 'react'
import type { TabKey } from './tabs'

export type ChangeMarkers = { milestones: Set<string>; tabs: Set<TabKey> }

const none: ChangeMarkers = { milestones: new Set(), tabs: new Set() }

/** Provided by ProjectPage; anything rendered outside it simply sees no markers. */
export const ChangeMarkersContext = createContext<ChangeMarkers>(none)

export const useChangeMarkers = (): ChangeMarkers => useContext(ChangeMarkersContext)

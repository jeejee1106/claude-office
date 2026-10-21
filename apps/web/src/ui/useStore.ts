import { createContext, useContext, useSyncExternalStore } from 'react'
import type { OfficeStore, StoreState } from '../store/officeStore'

export const StoreContext = createContext<OfficeStore | null>(null)

export function useOfficeStore(): OfficeStore {
  const store = useContext(StoreContext)
  if (store === null) throw new Error('StoreContext 가 없습니다')
  return store
}

/** 요약 상태 구독. selector 는 state 의 일부(참조 그대로)를 반환해야 한다 */
export function useStoreSelector<T>(selector: (s: StoreState) => T): T {
  const store = useOfficeStore()
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}

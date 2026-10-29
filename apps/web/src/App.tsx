import { useEffect, useMemo } from 'react'
import { OfficeSocket } from './net/socket'
import { createOfficeStore } from './store/officeStore'
import { AgentList } from './ui/AgentList'
import { ConnectionBadge } from './ui/ConnectionBadge'
import { DailyStatsPanel } from './ui/DailyStatsPanel'
import { EmployeeSettingsButton } from './ui/EmployeeSettings'
import { FloorTabs } from './ui/FloorTabs'
import { LangToggle } from './ui/LangToggle'
import { OfficeView } from './ui/OfficeView'
import { SessionPicker } from './ui/SessionPicker'
import { SoundToggle } from './ui/SoundToggle'
import { Timeline } from './ui/Timeline'
import { StoreContext } from './ui/useStore'

export function App() {
  const store = useMemo(() => createOfficeStore(), [])

  useEffect(() => {
    const socket = new OfficeSocket({
      onMessage: (m) => store.applyMessage(m),
      onStatus: (s) => store.setConnection(s),
    })
    socket.start()
    return () => socket.stop()
  }, [store])

  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <header className="topbar">
          <h1>Claude Office</h1>
          <FloorTabs />
          <SessionPicker />
          <LangToggle />
          <SoundToggle />
          <EmployeeSettingsButton />
          <ConnectionBadge />
        </header>
        <main className="layout">
          <OfficeView />
          <aside className="side">
            <AgentList />
            <DailyStatsPanel />
            <Timeline />
          </aside>
        </main>
      </div>
    </StoreContext.Provider>
  )
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App.tsx'
import { loadCrew } from './agent-directory.ts'

// Agent names for labels; pages poll and re-render, so they pick the names up once loaded.
void loadCrew()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

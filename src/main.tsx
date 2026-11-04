import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/600.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/montserrat/800.css'
import './styles.css'
import { App } from './App.tsx'
import { loadCrew } from './agent-directory.ts'

// Agent names for labels; pages poll and re-render, so they pick the names up once loaded.
void loadCrew()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

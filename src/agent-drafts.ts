import { useCallback, useSyncExternalStore } from 'react'
import { LOCKED_EVENT } from './access.ts'
import { PROFILES_CHANGED } from './profile-lock.ts'

type Value=string|number|boolean
const drafts=new Map<string,Value>()
const listeners=new Set<()=>void>()
const notify=()=>listeners.forEach(listener=>listener())
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
const clear=()=>{drafts.clear();notify()}
if(typeof window!=='undefined') {
  window.addEventListener(LOCKED_EVENT,clear)
  window.addEventListener(PROFILES_CHANGED,clear)
}

// Drafts live only in this open application, never in localStorage or on the server.
export function useAgentDraft<T extends Value>(key:string,initial:T) {
  const value=useSyncExternalStore(subscribe,()=>drafts.has(key)?drafts.get(key) as T:initial,()=>initial)
  const setValue=useCallback((next:T|((previous:T)=>T))=>{
    const previous=drafts.has(key)?drafts.get(key) as T:initial
    drafts.set(key,typeof next==='function'?next(previous):next)
    notify()
  },[key,initial])
  return [value,setValue] as const
}

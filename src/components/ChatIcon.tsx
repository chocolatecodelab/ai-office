const paths = {
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7V5h7l2 2h9v13H3V7Z',
  attachment: 'M21 11.5 12 20.5a6 6 0 0 1-8.5-8.5L13 2.5a4 4 0 0 1 5.5 5.8L9 17.8a2 2 0 0 1-2.8-2.8l9-9',
  skill: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  connector: 'm9 15 6-6M7 17l-1 1a4 4 0 0 1-5-6l4-4a4 4 0 0 1 6 0m2 8a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
  memory: 'M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 5V4Zm6 0a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 5V4ZM5 10h4m6 4h4',
  context: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 12h8m-8 4h5',
  send: 'M12 19V5m-6 6 6-6 6 6',
  import: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  export: 'M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5',
  close: 'm6 6 12 12M6 18 18 6',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  collapse: 'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  down: 'M12 4v16m-6-6 6 6 6-6',
} as const

export function ChatIcon({name}:{name:keyof typeof paths}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}

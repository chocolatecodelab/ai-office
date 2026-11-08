import type { Page } from '../routes.ts'
const paths:Record<Page,string>={
 Office:'M3 21V7l9-4 9 4v14M8 21v-7h8v7M8 8v2m8-2v2',
 'Task Board':'M3 4h18v16H3zM9 4v16m6-16v16M5 8h2m4 4h2m4-4h2',
 Approval:'m8 12 3 3 5-6M6 3h12v18H6z',Agents:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 3a4 4 0 0 1 0 8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 Calendar:'M4 5h16v16H4zM8 2v6m8-6v6M4 11h16',
 Activity:'M2 12h5l3-8 4 16 3-8h5',Memory:'M6 3h14v18H6zM2 7h8m-8 5h8m-8 5h8m4-10h3m-3 5h3',
 Folders:'M3 6h7l2 3h9v12H3z',Usage:'M4 20V10m8 10V4m8 16v-7M2 21h20',Logs:'m4 6 5 6-5 6m9 0h7',Settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
}
export function NavigationIcon({page}:{page:Page}) {return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[page]}/></svg>}

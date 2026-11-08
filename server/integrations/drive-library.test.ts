import { expect, it, vi } from 'vitest'
import { DriveLibraryClient } from './drive-library.js'

it('resumes an uploaded stable file without creating another copy', async () => {
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({parents:['package'],size:'3'})))
  await new DriveLibraryClient('test-token',fetcher).upload('stable','package','slide-01.png','image/png',Buffer.from('png'))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toContain('/stable?')
})

it('uploads a missing file with its persisted ID and reports missing write access', async () => {
  const fetcher=vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}',{status:404}))
    .mockResolvedValueOnce(new Response('{}',{status:403}))
  await expect(new DriveLibraryClient('test-token',fetcher).upload('stable','package','slide-01.png','image/png',Buffer.from('png'))).rejects.toThrow('Hubungkan ulang')
  expect(String(fetcher.mock.calls[1][1]?.body)).toContain('"id":"stable"')
  expect(String(fetcher.mock.calls[1][1]?.body)).toContain('"parents":["package"]')
})

it('rejects ambiguous folders and preserves unrelated parents when moving', async () => {
  const ambiguous=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({files:[{id:'one'},{id:'two'}]})))
  await expect(new DriveLibraryClient('token',ambiguous).childFolder('root','04_Approved')).rejects.toThrow('ganda')
  expect(ambiguous).toHaveBeenCalledTimes(1)
  const fetcher=vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({parents:['approved','unrelated']})))
    .mockResolvedValueOnce(new Response('{}'))
  await new DriveLibraryClient('token',fetcher).move('package','approved','published')
  const url=new URL(String(fetcher.mock.calls[1][0]))
  expect(url.searchParams.get('removeParents')).toBe('approved')
  expect(url.searchParams.get('addParents')).toBe('published')
})

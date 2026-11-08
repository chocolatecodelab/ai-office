import {it,expect,vi} from 'vitest'
import {verifyRemoteSource} from './engine-remote.js'
const sha='a'.repeat(40)
function fake(options:{offline?:boolean;missing?:boolean}={}){return vi.fn(async(args:string[])=>{
 if(args[0]==='ls-remote'){if(options.offline)throw Error('offline');return sha+'\trefs/heads/master'}
 if(args[0]==='merge-base'&&options.missing)throw Error('unknown commit')
 return ''
})}
it('verifies advertised HEAD without fetching or changing the worktree',async()=>{const git=fake();expect(await verifyRemoteSource('unused',git)).toMatchObject({remote:'otca',remoteCommit:sha,verification:'live-remote'});expect(git.mock.calls.map(([args])=>args[0])).toEqual(['rev-parse','ls-remote','merge-base'])})
it('blocks offline or unmerged remote versions',async()=>{await expect(verifyRemoteSource('unused',fake({offline:true}))).rejects.toThrow('belum dapat diverifikasi');await expect(verifyRemoteSource('unused',fake({missing:true}))).rejects.toThrow('belum tergabung')})
it('rejects a mismatched branch response',async()=>{const git=fake();git.mockImplementation(async args=>args[0]==='ls-remote'?sha+'\trefs/heads/other':'');await expect(verifyRemoteSource('unused',git)).rejects.toThrow('tidak valid')})

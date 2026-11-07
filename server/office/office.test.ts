import {checkpointHermes} from './task-checkpoints.js'
import {renderedCheckpoint} from './render-checkpoint.js'
import {ProviderLimitError} from './provider-limit.js'
import { planSocialPost,recordSocialPublication } from './social-schedule.js'
import { ApprovedLibrary } from './approved-library.js'
import { DriveLibraryClient } from '../integrations/drive-library.js'
import { MetaPublisher } from './meta-publisher.js'
import { VideoAttachments } from './video-attachments.js'
import { createReadStream } from 'node:fs'
import { runProductionProcess } from './production-process.js'
import { chatMaterials } from './production-materials.js'
import { registerProductionVersion,productionProjects,productionVersion,compareProductionVersions,restoreProductionVersion,backfillProductionVersions } from './production-projects.js'
import { activeVideoProject,VideoSourceChoiceRequired } from './thumbnail-chat.js'
import { ProductionEngines,ProductionQaError } from './production-engines.js'
import { carouselCopySlots,carouselChatPlan } from './chat-production.js'
import { approvalReview,reviewSummary } from './approval-review.js'
import { vi } from 'vitest'
import { cachedDocumentContext } from './document-context-cache.js'
import { dependencyContext } from './dependency-context.js'
import { cancelWorkflow } from './orchestration.js'
import sharp from 'sharp'
import PDFDocument from 'pdfkit'
import { processPdf } from './document-processing.js'
import { ChatWorkspace } from './chat-workspace.js'
import { compactChat } from './chat-memory.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, migrate, type Db } from '../db/index.js'
import { Connections } from '../integrations/connections.js'
import { routedDrive } from '../integrations/drive.js'
import { mockDrive } from '../integrations/index.js'
import { officeSettings } from '../settings.js'
import { readBrands, syncBrands } from './brands.js'
import { OfficeBus } from './bus.js'
import { localFileStore } from './file-store.js'
import { EventWorkflow, parseQuestions } from './event-workflow.js'
import type { HermesClient, RunRequest, RunResult } from './hermes-client.js'
import { MAX_ATTEMPTS, runTask, type RunnerDeps } from './runner.js'
import { OfficeStore } from './store.js'

// Runs against a throwaway database: OFFICE_TEST_DATABASE_URL, or office_test on the local Compose
// Postgres. Skipped when neither is reachable (for example in CI without Postgres).

const contextDir = fileURLToPath(new URL('../../context', import.meta.url))
const local = officeSettings().databaseUrl?.replace(/\/office$/, '/office_test')
const testUrl = process.env.OFFICE_TEST_DATABASE_URL || local

async function reachable(url: string | undefined): Promise<boolean> {
  if (!url) return false
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 })
  try { await client.connect(); await client.end(); return true } catch { return false }
}

const available = await reachable(testUrl)

/** A Hermes stand-in: each run returns the next scripted reply and records what it was asked. */
function scriptedHermes(replies: Array<Partial<RunResult>>): HermesClient & { requests: RunRequest[] } {
  const requests: RunRequest[] = []
  return {
    requests,
    async run(_endpoint, request) {
      requests.push(request)
      const reply = replies.shift() ?? { status: 'completed', output: 'ok' }
      return { runId: `run-${requests.length}`, status: 'completed', output: '', model: 'hermes-agent', inputTokens: 10, outputTokens: 5, ...reply }
    },
  }
}

describe.skipIf(!available)('office store, runner and event workflow (Postgres)', () => {
  let db: Db
  let store: OfficeStore
  let events: EventWorkflow
  let filesDir = ''
  const deps =(hermes: HermesClient): RunnerDeps => ({
    store, hermes, contextDir, endpoint: () => ({ url: 'http://hermes', key: 'k' }), brandName: async () => 'Official OTCA',
  })

  beforeAll(async () => {
    db = createDb(testUrl!)
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await migrate(db)
    await syncBrands(db, readBrands(contextDir))
    const bus = new OfficeBus()
    filesDir = await mkdtemp(join(tmpdir(), 'office-files-'))
    store = new OfficeStore(db, bus, localFileStore(filesDir))
    events = new EventWorkflow(store, bus, mockDrive())
  })
  afterAll(async () => { await db?.end(); if (filesDir) await rm(filesDir, { recursive: true, force: true }) })

  it('takes a carousel chat through model copy, queued render and downloadable chat images without auto-approval',async()=>{
    const chat=new ChatWorkspace(store)
    const parent=await chat.createChat('otca','content-creator','Buatkan carousel tentang rutinitas belajar.',{})
    const spec={brand:'otca',slides:[{headline:'Judul satu'},{headline:'Judul dua'},{headline:'Judul tiga'}],caption:'Caption lama'}
    const production=new ProductionEngines({workDir:filesDir})
    vi.spyOn(production,'health').mockResolvedValue({configured:true,ready:true,checks:[],runtime:'uji',error:undefined,mode:'render-and-qa'})
    vi.spyOn(production,'carouselTemplate').mockReturnValue(spec)
    const png=await sharp({create:{width:20,height:20,channels:3,background:'#ffffff'}}).png().toBuffer()
    vi.spyOn(production,'run').mockRejectedValueOnce(new ProductionQaError([{slide:1,code:'TEXT_OVERFLOW',message:'Pendekkan judul.'}])).mockResolvedValue({content:'Render siap review',files:[{name:'slide-01.png',mime:'image/png',data:png}],report:{status:'SIAP_DIREVIEW',files:['slide-01.png']}})
    const hermes=scriptedHermes([{output:JSON.stringify({edits:carouselCopySlots(spec).map(slot=>({path:slot.path,value:'Teks baru'}))})},{output:JSON.stringify({edits:[{path:'slides.0.headline',value:'Baru'}]})}])
    const runtime={...deps(hermes),production}
    const outcome=await runTask(runtime,'otca',parent.id)
    expect(outcome.next).toBe('retry')
    const childId=outcome.next==='retry'?outcome.children?.[0].id:undefined
    expect(childId).toBeDefined()
    expect((await store.task('otca',parent.id))?.status).toBe('running')
    await runTask(runtime,'otca',childId!)
    expect(hermes.requests).toHaveLength(2)
    expect((await store.task('otca',parent.id))?.status).toBe('done')
    expect((await store.task('otca',childId!))?.status).toBe('waiting_approval')
    const images=(await store.artifactFiles('otca',[parent.id])).get(parent.id)!
    expect(images[0]).toMatchObject({name:'slide-01.png',mime:'image/png',size:png.length})
    expect((await store.assetFile('otca',images[0].id))?.data).toEqual(png)
    expect((await store.artifactFiles('ciaomanda',[parent.id])).size).toBe(0)
    expect(await store.approvals('otca',{taskId:parent.id})).toHaveLength(0)
    expect((await store.approvals('otca',{taskId:childId!}))[0].decision).toBeNull()
    expect((await db.query('SELECT * FROM cost_events WHERE task_id=$1',[parent.id])).rows).toHaveLength(2)
    const [pendingReview]=await store.approvals('otca',{taskId:childId!})
    expect((await approvalReview(store,'otca',pendingReview.id)).files[0].name).toBe('slide-01.png')
    await expect(approvalReview(store,'ciaomanda',pendingReview.id)).rejects.toThrow(/brand/)
    const rejected=await store.decide('otca',pendingReview.id,{decision:'rejected',note:'Perbaiki judul slide pertama.',actor:'uji'})
    expect(rejected.task.status).toBe('cancelled')
    expect(rejected.revisionTask?.kind).toBe('konten.chat')
    const revisionPlan=await carouselChatPlan(store,production,rejected.revisionTask!)
    expect(revisionPlan.sourceTaskId).toBe(childId)
    expect(revisionPlan.spec).toMatchObject({slides:[{headline:'Baru'},{headline:'Teks baru'},{headline:'Teks baru'}]})
    expect((await store.artifactFiles('otca',[parent.id])).get(parent.id)?.length).toBe(1)
    await store.transition('otca',rejected.revisionTask!.id,'cancelled',{actor:'uji'})
  })

  it('keeps explicit carousel sources scoped and compares immutable versions within one project',async()=>{
    const create=async(title:string)=>{
      const task=await store.createTask('otca',{agentType:'content-creator',kind:'konten.produksi',title,brief:'QA versions',createdBy:'uji'})
      await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,'otca','content-creator',JSON.stringify({title,brief:'QA',spec:{brand:'otca',slides:[{headline:title}]}})])
      return task
    }
    const original=await create('QA project source'),next=await create('QA project revision')
    const a=await registerProductionVersion(db,'otca','content-creator',original.id,original.title)
    const b=await registerProductionVersion(db,'otca','content-creator',next.id,next.title,original.id)
    expect(b).toEqual({project_id:a.project_id,version:2})
    expect(await registerProductionVersion(db,'otca','content-creator',next.id,next.title,original.id)).toEqual(b)
    for(const task of [original,next]){
      await store.transition('otca',task.id,'running',{actor:'uji'})
      const png=await sharp({create:{width:8,height:8,channels:3,background:task.id===original.id?'#000000':'#ffffff'}}).png().toBuffer()
      await store.submitProduction('otca',task.id,{content:'QA',files:[{name:'slide-01.png',mime:'image/png',data:png}],report:{status:'SIAP_DIREVIEW'}})
    }
    const chat=new ChatWorkspace(store)
    const chosen=await chat.createChat('otca','content-creator','Revisi carousel: ubah judul',{productionSourceTaskId:original.id})
    expect((await db.query('SELECT production_source_task_id FROM chat_inputs WHERE task_id=$1',[chosen.id])).rows[0].production_source_task_id).toBe(original.id)
    await expect(chat.createChat('ciaomanda','content-creator','Revisi carousel',{productionSourceTaskId:original.id})).rejects.toThrow(/brand/)
    expect((await productionProjects(store,'otca','content-creator','QA project source'))[0].versions).toHaveLength(2)
    expect((await compareProductionVersions(store,'otca','content-creator',original.id,next.id)).slides[0].changed).toBe(true)
    await expect(productionVersion(store,'ciaomanda','content-creator',original.id)).rejects.toThrow(/brand/)
    for(const task of [chosen,original,next])await store.transition('otca',task.id,'cancelled',{actor:'uji'})
  })

  it('pins video sources, backfills explicit lineage, compares bytes and restores a fresh unapproved version',async()=>{
    const brand='jepangkoey',agent='video-editor',chat=new ChatWorkspace(store)
    const create=async(title:string,project:string,source?:string)=>{
      const task=await store.createTask(brand,{agentType:agent,kind:'video.proyek',title,brief:'QA source selection',createdBy:'uji'})
      await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,brand,agent,JSON.stringify({nativeProject:project,...(source?{revisionOf:source}:{})})])
      await store.transition(brand,task.id,'running',{actor:'uji'})
      await store.submitProduction(brand,task.id,{content:'QA',files:[{name:project+'.mp4',mime:'video/mp4',data:Buffer.from(project)},{name:'thumbnail.png',mime:'image/png',data:await sharp({create:{width:8,height:8,channels:3,background:source?'#ffffff':'#000000'}}).png().toBuffer()},{name:'subtitle.srt',mime:'text/plain',data:Buffer.from(source?'New subtitle':'Old subtitle')}],report:{stage:'video-review'}})
      return task
    }
    const original=await create('QA video original','qa-original'),revision=await create('QA video revised','qa-revised',original.id),unrelated=await create('QA separate video','qa-separate')
    await backfillProductionVersions(store)
    await backfillProductionVersions(store)
    const projects=await productionProjects(store,brand,agent)
    const project=projects.find(p=>p.versions.some(v=>v.taskId===original.id))!
    expect(project.versions).toHaveLength(2)
    expect(project.versions.every(v=>v.ready)).toBe(true)
    const chosen=await chat.createChat(brand,agent,'Ubah margin thumbnail',{productionSourceTaskId:original.id})
    expect(await activeVideoProject(store,chosen)).toMatchObject({taskId:original.id,project:'qa-original'})
    const implicit=await chat.createChat(brand,agent,'Ubah judul video',{})
    await expect(activeVideoProject(store,implicit)).rejects.toBeInstanceOf(VideoSourceChoiceRequired)
    const hermes=scriptedHermes([])
    await runTask(deps(hermes),brand,implicit.id)
    expect((await store.task(brand,implicit.id))?.status).toBe('done')
    expect((await store.task(brand,implicit.id))?.result).toContain('Proyek dan versi')
    expect(hermes.requests).toHaveLength(0)
    await expect(chat.createChat('otca',agent,'Revisi video',{productionSourceTaskId:original.id})).rejects.toThrow(/brand/)
    await expect(chat.createChat(brand,'content-creator','Revisi carousel',{productionSourceTaskId:original.id})).rejects.toThrow(/brand/)
    const compared=await compareProductionVersions(store,brand,agent,original.id,revision.id)
    expect(compared.files.find(f=>f.kind==='video')).toMatchObject({name:'Video MP4',changed:true})
    expect(compared.files.find(f=>f.name==='subtitle.srt')).toMatchObject({leftText:'Old subtitle',rightText:'New subtitle',changed:true})
    expect(compared.summary).toMatchObject({changed:3,added:0,removed:0})
    await expect(compareProductionVersions(store,brand,agent,original.id,unrelated.id)).rejects.toThrow(/proyek yang sama/)
    await expect(restoreProductionVersion(store,'otca',agent,original.id)).rejects.toThrow(/brand/)
    const restored=await restoreProductionVersion(store,brand,agent,original.id)
    expect(restored).toMatchObject({projectId:project.id,version:3})
    expect((await store.task(brand,restored.taskId))?.status).toBe('waiting_approval')
    expect((await store.approvals(brand,{taskId:restored.taskId}))[0].decision).toBeNull()
    expect((await store.task(brand,original.id))?.status).toBe('waiting_approval')
    const restoredComparison=await compareProductionVersions(store,brand,agent,original.id,restored.taskId)
    expect(restoredComparison.summary.changed).toBe(0)
    const restoredTask=await store.task(brand,restored.taskId)
    expect((await store.task(brand,restoredTask!.parentId!))?.result).toContain('persetujuan ulang')
    for(const task of [chosen,original,revision,unrelated])await store.transition(brand,task.id,'cancelled',{actor:'uji'})
    await store.transition(brand,restored.taskId,'cancelled',{actor:'uji'})
  })

  it('asks for an explicit carousel project instead of revising an unrelated recent result',async()=>{
    const brand='jepangkoey',agent='content-creator',chat=new ChatWorkspace(store)
    const create=async()=>{
      const task=await store.createTask(brand,{agentType:agent,kind:'konten.produksi',title:'QA ambiguous carousel',brief:'QA',createdBy:'uji'})
      await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,brand,agent,JSON.stringify({spec:{brand:'info-jerman',slides:[{headline:'QA'}]}})])
      await registerProductionVersion(db,brand,agent,task.id,task.title)
      await store.transition(brand,task.id,'running',{actor:'uji'})
      await store.submitProduction(brand,task.id,{content:'QA',files:[{name:'slide-01.png',mime:'image/png',data:await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).png().toBuffer()}],report:{status:'SIAP_DIREVIEW'}})
      return task
    }
    const a=await create(),b=await create(),request=await chat.createChat(brand,agent,'Revisi judul slide pertama',{})
    await expect(carouselChatPlan(store,new ProductionEngines({workDir:filesDir}),request)).rejects.toThrow(/beberapa proyek carousel/)
    for(const t of [a,b,request])await store.transition(brand,t.id,'cancelled',{actor:'uji'})
  })

  it('keeps chat image permissions scoped and carries attachments through a placement clarification',async()=>{
    const chat=new ChatWorkspace(store)
    const png=await sharp({create:{width:8,height:8,channels:3,background:'#c99d38'}}).png().toBuffer()
    const file=await chat.upload('otca','content-creator','background.png',png)
    const task=await chat.createChat('otca','content-creator','Buatkan carousel memakai gambar ini',{attachmentIds:[file.id]})
    const bindings=[{attachmentId:file.id,chatTaskId:task.id,path:'background.src'}]
    expect((await chatMaterials(store,'otca',bindings))[0].data.length).toBeGreaterThan(0)
    await expect(chatMaterials(store,'ciaomanda',bindings)).rejects.toThrow()
    const unrelated=await chat.createChat('otca','content-creator','Halo',{})
    await expect(chatMaterials(store,'otca',[{...bindings[0],chatTaskId:unrelated.id}])).rejects.toThrow()
    await store.logEvent(db,unrelated,'carousel_clarification',{brief:task.brief,attachmentIds:[file.id]})
    const answer=await chat.createChat('otca','content-creator','Gunakan sebagai latar cover',{})
    expect((await chat.input(answer)).attachmentIds).toEqual([file.id])
    await chat.removeAttachment('otca','content-creator',file.id)
    await expect(chatMaterials(store,'otca',bindings)).rejects.toThrow()
    for(const t of [task,unrelated,answer])await store.transition('otca',t.id,'cancelled',{actor:'uji'})
  })

  it('reviews actual rendered images for curated chat production and records the separate AI assessment',async()=>{
    const parent=await store.createTask('otca',{agentType:'content-creator',kind:'konten.chat',title:'QA visual',brief:'Buatkan carousel edukasi',createdBy:'uji'})
    await store.transition('otca',parent.id,'running',{actor:'uji'})
    const child=await store.createTask('otca',{agentType:'content-creator',kind:'konten.produksi',title:'QA visual',brief:parent.brief,parentId:parent.id,createdBy:'uji'})
    const spec={brand:'otca',_officeDesign:{mode:'curated-composition-v1'},slides:[{headline:'QA'},{headline:'QA 2'},{headline:'QA 3'}]}
    await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[child.id,'otca','content-creator',JSON.stringify({title:'QA',brief:parent.brief,spec})])
    const png=await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer()
    const production=new ProductionEngines({workDir:filesDir})
    vi.spyOn(production,'run').mockRejectedValueOnce(new ProductionQaError([{slide:1,code:'SPEC_SCHEMA',message:'Perbaiki format sumber'}])).mockRejectedValueOnce(new ProductionQaError([{slide:1,code:'TEXT_OVERFLOW',message:'Pendekkan judul'}])).mockResolvedValue({content:'QA render',files:[1,2,3].map(n=>({name:`slide-0${n}.png`,mime:'image/png',data:png})),report:{status:'SIAP_DIREVIEW'}})
    vi.spyOn(production,'compositionContract').mockReturnValue('Kontrak schema engine')
    vi.spyOn(production,'visualReferences').mockResolvedValue({path:'reference.jpg',sha256:'ref-hash',image:'data:image/png;base64,'+png.toString('base64')})
    const hermes=scriptedHermes([{output:JSON.stringify({spec})},{output:JSON.stringify({spec})},{output:'{"summary":"Panel kosong","issues":[{"slide":2,"severity":"blocking","message":"Kurangi rongga panel"}]}'},{output:JSON.stringify({spec:{...spec,slides:[{headline:'QA diperbaiki'},{headline:'QA 2'},{headline:'QA 3'}]}})},{output:'{"summary":"Hierarki sesuai referensi","issues":[]}'}])
    await runTask({...deps(hermes),production},'otca',child.id)
    expect(hermes.requests[2].images).toHaveLength(4)
    expect(production.run).toHaveBeenCalledTimes(4)
    expect(hermes.requests[1].images).toBeUndefined()
    expect(hermes.requests[4].images).toHaveLength(4)
    expect(hermes.requests[0].reasoningEffort).toBe('high')
    expect((await db.query('SELECT report FROM production_jobs WHERE task_id=$1',[child.id])).rows[0].report.visualReview).toMatchObject({assessment:'ai-visual-review',passed:true,rounds:2})
    const approval=(await store.approvals('otca',{taskId:child.id}))[0]
    expect((await approvalReview(store,'otca',approval.id)).visual?.summary).toContain('Hierarki')
    expect(approval.decision).toBeNull()
  })

  it('queues local production without Hermes, imports brand-scoped files and requires human approval',async()=>{
    const task=await store.createTask('ciaomanda',{agentType:'content-creator',kind:'konten.produksi',title:'QA local renderer',brief:'uji',createdBy:'uji'})
    await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,'ciaomanda','content-creator',JSON.stringify({title:'QA',brief:'uji'})])
    const production=new ProductionEngines({workDir:filesDir})
    const png=await sharp({create:{width:20,height:20,channels:3,background:'#ffffff'}}).png().toBuffer()
    vi.spyOn(production,'run').mockResolvedValue({content:'Render siap review',files:[{name:'slide-01.png',mime:'image/png',data:png}],report:{status:'SIAP_DIREVIEW',files:['slide-01.png']}})
    const hermes=scriptedHermes([])
    await runTask({...deps(hermes),production},'ciaomanda',task.id)
    expect(hermes.requests).toHaveLength(0)
    expect((await store.task('ciaomanda',task.id))?.status).toBe('waiting_approval')
    const asset=(await store.assetList('ciaomanda')).find(a=>a.taskId===task.id&&a.name==='slide-01.png')!
    expect(asset.downloadable).toBe(true)
    expect((await store.assetFile('ciaomanda',asset.id))?.data).toEqual(png)
    expect(await store.assetFile('otca',asset.id)).toBeUndefined()
    expect((await db.query('SELECT * FROM cost_events WHERE task_id=$1',[task.id])).rows).toHaveLength(0)
    expect((await store.approvals('ciaomanda',{taskId:task.id}))[0].decision).toBeNull()
    const approval=(await store.approvals('ciaomanda',{taskId:task.id}))[0]
    const approved=await store.decide('ciaomanda',approval.id,{decision:'approved',actor:'reviewer-test'})
    expect(approved.handoffTask).toMatchObject({brandId:'ciaomanda',agentType:'social-media-manager',kind:'publikasi.caption',status:'queued'})
    const pack=(await db.query('SELECT * FROM approved_packages WHERE brand_id=$1 AND source_task_id=$2',['ciaomanda',task.id])).rows[0]
    expect(pack.assets.map((item:{id:string})=>item.id)).toContain(asset.id)
    expect(pack.smm_task_id).toBe(approved.handoffTask!.id)
    expect(pack.drive_status).toBe('pending')
    await expect(store.decide('ciaomanda',approval.id,{decision:'approved',actor:'reviewer-test'})).rejects.toThrow('sudah diputuskan')
    expect((await db.query('SELECT id FROM approved_packages WHERE source_task_id=$1',[task.id])).rows).toHaveLength(1)
    const resumed=await Promise.all([store.prepareApprovedPublication('ciaomanda',task.id,'uji'),store.prepareApprovedPublication('ciaomanda',task.id,'uji')])
    expect(resumed.map(item=>item.id)).toEqual([approved.handoffTask!.id,approved.handoffTask!.id])
    const smm=approved.handoffTask!
    await runTask(deps(scriptedHermes([{output:'Caption approved untuk publikasi.'}])),'ciaomanda',smm.id)
    const smmApproval=(await store.approvals('ciaomanda',{taskId:smm.id}))[0]
    expect(smmApproval.approvalType).toBe('publikasi')
    await expect(planSocialPost(store,'ciaomanda',smm.id,{platform:'instagram',scheduledAt:new Date(Date.now()+86400000).toISOString()},'uji')).rejects.toThrow()
    await store.decide('ciaomanda',smmApproval.id,{decision:'approved',actor:'reviewer-test'})
    const schedule=await planSocialPost(store,'ciaomanda',smm.id,{platform:'instagram',scheduledAt:new Date(Date.now()+86400000).toISOString()},'uji')
    const receipt={postUrl:'https://www.instagram.com/p/test-approved/',publishedAt:new Date(Date.now()-60000).toISOString()}
    await expect(recordSocialPublication(store,'otca',schedule.id,receipt,'uji')).rejects.toThrow()
    const recorded=await recordSocialPublication(store,'ciaomanda',schedule.id,receipt,'uji')
    expect(recorded.sourceTaskId).toBe(task.id)
    const repeated=await recordSocialPublication(store,'ciaomanda',schedule.id,receipt,'uji')
    expect(repeated.publication.id).toBe(recorded.publication.id)
    expect((await db.query('SELECT status FROM social_schedule WHERE id=$1',[schedule.id])).rows[0].status).toBe('published')
    const connections=new Connections({store})
    const token=vi.spyOn(connections,'accessToken').mockResolvedValue('test-only')
    const folder=vi.spyOn(DriveLibraryClient.prototype,'folder').mockResolvedValue()
    const child=vi.spyOn(DriveLibraryClient.prototype,'childFolder').mockImplementation(async(parent,name)=>`${parent}-${name}`)
    let sequence=0
    const generate=vi.spyOn(DriveLibraryClient.prototype,'generateId').mockImplementation(async()=>`drive-file-${++sequence}`)
    const upload=vi.spyOn(DriveLibraryClient.prototype,'upload').mockRejectedValueOnce(new Error('upload interrupted')).mockResolvedValue()
    const move=vi.spyOn(DriveLibraryClient.prototype,'move').mockResolvedValue()
    try{
      const library=new ApprovedLibrary(store,connections)
      await store.setIntegrationMode('ciaomanda','drive','live','uji')
      await library.configure('ciaomanda','brand-folder-test')
      await expect(library.sync('otca',task.id)).rejects.toThrow('tidak ditemukan')
      await expect(library.sync('ciaomanda',task.id)).rejects.toThrow('interrupted')
      const interrupted=(await db.query('SELECT drive_status,drive_files FROM approved_packages WHERE source_task_id=$1',[task.id])).rows[0]
      expect(interrupted.drive_status).toBe('failed')
      const firstId=Object.values(interrupted.drive_files)[0]
      await library.sync('ciaomanda',task.id)
      expect(upload.mock.calls[1][0]).toBe(firstId)
      expect(upload.mock.calls.some(call=>call[2]==='caption-publication.txt')).toBe(true)
      expect(move).toHaveBeenCalledTimes(1)
      const complete=(await db.query('SELECT drive_status,drive_location FROM approved_packages WHERE source_task_id=$1',[task.id])).rows[0]
      expect(complete).toMatchObject({drive_status:'synced',drive_location:'published'})
      const count=upload.mock.calls.length
      await library.sync('ciaomanda',task.id)
      expect(upload).toHaveBeenCalledTimes(count)
    }finally{
      token.mockRestore();folder.mockRestore();child.mockRestore();generate.mockRestore();upload.mockRestore();move.mockRestore()
    }
  })

  it('publishes an approved schedule once, serves only signed slides, and reconciles an uncertain delivery without reposting',async()=>{
    const brand='ciaomanda'
    const source=await store.createTask(brand,{agentType:'content-creator',kind:'konten.produksi',title:'QA Meta delivery',brief:'QA publication',createdBy:'uji'})
    await store.transition(brand,source.id,'running',{actor:'uji'})
    const png=await sharp({create:{width:320,height:400,channels:3,background:'#eee'}}).png().toBuffer()
    const submitted=await store.submitProduction(brand,source.id,{content:'Konten untuk review',files:[{name:'slide-02.png',mime:'image/png',data:png},{name:'slide-01.png',mime:'image/png',data:png}],report:{status:'SIAP_DIREVIEW'}})
    const approved=await store.decide(brand,submitted.approval.id,{decision:'approved',actor:'uji'})
    const smm=approved.handoffTask!
    await runTask(deps(scriptedHermes([{output:'Caption publikasi teruji.'}])),brand,smm.id)
    await store.decide(brand,(await store.approvals(brand,{taskId:smm.id}))[0].id,{decision:'approved',actor:'uji'})
    const plan=await planSocialPost(store,brand,smm.id,{platform:'instagram',scheduledAt:new Date(Date.now()+60000).toISOString()},'uji')
    await store.setIntegrationMode(brand,'meta-graph','live','uji')
    const env={META_GRAPH_VERSION:'v25.0',META_CIAOMANDA_PAGE_ID:'123',META_CIAOMANDA_INSTAGRAM_ID:'456',META_CIAOMANDA_PAGE_ACCESS_TOKEN:'test-secret',OFFICE_MEDIA_PUBLIC_URL:'https://office.example',INTEGRATIONS_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')}
    let images=0,publishes=0,verifiedImages=0
    let publisher:MetaPublisher
    const fetcher=vi.fn<typeof fetch>(async(input,init)=>{
      const url=new URL(String(input)),body=new URLSearchParams(String(init?.body??''))
      const reply=(value:unknown)=>new Response(JSON.stringify(value))
      if(url.pathname.endsWith('/123'))return reply({id:'123',name:'Brand test',instagram_business_account:{id:'456'}})
      if(url.pathname.endsWith('/456/media')){
        if(body.get('media_type')==='CAROUSEL')return reply({id:'200'})
        const mediaUrl=new URL(body.get('image_url')!)
        const asset=mediaUrl.pathname.split('/').at(-1)!.replace('.jpg','')
        const expires=mediaUrl.searchParams.get('expires')!,signature=mediaUrl.searchParams.get('signature')!
        const jpeg=await publisher.media(brand,plan.id,asset,expires,signature)
        expect((await sharp(jpeg).metadata()).format).toBe('jpeg')
        await expect(publisher.media(brand,plan.id,asset,expires,'0'.repeat(64))).rejects.toThrow()
        verifiedImages++
        return reply({id:String(100+ ++images)})
      }
      if(url.pathname.endsWith('/200'))return reply({status_code:'FINISHED'})
      if(url.pathname.endsWith('/456/media_publish')){
        publishes++
        await expect(recordSocialPublication(store,brand,plan.id,{postUrl:'https://instagram.com/p/manual-race/',publishedAt:new Date().toISOString()},'uji')).rejects.toThrow('sedang diproses')
        return reply({id:'300'})
      }
      if(url.pathname.endsWith('/300'))return reply({permalink:'https://www.instagram.com/p/meta-test/'})
      if(url.pathname.endsWith('/123/photos')){
        images++
        if(images===4)await store.setPaused(brand,'social-media-manager',true,'uji')
        return reply({id:String(400+images)})
      }
      if(url.pathname.endsWith('/123/feed')){publishes++;throw new Error('network disconnected after publish')}
      throw new Error(`Unexpected Graph path ${url.pathname}`)
    })
    publisher=new MetaPublisher(store,undefined,fetcher,env)
    await expect(publisher.arm('otca',plan.id,'Caption publikasi teruji.','uji')).rejects.toThrow('tidak ditemukan')
    await expect(publisher.arm(brand,plan.id,'Unapproved replacement','uji')).rejects.toThrow('disetujui')
    await publisher.arm(brand,plan.id,'Caption publikasi teruji.','uji')
    await db.query("UPDATE social_schedule SET scheduled_at=now()-interval '1 second' WHERE id=$1",[plan.id])
    await Promise.all([publisher.run(brand,plan.id),publisher.run(brand,plan.id)])
    expect(publishes).toBe(1)
    expect(verifiedImages).toBe(2)
    expect((await db.query('SELECT status FROM social_schedule WHERE id=$1',[plan.id])).rows[0].status).toBe('published')
    expect((await db.query('SELECT provider_id,state FROM social_deliveries WHERE schedule_id=$1',[plan.id])).rows[0]).toMatchObject({provider_id:'300',state:'published'})
    await publisher.run(brand,plan.id)
    expect(publishes).toBe(1)
    const facebook=await planSocialPost(store,brand,smm.id,{platform:'facebook',scheduledAt:new Date(Date.now()+60000).toISOString()},'uji')
    await publisher.arm(brand,facebook.id,'Caption publikasi teruji.','uji')
    await db.query("UPDATE social_schedule SET scheduled_at=now()-interval '1 second' WHERE id=$1",[facebook.id])
    await publisher.cancel(brand,facebook.id,'uji')
    await publisher.run(brand,facebook.id)
    expect(publishes).toBe(1)
    await publisher.arm(brand,facebook.id,'Caption publikasi teruji.','uji')
    await expect(publisher.run(brand,facebook.id)).rejects.toThrow('dijeda')
    expect(publishes).toBe(1)
    await store.setPaused(brand,'social-media-manager',false,'uji')
    await publisher.arm(brand,facebook.id,'Caption publikasi teruji.','uji')
    await publisher.run(brand,facebook.id)
    expect((await db.query('SELECT state FROM social_deliveries WHERE schedule_id=$1',[facebook.id])).rows[0].state).toBe('uncertain')
    expect(publishes).toBe(2)
    await publisher.run(brand,facebook.id)
    expect(publishes).toBe(2)
    await recordSocialPublication(store,brand,facebook.id,{postUrl:'https://www.facebook.com/123/posts/42',publishedAt:new Date().toISOString()},'uji')
    expect((await db.query('SELECT state FROM social_deliveries WHERE schedule_id=$1',[facebook.id])).rows[0].state).toBe('published')
  })

  it('renders a Manager-delegated carousel with inherited images, revises it, and releases the next specialist only after approval',async()=>{
    const chat=new ChatWorkspace(store)
    const png=await sharp({create:{width:320,height:400,channels:3,background:'#eee'}}).png().toBuffer()
    const image=await chat.upload('otca','manager','background.png',png)
    const brief='Buatkan carousel 3 slide dan kalender konten. Gunakan lampiran sebagai latar.'
    const manager=await chat.createChat('otca','manager',brief,{attachmentIds:[image.id]},{agentType:'manager',kind:'konten.orchestrasi',title:'Produksi tim',brief,createdBy:'uji'})
    const spec={brand:'otca',background:{src:'assets/brands/otca/background.png'},slides:[{headline:'Judul satu'},{headline:'Judul dua'},{headline:'Judul tiga'}],caption:'Caption awal'}
    const production=new ProductionEngines({workDir:filesDir})
    vi.spyOn(production,'health').mockResolvedValue({configured:true,ready:true,checks:[],runtime:'uji',error:undefined,mode:'render-and-qa'})
    vi.spyOn(production,'carouselTemplate').mockReturnValue(spec)
    const render=vi.spyOn(production,'run').mockRejectedValueOnce(new ProductionQaError([{slide:1,code:'TEXT_OVERFLOW',message:'Ringkas judul.'}])).mockResolvedValue({content:'Carousel hasil produksi tim',files:[{name:'slide-01.png',mime:'image/png',data:png},{name:'slide-02.png',mime:'image/png',data:png},{name:'slide-03.png',mime:'image/png',data:png},{name:'caption.md',mime:'text/markdown',data:Buffer.from('Caption produksi tim.')}],report:{status:'SIAP_DIREVIEW'}})
    const copy={edits:carouselCopySlots(spec).map(slot=>({path:slot.path,value:'Teks baru'})),images:[{attachmentId:image.id,path:'background.src'}]}
    const hermes=scriptedHermes([
      {output:JSON.stringify({summary:'Render carousel lalu susun kalender',tasks:[{agentType:'content-creator',kind:'konten.carousel-produksi',title:'Render carousel',brief},{agentType:'social-media-manager',kind:'publikasi.kalender',title:'Kalender',brief:'Susun kalender berdasarkan hasil approved',dependsOn:['content-creator']}]})},
      {output:JSON.stringify(copy)},
      {output:JSON.stringify({edits:[{path:'slides.0.headline',value:'Ringkas'}]})},
      {output:JSON.stringify({...copy,edits:carouselCopySlots(spec).map(slot=>({path:slot.path,value:'Teks revisi'}))})},
      {output:'Kalender berdasarkan carousel approved.'},
      {output:'Hasil produksi tim selesai untuk ditinjau.'},
    ])
    const runtime={...deps(hermes),chat,production}
    await runTask(runtime,'otca',manager.id)
    const children=(await store.tasks('otca')).filter(task=>task.parentId===manager.id)
    const creator=children.find(task=>task.agentType==='content-creator')!,smm=children.find(task=>task.agentType==='social-media-manager')!
    await runTask(runtime,'otca',smm.id)
    expect(hermes.requests).toHaveLength(1)
    await runTask(runtime,'otca',creator.id)
    expect((await store.task('otca',creator.id))?.error).toBeNull()
    expect((await store.task('otca',creator.id))?.status).toBe('queued')
    const payload=(await db.query('SELECT payload FROM production_jobs WHERE task_id=$1',[creator.id])).rows[0].payload
    expect(payload.chatAssets[0]).toMatchObject({attachmentId:image.id,chatTaskId:creator.id})
    await expect(chatMaterials(store,'infojerman',payload.chatAssets)).rejects.toThrow()
    await runTask(runtime,'otca',creator.id)
    expect(render).toHaveBeenCalledTimes(2)
    expect(render.mock.calls[0][6]?.[0]?.id).toBe(image.id)
    expect((await store.task('otca',creator.id))?.status).toBe('waiting_approval')
    expect((await store.task('otca',manager.id))?.result).toBeNull()
    await runTask(runtime,'otca',smm.id)
    expect(hermes.requests).toHaveLength(3)
    const review=(await store.approvals('otca',{taskId:creator.id}))[0]
    await store.decide('otca',review.id,{decision:'rejected',note:'Ringkas penutup.',actor:'uji'})
    await runTask(runtime,'otca',creator.id)
    await runTask(runtime,'otca',creator.id)
    expect(hermes.requests[3].input).toContain('Ringkas penutup.')
    await runTask(runtime,'otca',smm.id)
    expect(hermes.requests).toHaveLength(4)
    const revised=(await store.approvals('otca',{taskId:creator.id,open:true}))[0]
    await store.decide('otca',revised.id,{decision:'approved',actor:'uji'})
    await runTask(runtime,'otca',smm.id)
    expect(hermes.requests[4].input).toContain('Caption produksi tim.')
    expect(hermes.requests[4].input).toContain('slide-01.png')
    await store.decide('otca',(await store.approvals('otca',{taskId:smm.id}))[0].id,{decision:'approved',actor:'uji'})
    await runTask(runtime,'otca',manager.id)
    expect((await store.task('otca',manager.id))?.status).toBe('waiting_approval')
    await store.decide('otca',(await store.approvals('otca',{taskId:manager.id}))[0].id,{decision:'approved',actor:'uji'})
    expect((await db.query('SELECT task_id FROM production_jobs WHERE task_id=$1',[creator.id])).rows).toHaveLength(1)
  })

  it('records video draft feedback in a separate preparation job without enabling a full render',async()=>{
    const task=await store.createTask('otca',{agentType:'video-editor',kind:'video.proyek',title:'QA video review',brief:'Brief uji',createdBy:'uji'})
    const payload={title:task.title,brief:task.brief,video:{preset:'glass-tech-bukti-sosial',seed:1}}
    await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,'otca','video-editor',JSON.stringify(payload)])
    await store.transition('otca',task.id,'running',{actor:'uji'})
    const result=await store.submitProduction('otca',task.id,{content:'Draf proyek',files:[],report:{status:'DRAFT_PROJECT'}})
    const rejected=await store.decide('otca',result.approval.id,{decision:'rejected',note:'Perjelas pembuka pada brief.',actor:'uji'})
    expect(rejected.task.status).toBe('cancelled')
    expect(rejected.revisionTask?.kind).toBe('video.proyek')
    const next=(await db.query('SELECT payload FROM production_jobs WHERE task_id=$1',[rejected.revisionTask!.id])).rows[0].payload
    expect(next.brief).toContain('Perjelas pembuka')
    expect(next.video).toEqual(payload.video)
    await store.transition('otca',rejected.revisionTask!.id,'cancelled',{actor:'uji'})
  })

  it('accepts streamed footage, creates a video plan from chat, and keeps source access scoped',async()=>{
    const directory=await mkdtemp(join(process.cwd(),'tmp','qa-video-'))
    try{
      const clipPath=join(directory,'clip.mp4')
      await runProductionProcess('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=black:s=320x400:d=1','-c:v','libx264','-pix_fmt','yuv420p',clipPath],directory)
      const videos=new VideoAttachments(store,join(directory,'uploads'))
      const file=await videos.upload('otca','video-editor','clip.mp4',createReadStream(clipPath))
      expect(file.mime).toBe('video/mp4')
      expect(await videos.file('infojerman','video-editor',file.id)).toBeUndefined()
      await expect(videos.upload('otca','content-creator','clip.mp4',createReadStream(clipPath))).rejects.toThrow('Manager')
      const chat=new ChatWorkspace(store)
      const parent=await chat.createChat('otca','video-editor','Siapkan rencana produksi video dari footage ini.',{attachmentIds:[file.id]})
      const scene={title:'Pembuka',duration:5,narration:'Tentukan tujuan belajar bersama anak.',onScreen:'Mulai dari tujuan',layout:'split',visual:'Talent di bagian bawah, ilustrasi tujuan di atas.',motion:'Jalur bergerak mengikuti kata kunci.',audio:'Audio asli footage.'}
      const plan={objective:'Reels edukasi',audience:'Orang tua',subtitleStyle:'split',scenes:[scene,{...scene,title:'Penutup'}],materials:['Footage pengguna'],risks:['Transkrip belum dikoreksi.']}
      const production=new ProductionEngines({workDir:directory})
      vi.spyOn(production,'health').mockResolvedValue({configured:true,ready:true,checks:[],runtime:'uji',error:undefined,mode:'project-preparation'})
      vi.spyOn(production,'context').mockReturnValue({text:'',files:[],version:'a'.repeat(20)})
      vi.spyOn(production,'presets').mockResolvedValue([{id:'glass-tech-bukti-sosial',label:'Glass Tech'}])
      const render=vi.spyOn(production,'run').mockResolvedValue({content:'Naskah dan rencana adegan siap review.',files:[{name:'production-plan.json',mime:'application/json',data:Buffer.from(JSON.stringify(plan))},{name:'naskah.md',mime:'text/markdown',data:Buffer.from('# Naskah teruji')}],report:{status:'NARRATIVE_PLAN'}})
      const hermes=scriptedHermes([{output:JSON.stringify({preset:'glass-tech-bukti-sosial',plan})}])
      const runtime={...deps(hermes),chat,production,videoAttachments:videos}
      const outcome=await runTask(runtime,'otca',parent.id)
      const childId=outcome.next==='retry'?outcome.children?.[0].id:undefined
      expect(childId,(await store.task('otca',parent.id))?.error??'no task error').toBeDefined()
      expect(hermes.requests[0].input).toContain('Isi ucapan belum ditranskrip')
      await runTask(runtime,'otca',childId!)
      expect(render.mock.calls[0][7]?.[0]?.id).toBe(file.id)
      expect((await store.task('otca',parent.id))?.result).toContain('Naskah dan rencana adegan')
      expect((await store.task('otca',parent.id))?.result).not.toContain('0 slide')
      expect((await store.artifactFiles('otca',[parent.id])).get(parent.id)?.some(item=>item.name==='naskah.md')).toBe(true)
      const review=(await store.approvals('otca',{taskId:childId!}))[0]
      expect((await approvalReview(store,'otca',review.id)).videoPlan?.scenes).toHaveLength(2)
      const revision=await store.decide('otca',review.id,{decision:'rejected',note:'Perjelas tujuan video.',actor:'uji'})
      expect(revision.revisionTask?.kind).toBe('konten.chat')
      const revisionHermes=scriptedHermes([{output:JSON.stringify({preset:'glass-tech-bukti-sosial',plan:{...plan,objective:'Tujuan video direvisi'}})}])
      const revisionRuntime={...runtime,hermes:revisionHermes}
      const revisionOutcome=await runTask(revisionRuntime,'otca',revision.revisionTask!.id)
      const revisionId=revisionOutcome.next==='retry'?revisionOutcome.children?.[0].id:undefined
      expect(revisionId).toBeDefined()
      expect(revisionHermes.requests[0].input).toContain('Rencana sebelumnya')
      const revisionPayload=(await db.query('SELECT payload FROM production_jobs WHERE task_id=$1',[revisionId])).rows[0].payload
      expect(revisionPayload.video.sources[0].attachmentId).toBe(file.id)
      expect(revisionPayload.video.plan.objective).toBe('Tujuan video direvisi')
      await runTask(revisionRuntime,'otca',revisionId!)
      await store.decide('otca',(await store.approvals('otca',{taskId:revisionId!,open:true}))[0].id,{decision:'approved',actor:'uji'})
      const payload=(await db.query('SELECT payload FROM production_jobs WHERE task_id=$1',[childId])).rows[0].payload
      expect(payload.video).not.toHaveProperty('persetujuan')
      const managerFile=await videos.upload('otca','manager','team-clip.mp4',createReadStream(clipPath))
      const manager=await chat.createChat('otca','manager','Susun rencana produksi Reels dari footage.',{attachmentIds:[managerFile.id]},{agentType:'manager',kind:'konten.orchestrasi',title:'Tim video',brief:'Susun rencana produksi Reels dari footage.',createdBy:'uji'})
      const teamHermes=scriptedHermes([
        {output:JSON.stringify({summary:'Video Editor menyusun naskah dan rencana adegan',tasks:[{agentType:'video-editor',kind:'video.rencana-produksi',title:'Rencana Reels',brief:'Susun rencana produksi video dari footage.'}]})},
        {output:JSON.stringify({preset:'glass-tech-bukti-sosial',plan})},
        {output:JSON.stringify({preset:'glass-tech-bukti-sosial',plan:{...plan,objective:'Revisi tujuan Reels'}})},
        {output:'Rencana video siap ditinjau.'},
      ])
      const team={...runtime,hermes:teamHermes}
      await runTask(team,'otca',manager.id)
      const editor=(await store.tasks('otca')).find(task=>task.parentId===manager.id)!
      await runTask(team,'otca',editor.id)
      await runTask(team,'otca',editor.id)
      expect(render.mock.calls.at(-1)?.[7]?.[0]?.id).toBe(managerFile.id)
      expect((await store.task('otca',manager.id))?.result).toBeNull()
      const teamReview=(await store.approvals('otca',{taskId:editor.id}))[0]
      await store.decide('otca',teamReview.id,{decision:'rejected',note:'Perjelas tujuan Reels.',actor:'uji'})
      await runTask(team,'otca',editor.id)
      expect(teamHermes.requests[2].input).toContain('Rencana sebelumnya')
      await runTask(team,'otca',editor.id)
      await store.decide('otca',(await store.approvals('otca',{taskId:editor.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
      await runTask(team,'otca',manager.id)
      expect(teamHermes.requests[3].input).toContain('Naskah teruji')
      await store.decide('otca',(await store.approvals('otca',{taskId:manager.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
      await chat.removeAttachment('otca','manager',managerFile.id)
      await videos.cleanupRemoved('otca','manager',managerFile.id)
      await chat.removeAttachment('otca','video-editor',file.id)
      await videos.cleanupRemoved('otca','video-editor',file.id)
      await expect(videos.material('otca',parent.id,file.id)).rejects.toThrow('dihapus')
    }finally{await rm(directory,{recursive:true,force:true})}
  })

  it('closes a pending source only after its replacement render succeeds, without approving either result',async()=>{
    const create=async(title:string)=>{
      const task=await store.createTask('ciaomanda',{agentType:'content-creator',kind:'konten.produksi',title,brief:'QA versi',createdBy:'uji'})
      await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,'ciaomanda',task.agentType,JSON.stringify({title,brief:'QA',spec:{brand:'ciao-manda',slides:[{headline:title}]}})])
      await store.transition('ciaomanda',task.id,'running',{actor:'uji'})
      return task
    }
    const source=await create('Versi pertama')
    const original=await store.submitProduction('ciaomanda',source.id,{content:'Pertama',files:[],report:{status:'SIAP_DIREVIEW'}})
    const replacement=await create('Revisi')
    await store.logEvent(db,replacement,'carousel_source',{sourceTaskId:source.id})
    expect((await store.task('ciaomanda',source.id))?.status).toBe('waiting_approval')
    await store.submitProduction('ciaomanda',replacement.id,{content:'Revisi',files:[],report:{status:'SIAP_DIREVIEW'}})
    expect((await store.task('ciaomanda',source.id))?.status).toBe('cancelled')
    expect((await reviewSummary(store,'ciaomanda',source.id))?.status).toBe('superseded')
    expect((await store.approvals('ciaomanda',{open:true})).some(a=>a.id===original.approval.id)).toBe(false)
    expect((await store.approvals('ciaomanda',{taskId:replacement.id}))[0].decision).toBeNull()
    await store.transition('ciaomanda',replacement.id,'cancelled',{actor:'uji'})
  })

  it('does not publish local files if cancellation happens during production',async()=>{
    const task=await store.createTask('otca',{agentType:'video-editor',kind:'video.proyek',title:'QA cancellation',brief:'uji',createdBy:'uji'})
    await db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,'otca','video-editor','{}'])
    const production=new ProductionEngines({workDir:filesDir})
    vi.spyOn(production,'run').mockImplementation(async()=>{await store.transition('otca',task.id,'cancelled',{actor:'uji'});return {content:'Tidak boleh dipublikasikan',files:[],report:{}}})
    await runTask({...deps(scriptedHermes([])),production},'otca',task.id)
    expect((await store.task('otca',task.id))?.status).toBe('cancelled')
    expect(await store.assets('otca',task.id)).toHaveLength(0)
    expect(await store.approvals('otca',{taskId:task.id})).toHaveLength(0)
  })

  it('loads the four brands and their crews from context/', async () => {
    expect((await store.brands()).map((brand) => brand.id)).toEqual(['ciaomanda', 'infojerman', 'jepangkoey', 'otca'])
    expect((await store.agents('otca')).map((agent) => agent.agentType)).toContain('event-specialist')
    expect((await store.agents('infojerman')).map((agent) => agent.agentType)).not.toContain('event-specialist')
    await expect(store.createTask('infojerman', { agentType: 'event-specialist', kind: 'event.tema', title: 'x', createdBy: 'uji' })).rejects.toThrow(/tidak aktif/)
  })

  it('takes a stage through approval, rejection with notes, revision and approval', async () => {
    const baseline=await store.summary('otca')
    const event = await events.create('otca', { title: 'Parents Talk Kuliah di Jerman', details: { tanggal: '14 Desember 2026' }, createdBy: 'uji' })
    const task = await events.startStage('otca', event.id, 'tema', 'uji')
    expect(task).toMatchObject({ status: 'queued', agentType: 'event-specialist', kind: 'event.tema', complex: true })
    expect(task.brief).toContain('14 Desember 2026')
    await expect(events.startStage('otca', event.id, 'konsep_ads', 'uji')).rejects.toThrow(/menunggu persetujuan/)

    const hermes = scriptedHermes([{ output: '# Tema v1' }, { output: '# Tema v2' }])
    expect(await runTask(deps(hermes), 'otca', task.id)).toEqual({ next: 'none' })
    expect(hermes.requests[0].instructions).toContain('/context/agents/event-specialist.md')
    expect(hermes.requests[0]).toMatchObject({ reasoningEffort: 'high', sessionId: `task-${task.id}` })
    expect(hermes.requests[0].provider).toBeUndefined() // Codex, the container default
    const [approval] = await store.approvals('otca', { open: true })
    expect(await store.summary('otca')).toEqual({...baseline,approvals:baseline.approvals+1})
    expect(await store.summary('infojerman')).toEqual({ queued: 0, approvals: 0, waitingQuota: 0 })
    expect(approval).toMatchObject({ taskId: task.id, approvalType: 'event' })
    expect((await store.agents('otca')).find((agent) => agent.agentType === 'event-specialist')?.status).toBe('waiting_approval')

    await expect(store.decide('otca', approval.id, { decision: 'rejected', actor: 'uji' })).rejects.toThrow(/catatan/)
    await store.decide('otca', approval.id, { decision: 'rejected', note: 'Tambahkan tema beasiswa', actor: 'uji' })
    expect((await store.task('otca', task.id))?.attempts).toBe(0)
    await runTask(deps(hermes), 'otca', task.id)
    expect(hermes.requests[1].input).toContain('Tambahkan tema beasiswa')
    expect(hermes.requests[1].input).toContain('# Tema v1')
    expect((await store.assets('otca', task.id)).map((asset) => asset.version)).toEqual([2, 1])

    const [second] = await store.approvals('otca', { open: true })
    expect((await approvalReview(store,'otca',approval.id)).content).toBe('# Tema v1')
    expect((await approvalReview(store,'otca',second.id)).content).toBe('# Tema v2')
    const decided = await store.decide('otca', second.id, { decision: 'approved', actor: 'uji' })
    expect(decided.task.status).toBe('approved')
    const detail = await events.detail('otca', event.id)
    expect(detail?.stages.find((stage) => stage.id === 'konsep_ads')?.ready).toBe(true)
    expect(detail?.stages.find((stage) => stage.id === 'ppt')).toMatchObject({ ready: false, missing: ['pertanyaan'] })
  })

  it('turns the approved questions into the speaker answer tracker', async () => {
    const event = await events.create('otca', { title: 'Seminar Beasiswa', createdBy: 'uji' })
    const tema = await events.startStage('otca', event.id, 'tema', 'uji')
    await runTask(deps(scriptedHermes([{ output: 'tema' }])), 'otca', tema.id)
    await store.decide('otca', (await store.approvals('otca', { open: true, taskId: tema.id }))[0].id, { decision: 'approved', actor: 'uji' })
    const questions = await events.startStage('otca', event.id, 'pertanyaan', 'uji')
    const list = Array.from({ length: 10 }, (_, index) => `${index + 1}. Pertanyaan nomor ${index + 1}?`).join('\n')
    await runTask(deps(scriptedHermes([{ output: `Profil narasumber...\n\n${list}` }])), 'otca', questions.id)
    const result = await store.decide('otca', (await store.approvals('otca', { open: true, taskId: questions.id }))[0].id, { decision: 'approved', actor: 'uji' })
    await events.onApproved(result.task)
    const tracker = await events.questions('otca', event.id)
    expect(tracker).toHaveLength(10)
    await expect(events.startStage('otca', event.id, 'ppt', 'uji')).rejects.toThrow(/jawaban narasumber/)
    await events.answer('otca', event.id, tracker[0].id, { answer: 'Mulai dari bahasa', speaker: 'Frau Priska' })
    expect((await events.questions('otca', event.id))[0]).toMatchObject({ status: 'dijawab', speaker: 'Frau Priska' })
    const ppt = await events.startStage('otca', event.id, 'ppt', 'uji')
    expect(ppt.brief).toContain('Mulai dari bahasa')
  })

  it('screens audience research before Hermes and records identifier counts without originals',async()=>{
    const task=await store.createTask('ciaomanda',{agentType:'content-creator',kind:'konten.riset',title:'Riset audiens',brief:'Nama: Sari\nEmail sari@example.com\nHP 081234567890\nPertanyaan: bagaimana belajar bahasa?',createdBy:'uji'})
    const hermes=scriptedHermes([{output:'Tema: belajar bahasa\nCTA: Tinjau ide'}])
    await runTask(deps(hermes),'ciaomanda',task.id)
    expect(hermes.requests).toHaveLength(1)
    const sent=JSON.stringify(hermes.requests[0])
    for(const secret of ['Sari','sari@example.com','081234567890'])expect(sent).not.toContain(secret)
    expect(sent).toContain('bagaimana belajar bahasa')
    expect((await store.task('ciaomanda',task.id))?.status).toBe('waiting_approval')
    const trace=(await store.taskEvents('ciaomanda',task.id)).filter(e=>e.type==='research_privacy')
    expect(trace).toHaveLength(1)
    expect(trace[0].payload).toMatchObject({scope:'text-only',counts:{email:1,telepon:1}})
    expect(JSON.stringify(trace)).not.toContain('Sari')
    expect(await store.task('otca',task.id)).toBeUndefined()
  })

  it('requires publication approval for a versioned same-brand social plan and never posts externally',async()=>{
    const task=await store.createTask('otca',{agentType:'social-media-manager',kind:'publikasi.caption',title:'QA jadwal',brief:'Caption uji',createdBy:'uji'})
    const plan={platform:'instagram',scheduledAt:new Date(Date.now()+86400000).toISOString()}
    await expect(planSocialPost(store,'otca',task.id,plan,'uji')).rejects.toThrow()
    await runTask(deps(scriptedHermes([{output:'Caption QA'}])),'otca',task.id)
    await expect(planSocialPost(store,'otca',task.id,plan,'uji')).rejects.toThrow()
    const review=(await store.approvals('otca',{taskId:task.id,open:true}))[0]
    await store.decide('otca',review.id,{decision:'approved',actor:'uji'})
    await expect(planSocialPost(store,'infojerman',task.id,plan,'uji')).rejects.toThrow()
    const results=await Promise.all([planSocialPost(store,'otca',task.id,plan,'uji'),planSocialPost(store,'otca',task.id,plan,'uji')])
    expect(results[0].id).toBe(results[1].id)
    expect(results[0]).toMatchObject({delivery:'local-plan-only',status:'planned',approval_id:review.id})
    await expect(planSocialPost(store,'otca',task.id,{...plan,scheduledAt:new Date(Date.now()+172800000).toISOString()},'uji')).rejects.toThrow()
    expect((await store.taskEvents('otca',task.id)).filter(e=>e.type==='social_schedule')).toHaveLength(1)
  })

  it('migrates source and consent registries with same-brand and evidence constraints',async()=>{
    const source=(await db.query("INSERT INTO sources(brand_id,title,created_by) VALUES('otca','Sumber QA','uji') RETURNING id")).rows[0]
    await expect(db.query("INSERT INTO consents(brand_id,source_id,subject_reference,usage_scope,status,recorded_by) VALUES('otca',$1,'anon-qa','caption','granted','uji')",[source.id])).rejects.toThrow()
    await expect(db.query("INSERT INTO consents(brand_id,source_id,subject_reference,usage_scope,recorded_by) VALUES('infojerman',$1,'anon-qa','caption','uji')",[source.id])).rejects.toThrow()
    const consent=await db.query("INSERT INTO consents(brand_id,source_id,subject_reference,usage_scope,status,evidence_reference,recorded_by) VALUES('otca',$1,'anon-qa','caption','granted','qa-proof','uji') RETURNING status",[source.id])
    expect(consent.rows[0].status).toBe('granted')
  })

  it('runs a local SMM classification tool from JSON and traces it without external social actions',async()=>{
    const chat=new ChatWorkspace(store)
    const file=await chat.upload('otca','social-media-manager','qa-comments.json',Buffer.from(JSON.stringify({comments:[{id:'qa-1',text:'Berapa biaya?'},{id:'qa-2',text:'Saya kecewa'}]})))
    const task=await chat.createChat('otca','social-media-manager','Klasifikasikan komentar simulasi',{attachmentIds:[file.id],skills:['comment-classification']})
    const hermes=scriptedHermes([{output:'Dua komentar memerlukan review; tidak ada balasan dikirim.'}])
    await runTask({...deps(hermes),chat},'otca',task.id)
    expect(hermes.requests[0].input).toContain('comment-classification')
    expect(hermes.requests[0].input).toContain('complaint')
    expect(hermes.requests[0].input).toContain('externalActions')
    const evidence=(await chat.evidence('otca','social-media-manager')).find(e=>e.taskId===task.id)!
    expect(evidence.trace.tools).toContainEqual({name:'comment-classification',status:'completed'})
    expect((await store.task('otca',task.id))?.status).toBe('done')
    expect((await chat.evidence('ciaomanda','social-media-manager')).some(e=>e.taskId===task.id)).toBe(false)
  })

  it('saves explicit chat memory atomically for its own agent without calling Hermes',async()=>{
    const chat=new ChatWorkspace(store)
    const body='QA-MEMORY-CHAT gunakan sapaan Anda'
    const task=await chat.createChat('ciaomanda','content-creator','Simpan sebagai memori: '+body,{})
    expect(task.status).toBe('done')
    expect(task.result).toContain('Memori disimpan')
    const saved=(await store.agentNotes('ciaomanda')).find(n=>n.body===body)!
    expect(saved).toMatchObject({agentType:'content-creator',kind:'memory',active:true})
    expect((await store.notesFor('ciaomanda','manager')).some(n=>n.id===saved.id)).toBe(false)
    expect((await store.agentNotes('otca')).some(n=>n.id===saved.id)).toBe(false)
    const hermes=scriptedHermes([])
    await runTask({...deps(hermes),chat},'ciaomanda',task.id)
    expect(hermes.requests).toHaveLength(0)
    const before=(await store.tasks('ciaomanda')).length
    await expect(chat.createChat('ciaomanda','content-creator','Simpan sebagai memori: '+body,{skills:['review-draft']})).rejects.toThrow('tanpa lampiran')
    expect((await store.tasks('ciaomanda')).length).toBe(before)
    expect((await store.agentNotes('ciaomanda')).filter(n=>n.body===body)).toHaveLength(1)
    await store.updateNote('ciaomanda',saved.id,current=>({...current,active:false}),'uji')
  })

  it('stores versioned Content Creator QC before approval and keeps reports brand scoped',async()=>{
    const task=await store.createTask('otca',{agentType:'content-creator',kind:'konten.caption',title:'Uji caption',brief:'Konsep anonim',createdBy:'uji'})
    await runTask(deps(scriptedHermes([{output:'[KONFIRMASI: tanggal]\nCTA: Daftar'}])),'otca',task.id)
    expect((await store.latestContentQc('otca',task.id))?.checks.some(c=>c.status==='warning')).toBe(true)
    expect(await store.latestContentQc('infojerman',task.id)).toBeUndefined()
    const review=(await store.approvals('otca',{taskId:task.id,open:true}))[0]
    await store.decide('otca',review.id,{decision:'rejected',note:'Hapus penanda tanggal',actor:'uji'})
    await runTask(deps(scriptedHermes([{output:'Caption yang direvisi\nCTA: Daftar'}])),'otca',task.id)
    expect((await store.latestContentQc('otca',task.id))?.checks.some(c=>c.status==='warning')).toBe(false)
    expect((await store.taskEvents('otca',task.id)).filter(e=>e.type==='content_qc').map(e=>e.payload.version)).toEqual([1,2])
  })

  it('waits for the Codex quota instead of spending the Claude pool, and retries other failures', async () => {
    const event = await events.create('otca', { title: 'Uji kuota', createdBy: 'uji' })
    const task = await events.startStage('otca', event.id, 'tema', 'uji')
    const outcome = await runTask(deps(scriptedHermes([{ status: 'failed', output: 'You have hit your usage limit. Try again in 3 hours.' }])), 'otca', task.id)
    expect(outcome).toMatchObject({ next: 'retry' })
    const waiting = await store.task('otca', task.id)
    expect(waiting).toMatchObject({ status: 'waiting_quota', attempts: 0 })
    expect(waiting?.retryAt).toBeTruthy()

    const beforeReset=scriptedHermes([{output:'should not run'}]);await runTask(deps(beforeReset),'otca',task.id);expect(beforeReset.requests).toHaveLength(0)
    await db.query("UPDATE tasks SET retry_at=now()-interval '1 second' WHERE id=$1",[task.id])
    const failing = scriptedHermes(Array.from({ length: MAX_ATTEMPTS }, () => ({ status: 'failed' as const, output: 'Provider error 500' })))
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) await runTask(deps(failing), 'otca', task.id)
    expect(await store.task('otca', task.id)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS })
  })

  it('resumes durable model stages and an existing provider run after a quota exception',async()=>{
    const task=await store.createTask('otca',{agentType:'manager',kind:'konten.chat',title:'Checkpoint quota',brief:'test',createdBy:'uji'})
    const endpoint={url:'http://hermes',key:'not-stored'},request={input:'page one',instructions:'summarize',sessionId:'s'}
    let calls=0
    const first:HermesClient={run:async(_endpoint,req)=>{calls++;if(req.input==='page two'){await req.onRunCreated?.('existing-run');throw new ProviderLimitError('rate limit',{retryAt:new Date(Date.now()+60000).toISOString(),timingSource:'provider',reason:'rate limit'})}return {runId:'first',status:'completed',output:'summary one',model:'model',inputTokens:10,outputTokens:5}}}
    const client=checkpointHermes(store,task,first)
    await client.run(endpoint,request,'attempt-one');await expect(client.run(endpoint,{...request,input:'page two'},'attempt-two')).rejects.toBeInstanceOf(ProviderLimitError)
    const resumed:HermesClient={run:async(_endpoint,req)=>{calls++;expect(req.resumeRunId).toBe('existing-run');return {runId:'existing-run',status:'completed',output:'summary two',model:'model',inputTokens:10,outputTokens:5}}}
    const fresh=checkpointHermes(store,task,resumed)
    expect(await fresh.run(endpoint,{...request,sessionId:'different-attempt'},'retry')).toMatchObject({output:'summary one',inputTokens:0,checkpointReused:true})
    expect((await fresh.run(endpoint,{...request,input:'page two'},'retry')).output).toBe('summary two');expect(calls).toBe(3)
  })
  it('reuses completed render bytes after a review retry and invalidates changed source versions',async()=>{
    const task=await store.createTask('otca',{agentType:'content-creator',kind:'konten.produksi',title:'Render checkpoint',brief:'test',createdBy:'uji'})
    let renders=0
    const render=async()=>{renders++;return {content:'render',files:[{name:'slide.png',mime:'image/png',data:Buffer.from('exact render bytes')}],report:{status:'review'}}}
    await renderedCheckpoint(store,task,{source:'v1'},render)
    const resumed=await renderedCheckpoint(store,task,{source:'v1'},async()=>{throw new Error('must not rerender')})
    expect(resumed.files[0].data.toString()).toBe('exact render bytes');expect(renders).toBe(1)
    await renderedCheckpoint(store,task,{source:'v2'},render);expect(renders).toBe(2)
  })
  it('parks structured quota exceptions and honors provider retry time',async()=>{
    const task=await store.createTask('otca',{agentType:'manager',kind:'konten.chat',title:'Quota exception',brief:'hello',createdBy:'uji'})
    const client:HermesClient={run:async()=>{throw Object.assign(new Error('Provider throttled'),{status:429,headers:{'retry-after':'75'}})}}
    const before=Date.now();const result=await runTask(deps(client),'otca',task.id)
    expect(result.next).toBe('retry');const row=await store.task('otca',task.id)
    expect(row).toMatchObject({status:'waiting_quota',attempts:0});expect(Date.parse(row!.retryAt!)-before).toBeGreaterThanOrEqual(75000)
  })

  it('never shows or changes one brand\'s work from another brand', async () => {
    const [task] = await store.tasks('otca')
    expect(await store.task('infojerman', task.id)).toBeUndefined()
    await expect(store.transition('infojerman', task.id, 'cancelled', { actor: 'uji' })).rejects.toThrow(/tidak ditemukan/)
    const [approval] = await store.approvals('otca')
    await expect(store.decide('infojerman', approval.id, { decision: 'approved', actor: 'uji' })).rejects.toThrow(/tidak ditemukan/)
    expect(await store.tasks('infojerman')).toEqual([])
  })

  it('parks and restores work with the kill switch, per agent and per brand (FR-26)', async () => {
    const make = (brand: string, agentType: string, title: string) => store.createTask(brand, { agentType, kind: 'konten.chat', title, brief: 'x', createdBy: 'uji' })
    const creator = await make('otca', 'content-creator', 'ks-1')
    const specialist = await make('otca', 'event-specialist', 'ks-2')
    const sister = await make('infojerman', 'content-creator', 'ks-3')

    expect((await store.setPaused('otca', 'content-creator', true, 'uji')).map((task) => task.id)).toContain(creator.id)
    expect((await store.task('otca', creator.id))?.status).toBe('paused')
    expect((await store.task('otca', specialist.id))?.status).toBe('queued')
    expect(await store.isPaused('otca', 'content-creator')).toBe(true)
    expect(await store.isPaused('otca', 'event-specialist')).toBe(false)
    const idle = scriptedHermes([])
    await runTask(deps(idle), 'otca', creator.id)
    expect(idle.requests).toHaveLength(0)

    await store.setPaused('infojerman', undefined, true, 'uji')
    expect((await store.task('infojerman', sister.id))?.status).toBe('paused')
    expect(await store.isPaused('infojerman', 'manager')).toBe(true)
    expect(await store.isPaused('otca', 'manager')).toBe(false)

    await store.setPaused('infojerman', undefined, false, 'uji')
    await store.setPaused('otca', 'content-creator', false, 'uji')
    expect((await store.task('infojerman', sister.id))).toMatchObject({ status: 'queued', attempts: 0 })
    expect((await store.task('otca', creator.id))?.status).toBe('queued')
    await expect(store.setPaused('otca', 'tidak-ada', true, 'uji')).rejects.toThrow(/tidak ada/)
  })

  it('records the duration of each run and reports a task\'s usage to its own brand only (FR-14, FR-20)', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'us-1', brief: 'x', createdBy: 'uji' })
    await runTask(deps(scriptedHermes([{ output: 'jawaban' }])), 'otca', task.id)
    const usage = (await store.taskUsage('otca', [task.id])).get(task.id)
    expect(usage).toMatchObject({ runs: 1, inputTokens: 10, outputTokens: 5, source: 'codex' })
    expect(typeof usage?.durationMs).toBe('number')
    expect((await store.taskUsage('infojerman', [task.id])).size).toBe(0)
    expect((await store.taskUsage('otca', [])).size).toBe(0)
  })

  it('lists a brand\'s saved results and opens one only for its own brand', async () => {
    const [asset] = await store.assetList('otca', 5)
    expect(asset).toMatchObject({ title: expect.any(String), version: expect.any(Number) })
    expect(asset.size).toBeGreaterThan(0)
    expect((await store.asset('otca', asset.id))?.content.length).toBeGreaterThan(0)
    expect(await store.asset('infojerman', asset.id)).toBeUndefined()
    expect(await store.assetList('infojerman')).toEqual([])
  })

  it('saves the files a chat reply carries as assets of their own, and drops unsafe ones', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'af-1', brief: 'x', createdBy: 'uji' })
    const reply = 'Ini berkasnya.\n~~~file:rencana.md\n# Rencana\n~~~\n~~~file:../../jahat.exe\nx\n~~~'
    await runTask(deps(scriptedHermes([{ output: reply }])), 'otca', task.id)
    expect((await store.assets('otca', task.id)).map((asset) => asset.kind).sort()).toEqual(['artifact', 'konten.chat'])
    const listed = (await store.assetList('otca', 50)).filter((item) => item.taskId === task.id)
    expect(listed.find((item) => item.kind === 'artifact')).toMatchObject({ name: 'rencana.md' })
    expect(listed.some((item) => item.name === 'jahat.exe')).toBe(false)
    expect(listed.find((item) => item.kind === 'konten.chat')?.name).toBeNull()
  })

  it('renders a *.pdf file of a chat reply into the file store, and serves it to its own brand only', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'pdf-1', brief: 'x', createdBy: 'uji' })
    const reply = 'Ringkasan siap.\n~~~file:ringkasan.pdf\n# Ringkasan\n\n- poin satu\n- poin dua\n~~~\n~~~file:catatan.md\n# Catatan\n~~~'
    await runTask(deps(scriptedHermes([{ output: reply }])), 'otca', task.id)

    const listed = (await store.assetList('otca', 50)).filter((item) => item.taskId === task.id)
    const pdf = listed.find((item) => item.name === 'ringkasan.pdf')
    expect(pdf).toMatchObject({ mime: 'application/pdf', downloadable: true, kind: 'artifact' })
    expect(listed.find((item) => item.name === 'catatan.md')).toMatchObject({ mime: null, downloadable: false })

    const file = await store.assetFile('otca', pdf!.id)
    expect(file?.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(file?.name).toBe('ringkasan.pdf')
    expect(pdf!.size).toBe(file?.data.length)
    expect((await store.asset('otca', pdf!.id))?.content).toContain('# Ringkasan') // the Markdown source is kept
    expect(await store.assetFile('infojerman', pdf!.id)).toBeUndefined()
    expect(await store.assetFile('otca', listed.find((item) => item.name === 'catatan.md')!.id)).toBeUndefined()
    expect([...(await store.artifactFiles('otca', [task.id])).get(task.id) ?? []].map((item) => item.name)).toEqual(['ringkasan.pdf'])
    expect((await store.artifactFiles('infojerman', [task.id])).size).toBe(0)
  })

  it('prints a stored PDF again from its Markdown, for its own brand only', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'rr-1', brief: 'x', createdBy: 'uji' })
    await runTask(deps(scriptedHermes([{ output: '~~~file:ulang.pdf\n# Cetak Ulang\n\nIsi dokumen.\n~~~' }])), 'otca', task.id)
    const pdf = (await store.assetList('otca', 100)).find((item) => item.taskId === task.id && item.name === 'ulang.pdf')!
    const before = await store.assetFile('otca', pdf.id)

    const { size } = await store.rerenderPdf('otca', pdf.id, 'uji')
    const after = await store.assetFile('otca', pdf.id)
    expect(after?.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(after?.data.length).toBe(size)
    expect((await store.assetList('otca', 100)).find((item) => item.id === pdf.id)?.size).toBe(size)
    expect(before?.data.length).toBeGreaterThan(0)

    await expect(store.rerenderPdf('infojerman', pdf.id, 'uji')).rejects.toThrow(/tidak ditemukan/)
    const note = (await store.assetList('otca', 100)).find((item) => item.taskId === task.id && item.kind === 'konten.chat')!
    await expect(store.rerenderPdf('otca', note.id, 'uji')).rejects.toThrow(/tidak ditemukan/)
  }, 60_000)

  it('runs an agent on the model set for it, and goes back to the default after a reset', async () => {
    const make = (title: string) => store.createTask('otca', { agentType: 'digital-marketing', kind: 'konten.chat', title, brief: 'x', createdBy: 'uji' })
    await store.setRoute('digital-marketing', 'simple', { source: 'codex', model: 'gpt-uji', reasoningEffort: 'high' }, 'uji')
    expect((await store.routeOverrides()).get('digital-marketing')?.simple).toEqual({ source: 'codex', model: 'gpt-uji', reasoningEffort: 'high' })

    const changed = scriptedHermes([{ output: 'a' }])
    await runTask(deps(changed), 'otca', (await make('rt-1')).id)
    expect(changed.requests[0]).toMatchObject({ model: 'gpt-uji', reasoningEffort: 'high' })
    expect(changed.requests[0].provider).toBeUndefined()

    await store.setRoute('digital-marketing', 'simple', { source: 'codex', reasoningEffort: 'low' }, 'uji') // an update, not a second row
    expect(await store.clearRoute('digital-marketing', 'simple', 'uji')).toBe(true)
    expect(await store.clearRoute('digital-marketing', 'simple', 'uji')).toBe(false)
    const reset = scriptedHermes([{ output: 'b' }])
    await runTask(deps(reset), 'otca', (await make('rt-2')).id)
    expect(reset.requests[0].model).toBeUndefined()
    expect(reset.requests[0].reasoningEffort).toBe('low')
    expect((await store.routeOverrides()).has('digital-marketing')).toBe(false)
  })

  it('keeps rules and memory per brand, audits every change, and tells the agent only the active ones', async () => {
    const rule = await store.addNote('otca', { kind: 'rule', title: 'Sapaan', body: 'Selalu mulai dengan salam.', agentType: null, active: true }, 'uji')
    const own = await store.addNote('otca', { kind: 'memory', title: 'Pilihan klien', body: 'Klien suka tanggal akhir pekan.', agentType: 'digital-marketing', active: true }, 'uji')
    await store.addNote('infojerman', { kind: 'rule', title: 'Rahasia brand lain', body: 'jangan bocor', agentType: null, active: true }, 'uji')

    expect((await store.agentNotes('otca')).map((note) => note.title).sort()).toEqual(['Pilihan klien', 'Sapaan'])
    expect((await store.notesFor('otca', 'digital-marketing')).map((note) => note.id).sort()).toEqual([rule.id, own.id].sort())
    expect((await store.notesFor('otca', 'manager')).map((note) => note.id)).toEqual([rule.id])

    const changed = await store.updateNote('otca', own.id, (current) => ({ ...current, body: 'Klien suka tanggal tengah bulan.' }), 'uji')
    expect(changed?.body).toContain('tengah bulan')
    expect(await store.updateNote('infojerman', own.id, (current) => current, 'uji')).toBeUndefined() // another brand's id
    expect(await store.deleteNote('infojerman', own.id, 'uji')).toBe(false)

    const hermes = scriptedHermes([{ output: 'a' }, { output: 'b' }])
    const make = (title: string) => store.createTask('otca', { agentType: 'digital-marketing', kind: 'konten.chat', title, brief: 'x', createdBy: 'uji' })
    await runTask(deps(hermes), 'otca', (await make('nt-1')).id)
    expect(hermes.requests[0].input).toContain('Selalu mulai dengan salam.')
    expect(hermes.requests[0].input).toContain('tengah bulan')
    expect(hermes.requests[0].input).not.toContain('jangan bocor')

    await store.updateNote('otca', rule.id, (current) => ({ ...current, active: false }), 'uji')
    await runTask(deps(hermes), 'otca', (await make('nt-2')).id)
    expect(hermes.requests[1].input).not.toContain('Selalu mulai dengan salam.')

    expect(await store.deleteNote('otca', own.id, 'uji')).toBe(true)
    expect(await store.deleteNote('otca', own.id, 'uji')).toBe(false)
    const actions = (await store.activity('otca', 100)).filter((entry) => entry.kind === 'audit').map((entry) => entry.action)
    expect(actions).toEqual(expect.arrayContaining(['note.create', 'note.update', 'note.delete']))
  })

  it('keeps the integration mode each brand asked for, per service, and audits the change', async () => {
    await store.setIntegrationMode('otca', 'trello', 'sandbox', 'uji')
    await store.setIntegrationMode('otca', 'trello', 'live', 'uji') // an update, not a second row
    await store.setIntegrationMode('infojerman', 'trello', 'mock', 'uji')
    const modes = await store.integrationModes()
    expect(modes.get('otca')?.get('trello')).toBe('live')
    expect(modes.get('infojerman')?.get('trello')).toBe('mock')
    expect(modes.get('ciaomanda')?.has('trello') ?? false).toBe(false)
    expect((await store.activity('otca', 100)).some((entry) => entry.action === 'integration.mode')).toBe(true)
  })

  it('connects an account in one click: PKCE and a single-use state, tokens sealed, refresh, revoked access, Drive, disconnect', async () => {
    const calls: string[] = []
    let refreshFails = false
    const google: typeof fetch = async (input, init) => {
      const url = String(input)
      const form = init?.body instanceof URLSearchParams ? init.body : undefined
      calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}${form?.get('grant_type') ? ` ${form.get('grant_type')}` : ''}`)
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        if (form?.get('grant_type') === 'refresh_token') return refreshFails ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'at-2', expires_in: 3600 })
        return form?.get('code_verifier') && form.get('code') === 'kode-ok' ? Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'openid email drive.readonly' }) : Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      if (url.includes('/userinfo')) return Response.json({ email: 'tim@otca.id' })
      if (url.includes('/export')) return new Response('Isi template TOR')
      if (url.includes('/drive/v3/files')) return Response.json({ files: [{ id: 'f1', name: 'TOR & SKB', mimeType: 'application/vnd.google-apps.document' }] })
      return new Response('{}')
    }
    const key = Buffer.alloc(32, 7).toString('base64')
    const env = { GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'sec', INTEGRATIONS_ENCRYPTION_KEY: key }
    const redirect = 'http://127.0.0.1:3001/api/office/oauth/google/callback'

    await expect(new Connections({ store, env: {}, fetcher: google }).begin('otca', 'drive', redirect, 'uji')).rejects.toMatchObject({ code: 'config' })
    const connections = new Connections({ store, env, fetcher: google })
    await expect(connections.begin('otca', 'trello', redirect, 'uji')).rejects.toThrow(/satu klik/)

    const url = new URL(await connections.begin('otca', 'drive', redirect, 'uji'))
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')?.split(' ')).toContain('https://www.googleapis.com/auth/drive')
    const state = url.searchParams.get('state')!

    await expect(connections.complete({ code: 'kode-ok', state: 'bukan-state' })).rejects.toMatchObject({ code: 'state' })
    expect(await connections.complete({ code: 'kode-ok', state })).toEqual({ brandId: 'otca', service: 'drive' })
    await expect(connections.complete({ code: 'kode-ok', state })).rejects.toMatchObject({ code: 'state' }) // used once

    const listed = await store.connections()
    expect(listed).toEqual([expect.objectContaining({ brandId: 'otca', service: 'drive', account: 'tim@otca.id', status: 'active' })])
    const sealed = await store.connectionSecret('otca', 'drive')
    expect(sealed?.accessToken).not.toContain('at-1')
    expect(sealed?.refreshToken).not.toContain('rt-1')
    expect(JSON.stringify(listed)).not.toContain('at-1')

    const denied = new URL(await connections.begin('otca', 'drive', redirect, 'uji')).searchParams.get('state')!
    await expect(connections.complete({ error: 'access_denied', state: denied })).rejects.toMatchObject({ code: 'denied' })

    expect(await connections.accessToken('otca', 'drive')).toBe('at-1')
    expect(calls.filter((call) => call.endsWith('refresh_token'))).toHaveLength(0)
    await db.query("UPDATE integration_connections SET expires_at = now() - interval '1 minute' WHERE brand_id = 'otca'")
    expect(await connections.accessToken('otca', 'drive')).toBe('at-2')
    expect(await connections.check('otca', 'drive')).toEqual({ account: 'tim@otca.id', visibleFiles: 1 })

    const drive = routedDrive(store, connections, google)
    expect(await drive.template('otca', 'TOR & SKB')).toBeUndefined() // mode is still mock
    await store.setIntegrationMode('otca', 'drive', 'live', 'uji')
    await drive.refresh()
    expect(drive.mode).toBe('live')
    expect(await drive.template('otca', 'TOR & SKB')).toMatchObject({ content: 'Isi template TOR', source: 'Google Drive · TOR & SKB' })
    await store.setIntegrationMode('infojerman', 'drive', 'live', 'uji')
    expect(await drive.template('infojerman', 'TOR & SKB')).toBeUndefined() // another brand has no connection

    refreshFails = true
    await db.query("UPDATE integration_connections SET expires_at = now() - interval '1 minute' WHERE brand_id = 'otca'")
    await expect(connections.accessToken('otca', 'drive')).rejects.toThrow(/hubungkan ulang/)
    expect((await store.connections())[0].status).toBe('needs_reauth')
    await drive.refresh()
    expect(drive.mode).toBe('mock')

    expect(await connections.disconnect('infojerman', 'drive', 'uji')).toBe(false)
    expect(await connections.disconnect('otca', 'drive', 'uji')).toBe(true)
    expect(calls).toContain('POST https://oauth2.googleapis.com/revoke')
    expect(await store.connections()).toEqual([])
    const actions = (await store.activity('otca', 100)).filter((entry) => entry.kind === 'audit').map((entry) => entry.action)
    expect(actions).toEqual(expect.arrayContaining(['integration.connect', 'integration.disconnect']))
  })


  it('persists one crew, waits for specialist approval, and synthesizes through Manager approval', async()=>{
    const parent=await store.createTask('otca',{agentType:'manager',kind:'konten.orchestrasi',title:'Rencana konten tim',brief:'Buat caption',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Content Creator menulis caption',tasks:[{agentType:'content-creator',kind:'konten.caption',title:'Caption tim',brief:'Tulis caption draft tanpa klaim angka'}]})
    const hermes=scriptedHermes([{output:plan},{output:'# Caption spesialis'},{output:'# Ringkasan Manager'}])
    const runner=deps(hermes)
    const [first]=await Promise.all([runTask(runner,'otca',parent.id),runTask(runner,'otca',parent.id)])
    expect(first.next).toBe('retry')
    const children=(await store.tasks('otca')).filter(t=>t.parentId===parent.id)
    expect(children).toHaveLength(1)
    expect(children[0]).toMatchObject({agentType:'content-creator',status:'queued',createdBy:'agent:manager'})
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(1)
    expect((await store.tasks('otca')).filter(t=>t.parentId===parent.id)).toHaveLength(1)
    await runTask(runner,'otca',children[0].id)
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(2)
    const review=(await store.approvals('otca',{taskId:children[0].id,open:true}))[0]
    await store.decide('otca',review.id,{decision:'approved',actor:'uji'})
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(3)
    expect(hermes.requests[2].input).toContain('# Caption spesialis')
    expect((await store.task('otca',parent.id))?.status).toBe('waiting_approval')
    expect(await store.approvals('otca',{taskId:parent.id,open:true})).toHaveLength(1)
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(3)
  })


  it('runs a same-brand DAG only after predecessor approvals and hands over the approved version exactly once',async()=>{
    const brand='infojerman'
    const parent=await store.createTask(brand,{agentType:'manager',kind:'konten.orchestrasi',title:'Workflow berurutan',brief:'Naskah, storyboard, kalender',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Content → Video → SMM',tasks:[
      {agentType:'social-media-manager',kind:'publikasi.kalender',title:'Kalender tahap3',brief:'Jadwalkan draft',dependsOn:['content-creator','video-editor']},
      {agentType:'video-editor',kind:'video.storyboard',title:'Storyboard tahap2',brief:'Gunakan naskah',dependsOn:['content-creator']},
      {agentType:'content-creator',kind:'konten.script',title:'Naskah tahap1',brief:'Susun naskah'},
    ]})
    const hermes=scriptedHermes([{output:plan},{output:'VERSI-DITOLAK'},{output:'NASKAH-SETUJU-V2'},{output:'STORYBOARD-SETUJU'},{output:'KALENDER-SETUJU'},{output:'RANGKUMAN-MANAGER'}])
    const runner=deps(hermes)
    const first=await runTask(runner,brand,parent.id)
    const nodes=(await store.tasks(brand)).filter(t=>t.parentId===parent.id)
    const content=nodes.find(t=>t.agentType==='content-creator')!,video=nodes.find(t=>t.agentType==='video-editor')!,smm=nodes.find(t=>t.agentType==='social-media-manager')!
    expect(first.next==='retry'?first.children?.map(t=>t.id):[]).toEqual([content.id])
    await runTask(runner,brand,video.id);expect(hermes.requests).toHaveLength(1)
    await runTask(runner,brand,content.id)
    await store.decide(brand,(await store.approvals(brand,{taskId:content.id,open:true}))[0].id,{decision:'rejected',note:'Perbaiki naskah',actor:'uji'})
    await runTask(runner,brand,video.id);expect(hermes.requests).toHaveLength(2)
    await runTask(runner,brand,content.id)
    await store.decide(brand,(await store.approvals(brand,{taskId:content.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    const second=await runTask(runner,brand,parent.id)
    expect(second.next==='retry'?second.children?.map(t=>t.id):[]).toEqual([video.id])
    await Promise.all([runTask(runner,brand,video.id),runTask(runner,brand,video.id)])
    expect(hermes.requests).toHaveLength(4)
    expect(hermes.requests[3].input).toContain('NASKAH-SETUJU-V2')
    expect(hermes.requests[3].input).not.toContain('VERSI-DITOLAK')
    const used=(await store.taskEvents(brand,video.id)).find(e=>e.type==='dependency_context')!
    expect(used.payload.sources).toEqual([expect.objectContaining({taskId:content.id,version:2,summarized:false})])
    await runTask(runner,brand,smm.id);expect(hermes.requests).toHaveLength(4)
    await store.decide(brand,(await store.approvals(brand,{taskId:video.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    await runTask(runner,brand,smm.id)
    expect(hermes.requests[4].input).toContain('NASKAH-SETUJU-V2');expect(hermes.requests[4].input).toContain('STORYBOARD-SETUJU')
    await store.decide(brand,(await store.approvals(brand,{taskId:smm.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    await runTask(runner,brand,parent.id)
    expect((await store.task(brand,parent.id))?.status).toBe('waiting_approval')
    expect(hermes.requests).toHaveLength(6)
    expect(await store.task('otca',video.id)).toBeUndefined()
    await expect(dependencyContext(store,video,[{...(await store.task(brand,content.id))!,brandId:'otca'}],{run:async()=>{throw new Error('never')}})).rejects.toThrow('workflow brand')
  })

  it('recovers failed predecessors and atomically cancels pending stages and their open approvals',async()=>{
    const brand='ciaomanda'
    const parent=await store.createTask(brand,{agentType:'manager',kind:'konten.orchestrasi',title:'QA recovery DAG',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Workflow recovery',tasks:[{agentType:'content-creator',kind:'konten.script',title:'Naskah recovery',brief:'Naskah'},{agentType:'video-editor',kind:'video.storyboard',title:'Storyboard recovery',brief:'Storyboard',dependsOn:['content-creator']},{agentType:'social-media-manager',kind:'publikasi.kalender',title:'Kalender recovery',brief:'Kalender',dependsOn:['video-editor']}]})
    const hermes=scriptedHermes([{output:plan},{output:'Naskah pulih'},{output:'Storyboard draft'}]),runner=deps(hermes)
    await runTask(runner,brand,parent.id)
    const nodes=(await store.tasks(brand)).filter(t=>t.parentId===parent.id),source=nodes.find(t=>t.agentType==='content-creator')!,video=nodes.find(t=>t.agentType==='video-editor')!,smm=nodes.find(t=>t.agentType==='social-media-manager')!
    await store.transition(brand,source.id,'running',{actor:'uji'});await store.transition(brand,source.id,'failed',{actor:'uji'})
    await runTask(runner,brand,parent.id);expect((await store.task(brand,parent.id))?.status).toBe('failed')
    await store.transition(brand,source.id,'queued',{actor:'uji'})
    await runTask(runner,brand,source.id)
    expect((await store.task(brand,source.id))?.status).toBe('waiting_approval')
    await store.decide(brand,(await store.approvals(brand,{taskId:source.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    await store.transition(brand,parent.id,'queued',{actor:'uji'})
    await runTask(runner,brand,parent.id);await runTask(runner,brand,video.id)
    expect(await store.approvals(brand,{taskId:video.id,open:true})).toHaveLength(1)
    await expect(cancelWorkflow(store,'otca',parent.id,'uji','cancel')).rejects.toThrow('tidak ditemukan')
    await cancelWorkflow(store,brand,parent.id,'uji','QA selesai')
    expect((await store.task(brand,source.id))?.status).toBe('approved')
    expect((await store.task(brand,video.id))?.status).toBe('cancelled')
    expect((await store.task(brand,smm.id))?.status).toBe('cancelled')
    expect(await store.approvals(brand,{taskId:video.id,open:true})).toHaveLength(0)
    await runTask(runner,brand,smm.id);expect(hermes.requests).toHaveLength(3)
  })

  it('caches complete-source dependency summaries and never reads a foreign parent as an input',async()=>{
    const parent=await store.createTask('jepangkoey',{agentType:'manager',kind:'konten.orchestrasi',title:'QA konteks panjang',createdBy:'uji'})
    const source=await store.createTask('jepangkoey',{agentType:'content-creator',kind:'konten.script',title:'Naskah panjang',parentId:parent.id,createdBy:'uji'})
    const child=await store.createTask('jepangkoey',{agentType:'video-editor',kind:'video.storyboard',title:'Storyboard panjang',parentId:parent.id,createdBy:'uji'})
    await store.transition('jepangkoey',source.id,'running',{actor:'uji'})
    const result=await store.submitForApproval('jepangkoey',source.id,{content:'Sumber lengkap '.repeat(2500)+'SENTINEL-AKHIR',runId:'qa-long',source:'codex',model:'test',inputTokens:1,outputTokens:1})
    await store.decide('jepangkoey',result.approval.id,{decision:'approved',actor:'uji'})
    const approved=(await store.task('jepangkoey',source.id))!
    const hermes=scriptedHermes(Array(10).fill({output:'Ringkasan bagian sumber'}))
    const runtime={run:(request:RunRequest,key:string)=>hermes.run({url:'http://mock',key:'test'},request,key)}
    const first=await dependencyContext(store,child,[approved],runtime),calls=hermes.requests.length
    expect(calls).toBeGreaterThan(0);expect(hermes.requests.map(r=>r.input).join('\n')).toContain('SENTINEL-AKHIR')
    expect(first.sources[0]).toMatchObject({summarized:true,cacheHit:false})
    expect((await dependencyContext(store,child,[approved],runtime)).sources[0].cacheHit).toBe(true)
    expect(hermes.requests).toHaveLength(calls)
    await expect(dependencyContext(store,{...child,parentId:'another'},[approved],runtime)).rejects.toThrow('workflow brand')
    await store.transition('jepangkoey',child.id,'cancelled',{actor:'uji'})
    await store.transition('jepangkoey',parent.id,'cancelled',{actor:'uji'})
  })

  it('blocks aggregation after specialist failure and cancels queued children of a cancelled Manager',async()=>{
    const make=()=>store.createTask('infojerman',{agentType:'manager',kind:'konten.orchestrasi',title:'Delegasi uji',brief:'Caption',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Caption',tasks:[{agentType:'content-creator',kind:'konten.caption',title:'Caption',brief:'Draft caption'}]})
    const hermes=scriptedHermes([{output:plan},{output:plan}])
    const runner=deps(hermes),parent=await make()
    await runTask(runner,'infojerman',parent.id)
    const child=(await store.tasks('infojerman')).find(t=>t.parentId===parent.id)!
    await store.transition('infojerman',child.id,'running',{actor:'uji'})
    await store.transition('infojerman',child.id,'failed',{actor:'uji'})
    await runTask(runner,'infojerman',parent.id)
    expect((await store.task('infojerman',parent.id))?.status).toBe('failed')
    expect(hermes.requests).toHaveLength(1)
    const cancelled=await make()
    await runTask(runner,'infojerman',cancelled.id)
    const cancelledChild=(await store.tasks('infojerman')).find(t=>t.parentId===cancelled.id)!
    await store.transition('infojerman',cancelled.id,'cancelled',{actor:'uji'})
    await runTask(runner,'infojerman',cancelledChild.id)
    expect((await store.task('infojerman',cancelledChild.id))?.status).toBe('cancelled')
    expect(hermes.requests).toHaveLength(2)
  })


  it('previews scoped notes without writes and matches the notes actually supplied to Hermes',async()=>{
    const chat=new ChatWorkspace(store)
    const rule=await store.addNote('infojerman',{kind:'rule',title:'QA preview aturan',body:'Wajib tinjau',agentType:'video-editor',active:true},'uji')
    const memory=await store.addNote('infojerman',{kind:'memory',title:'QA preview beasiswa',body:'Target mahasiswa',agentType:'video-editor',active:true},'uji')
    const hidden=await store.addNote('otca',{kind:'memory',title:'QA preview beasiswa rahasia',body:'Brand lain',agentType:'video-editor',active:true},'uji')
    try{
      const before=await db.query('SELECT count(*)::int AS n FROM agent_chat_memory')
      const preview=await chat.previewNotes('infojerman','video-editor','Beasiswa',true)
      expect(preview.notes.map(n=>n.id)).toEqual(expect.arrayContaining([rule.id,memory.id]))
      expect(preview.notes.find(n=>n.id===memory.id)?.reason).toContain('beasiswa')
      expect((await db.query('SELECT count(*)::int AS n FROM agent_chat_memory')).rows).toEqual(before.rows)
      const withoutMemory=await chat.previewNotes('infojerman','video-editor','Beasiswa',false)
      expect(withoutMemory.notes.some(n=>n.id===rule.id)).toBe(true)
      expect(withoutMemory.notes.every(n=>n.kind==='rule')).toBe(true)
      expect(JSON.stringify(preview)).not.toContain(hidden.id)
      const task=await chat.createChat('infojerman','video-editor','Beasiswa',{})
      const hermes=scriptedHermes([{output:'QA preview selesai'}])
      await runTask({...deps(hermes),chat},'infojerman',task.id)
      const trace=(await chat.evidence('infojerman','video-editor')).find(e=>e.taskId===task.id)!.trace
      expect(trace.notes.map((n:{id:string})=>n.id)).toEqual(preview.notes.map(n=>n.id))
      expect(hermes.requests[0].input).toContain('Target mahasiswa')
      expect(hermes.requests[0].input).not.toContain('Brand lain')
    }finally{await db.query('UPDATE agent_notes SET active=false WHERE id=ANY($1::uuid[])',[[rule.id,memory.id,hidden.id]])}
  })

  it('persists per-message exclusions, protects rules and scope, and leaves stored memory unchanged',async()=>{
    const chat=new ChatWorkspace(store),brand='jepangkoey',agent='video-editor'
    const rule=await store.addNote(brand,{kind:'rule',title:'QA memory choice aturan',body:'QA-REVIEW-WAJIB',agentType:agent,active:true},'uji')
    const own=await store.addNote(brand,{kind:'memory',title:'Beasiswa pilihan',body:'QA-PRIVATE-NOTE',agentType:agent,active:true},'uji')
    const shared=await store.addNote(brand,{kind:'memory',title:'Beasiswa bersama',body:'QA-SHARED-NOTE',agentType:null,active:true},'uji')
    const other=await store.addNote(brand,{kind:'memory',title:'Beasiswa agent lain',body:'QA-OTHER-AGENT',agentType:'manager',active:true},'uji')
    const foreign=await store.addNote('otca',{kind:'memory',title:'Beasiswa brand lain',body:'QA-OTHER-BRAND',agentType:agent,active:true},'uji')
    try{
      const memory=await chat.memory(brand,agent)
      await chat.updateMemory(brand,agent,{revision:memory.revision,summary:'QA-SUMMARY-SECRET'})
      const before=(await store.tasks(brand)).length
      for(const id of [rule.id,other.id,foreign.id]){
        await expect(chat.createChat(brand,agent,'Beasiswa',{excludedMemoryIds:[id]})).rejects.toThrow('tidak tersedia')
        await expect(chat.previewNotes(brand,agent,'Beasiswa',true,{excludedMemoryIds:[id],useSummary:true})).rejects.toThrow('tidak tersedia')
      }
      expect((await store.tasks(brand)).length).toBe(before)
      const choices={excludedMemoryIds:[own.id],useSummary:false}
      const preview=await chat.previewNotes(brand,agent,'Beasiswa',true,choices)
      expect(preview.notes.map(n=>n.id)).toEqual(expect.arrayContaining([rule.id,shared.id]))
      expect(preview.notes.some(n=>n.id===own.id)).toBe(false)
      expect(preview.excludedNotes.map(n=>n.id)).toEqual([own.id])
      expect(preview.summary).toBeNull();expect(preview.summaryAvailable).toBe(true)
      const task=await chat.createChat(brand,agent,'Beasiswa',choices)
      expect(await chat.input(task)).toMatchObject(choices)
      const hermes=scriptedHermes([{output:'QA pemilihan selesai'}])
      await runTask({...deps(hermes),chat},brand,task.id)
      expect(hermes.requests[0].input).toContain('QA-REVIEW-WAJIB')
      expect(hermes.requests[0].input).toContain('QA-SHARED-NOTE')
      expect(hermes.requests[0].input).not.toContain('QA-PRIVATE-NOTE')
      expect(hermes.requests[0].input).not.toContain('QA-SUMMARY-SECRET')
      const trace=(await chat.evidence(brand,agent)).find(e=>e.taskId===task.id)!.trace
      expect(trace).toMatchObject({excludedNotes:[{id:own.id,title:own.title}],useSummary:false,summaryUsed:false})
      const next=await chat.createChat(brand,agent,'Beasiswa',{})
      expect((await chat.prepare(next)).notesText).toContain('QA-PRIVATE-NOTE')
      expect((await chat.prepare(next)).extra).toContain('QA-SUMMARY-SECRET')
      expect((await store.notesFor(brand,agent)).some(n=>n.id===own.id && n.active)).toBe(true)
      await db.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[next.id])
    }finally{
      await db.query('UPDATE agent_notes SET active=false WHERE id=ANY($1::uuid[])',[[rule.id,own.id,shared.id,other.id,foreign.id]])
      const current=await chat.memory(brand,agent);await chat.updateMemory(brand,agent,{revision:current.revision,clear:true})
    }
  })

  it('isolates chat attachments, selected skills and relevant memory with a durable evidence trail',async()=>{
    const chat=new ChatWorkspace(store)
    const file=await chat.upload('jepangkoey','content-creator','brief.md',Buffer.from('Target: mahasiswa beasiswa Jepang'))
    await expect(chat.createChat('otca','content-creator','Baca file',{attachmentIds:[file.id]})).rejects.toThrow('bukan milik')
    await store.addNote('jepangkoey',{kind:'memory',title:'Beasiswa Jepang',body:'Gaya bahasa ringkas',agentType:'content-creator',active:true},'uji')
    await store.addNote('jepangkoey',{kind:'memory',title:'Kopi',body:'Espresso tanpa gula',agentType:'content-creator',active:true},'uji')
    const task=await chat.createChat('jepangkoey','content-creator','Buat konten beasiswa Jepang',{attachmentIds:[file.id],skills:['content-outline']})
    const hermes=scriptedHermes([{output:'Draft beasiswa berdasarkan brief'}])
    await runTask({...deps(hermes),chat},'jepangkoey',task.id)
    expect(hermes.requests[0].input).toContain('Target: mahasiswa beasiswa Jepang')
    expect(hermes.requests[0].instructions).toContain('SKILL APLIKASI')
    expect(hermes.requests[0].input).toContain('Gaya bahasa ringkas')
    expect(hermes.requests[0].input).not.toContain('Espresso tanpa gula')
    const evidence=(await chat.evidence('jepangkoey','content-creator')).find(e=>e.taskId===task.id)!
    expect(evidence.trace.attachments[0]).toMatchObject({id:file.id,name:'brief.md'})
    expect(await chat.attachment('otca','content-creator',file.id)).toBeUndefined()
    expect(await chat.attachment('jepangkoey','manager',file.id)).toBeUndefined()
    await chat.removeAttachment('jepangkoey','content-creator',file.id)
    expect(await chat.attachment('jepangkoey','content-creator',file.id)).toBeUndefined()
    await expect(chat.prepare(task)).rejects.toThrow('dihapus')
  })
  it('summarizes old chats, preserves user edits and prevents forgotten summaries from being regenerated',async()=>{
    const chat=new ChatWorkspace(store)
    const rows=await db.query(`INSERT INTO tasks (brand_id,agent_type,kind,title,brief,result,status,created_by,created_at) SELECT 'jepangkoey','manager','konten.chat','Memory test','Preferensi konten',repeat('Jawaban draft ',200),'done','uji','2026-01-01'::timestamptz + n*interval '1 minute' FROM generate_series(1,16) n RETURNING id`)
    const latest=await store.task('jepangkoey',rows.rows[15].id)
    const hermes=scriptedHermes([{output:'Pengguna memilih konten pendidikan; jadwal belum dikonfirmasi.'}])
    await compactChat(chat,latest!,hermes,{url:'http://hermes',key:'test'},{source:'codex',reasoningEffort:'low'})
    const memory=await chat.memory('jepangkoey','manager')
    expect(memory.summary).toContain('konten pendidikan')
    await chat.updateMemory('jepangkoey','manager',{revision:memory.revision,summary:'Ringkasan pilihan pengguna'})
    await expect(chat.updateMemory('jepangkoey','manager',{revision:memory.revision,summary:'Versi lama'})).rejects.toThrow('telah berubah')
    const updated=await chat.memory('jepangkoey','manager')
    await chat.updateMemory('jepangkoey','manager',{revision:updated.revision,clear:true})
    await compactChat(chat,latest!,hermes,{url:'http://hermes',key:'test'},{source:'codex',reasoningEffort:'low'})
    expect((await chat.memory('jepangkoey','manager')).summary).toBe('')
    expect(hermes.requests).toHaveLength(1)
  })


  it('hands Manager attachments to its own specialists without granting another brand access',async()=>{
    const chat=new ChatWorkspace(store),file=await chat.upload('ciaomanda','manager','brief.md',Buffer.from('Kode handoff CIAO-831'))
    const sharedMemory=await store.addNote('ciaomanda',{kind:'memory',title:'Pilihan bersama',body:'QA-SHARED-EXCLUDE',agentType:null,active:true},'uji')
    const managerMemory=await store.addNote('ciaomanda',{kind:'memory',title:'Pilihan Manager',body:'QA-MANAGER-PRIVATE',agentType:'manager',active:true},'uji')
    const parent=await chat.createChat('ciaomanda','manager','Tulis caption dari brief',{attachmentIds:[file.id],skills:['document-search'],excludedMemoryIds:[sharedMemory.id,managerMemory.id],useSummary:false},{agentType:'manager',kind:'konten.orchestrasi',title:'Caption lampiran',brief:'Tulis caption',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Caption dari lampiran',tasks:[{agentType:'content-creator',kind:'konten.caption',title:'Caption',brief:'Gunakan lampiran Manager'}]})
    const hermes=scriptedHermes([{output:plan},{output:'Caption CIAO-831'}])
    await runTask({...deps(hermes),chat},'ciaomanda',parent.id)
    const child=(await store.tasks('ciaomanda')).find(t=>t.parentId===parent.id)!
    expect((await chat.input(child)).attachmentIds).toEqual([file.id])
    expect(await chat.input(child)).toMatchObject({excludedMemoryIds:[sharedMemory.id],useSummary:false})
    expect(await chat.attachment('ciaomanda','content-creator',file.id)).toBeUndefined()
    await runTask({...deps(hermes),chat},'ciaomanda',child.id)
    expect(hermes.requests[1].input).toContain('CIAO-831')
    expect((await chat.prepare(child)).trace.tools).toContainEqual({name:'document-search',status:'completed'})
    expect(await chat.taskAttachment({...child,brandId:'otca'},file.id)).toBeUndefined()
    await db.query('UPDATE agent_notes SET active=false WHERE id=ANY($1::uuid[])',[[sharedMemory.id,managerMemory.id]])
  })


  it('processes all PDF pages beyond the old limit and preserves explicit ranges and cached progress',async()=>{
    const doc=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[]
    const bytes=new Promise<Buffer>(resolve=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
    for(let page=1;page<=8;page++){doc.addPage();doc.text('Halaman '+page+' isi dokumen lengkap. '+(page===8?'SENTINEL-HALAMAN-TERAKHIR':''))}doc.end()
    const chat=new ChatWorkspace(store),file=await chat.upload('ciaomanda','manager','eight-pages.pdf',await bytes)
    const task=await chat.createChat('ciaomanda','manager','Baca seluruh dokumen',{attachmentIds:[file.id]})
    const full=await chat.taskAttachment(task,file.id)
    const result=await processPdf(store,task,full!,undefined)
    expect(result.coverage).toMatchObject({total:8,selected:8,completed:8,range:'all'})
    expect(result.text).toContain('SENTINEL-HALAMAN-TERAKHIR')
    const selected=await processPdf(store,task,full!,'7-8')
    expect(selected.coverage.selected).toBe(2)
    expect(selected.text).not.toContain('halaman 1]')
    const saved=(await chat.attachments('ciaomanda','manager')).find(f=>f.id===file.id) as unknown as {processing:{status:string;completed:number}}
    expect(saved.processing).toMatchObject({status:'ready',completed:2})
    await chat.removeAttachment('ciaomanda','manager',file.id)
    expect((await db.query('SELECT page FROM chat_attachment_pages WHERE attachment_id=$1',[file.id])).rows).toHaveLength(0)
  },60000)


  it('resumes scanned PDFs after a page failure without re-reading successful pages',async()=>{
    const image=await sharp({create:{width:40,height:40,channels:3,background:'white'}}).png().toBuffer()
    const doc=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[]
    const bytes=new Promise<Buffer>(resolve=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
    for(let page=1;page<=7;page++){doc.addPage();doc.image(image,40,40)}doc.end()
    const chat=new ChatWorkspace(store),file=await chat.upload('ciaomanda','manager','seven-scans.pdf',await bytes)
    const task=await chat.createChat('ciaomanda','manager','Baca scan',{attachmentIds:[file.id]})
    const full=(await chat.taskAttachment(task,file.id))!
    let calls=0,fail=true
    const runtime={run:async(request:{input:string})=>{calls++;const page=Number(request.input.match(/halaman (\d+)/)?.[1]);return {runId:'ocr-'+page,status:fail&&page===4?'failed' as const:'completed' as const,output:fail&&page===4?'':'Teks hasil halaman '+page,model:'test',inputTokens:1,outputTokens:1}}}
    await expect(processPdf(store,task,full,undefined,runtime)).rejects.toThrow('1 halaman gagal')
    expect(calls).toBe(7)
    fail=false
    const result=await processPdf(store,task,full,undefined,runtime)
    expect(calls).toBe(8)
    expect(result.coverage).toMatchObject({total:7,completed:7,ocr:7})
    expect(result.text).toContain('Teks hasil halaman 7')
  },60000)


  it('preserves provider reset information and completed OCR pages across quota',async()=>{
    const doc=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[]
    const bytes=new Promise<Buffer>(resolve=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
    doc.addPage();doc.addPage();doc.end()
    const chat=new ChatWorkspace(store),file=await chat.upload('otca','manager','quota-scan.pdf',await bytes),task=await chat.createChat('otca','manager','Baca scan kuota',{attachmentIds:[file.id]}),full=(await chat.taskAttachment(task,file.id))!
    const retryAt=new Date(Date.now()+90000).toISOString();let calls=0,limited=true
    const runtime={run:async()=>{calls++;if(limited&&calls===2)throw new ProviderLimitError('rate limit',{retryAt,timingSource:'provider',reason:'rate limit'});return {runId:'ocr',status:'completed' as const,output:'halaman tersimpan',model:'test',inputTokens:1,outputTokens:1}}}
    await expect(processPdf(store,task,full,undefined,runtime)).rejects.toMatchObject({limit:{retryAt}})
    expect((await db.query('SELECT processing FROM chat_attachments WHERE id=$1',[file.id])).rows[0].processing).toMatchObject({status:'waiting_quota',retryAt})
    limited=false;expect((await processPdf(store,task,full,undefined,runtime)).coverage.completed).toBe(2);expect(calls).toBe(3)
  },30000)

  it('reuses document summaries by content version and budget, and stores cache metrics honestly',async()=>{
    const chat=new ChatWorkspace(store),text='Dokumen panjang '.repeat(2000)
    const file=await chat.upload('otca','manager','cache-document.md',Buffer.from(text))
    const task=await chat.createChat('otca','manager','Halo',{attachmentIds:[]})
    let calls=0
    const runtime={run:async()=>{calls++;return {runId:'sum',status:'completed' as const,output:'Ringkasan dokumen',model:'m',inputTokens:1,outputTokens:1}}}
    const source={id:file.id,name:file.name,extracted:text}
    expect((await cachedDocumentContext(store,task,source,2000,runtime)).cacheHit).toBe(false)
    const first=calls
    expect((await cachedDocumentContext(store,task,source,2000,runtime)).cacheHit).toBe(true)
    expect(calls).toBe(first)
    expect((await cachedDocumentContext(store,task,{...source,extracted:text+' Versi baru'},2000,runtime)).cacheHit).toBe(false)
    const hermes=scriptedHermes([{output:'Halo, ada yang bisa dibantu?',cacheReadTokens:8,cacheWriteTokens:0}])
    await runTask({...deps(hermes),chat},'otca',task.id)
    const metric=(await db.query('SELECT metrics FROM chat_context_metrics WHERE task_id=$1',[task.id])).rows[0].metrics
    expect(metric).toMatchObject({cacheReadTokens:8,cacheWriteTokens:0,cacheStatus:'reported'})
    expect(metric.officialSelectedChars).toBeLessThan(metric.officialSourceChars)
    expect((await db.query('SELECT cache_read_tokens FROM cost_events WHERE task_id=$1',[task.id])).rows[0].cache_read_tokens).toBe(8)
    await chat.removeAttachment('otca','manager',file.id)
    expect((await db.query('SELECT * FROM document_context_cache WHERE attachment_id=$1',[file.id])).rows).toHaveLength(0)
  })

  it('parks a run that returns after the kill switch was pulled, without filing its result', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'ks-4', brief: 'x', createdBy: 'uji' })
    const hermes: HermesClient = {
      async run() {
        await store.setPaused('otca', 'manager', true, 'uji')
        return { runId: 'r', status: 'completed', output: 'jawaban', model: 'm', inputTokens: 1, outputTokens: 1 }
      },
    }
    await runTask(deps(hermes), 'otca', task.id)
    expect((await store.task('otca', task.id))?.status).toBe('paused')
    expect(await store.assets('otca', task.id)).toEqual([])
    await store.setPaused('otca', 'manager', false, 'uji')
    expect((await store.task('otca', task.id))?.status).toBe('queued')
  })
})

describe('model routing and question parsing', () => {
  it('reads the numbered questions, ignoring other lines', () => {
    expect(parseQuestions('Pengantar\n1. Satu?\n2) **Dua?**\n- catatan\n11. bukan')).toEqual(['Satu?', 'Dua?'])
  })
})

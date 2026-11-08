import type { Connections } from '../integrations/connections.js'
import { DriveLibraryClient } from '../integrations/drive-library.js'
import type { OfficeStore } from './store.js'

export class ApprovedLibrary {
  constructor(private readonly store: OfficeStore, private readonly connections: Connections, private readonly fetcher: typeof fetch = fetch) {}

  async configure(brand: string, folderId: string) {
    if (!/^[\w-]{10,200}$/.test(folderId)) throw new Error('ID folder Drive tidak valid.')
    const drive = new DriveLibraryClient(await this.connections.accessToken(brand, 'drive'), this.fetcher)
    await drive.folder(folderId)
    await this.store.db.query(`INSERT INTO brand_drive_libraries(brand_id,folder_id) VALUES($1,$2)
      ON CONFLICT(brand_id) DO UPDATE SET folder_id=$2,updated_at=now()`, [brand, folderId])
    return { folderId }
  }

  async sync(brand: string, sourceTask: string) {
    const client = await this.store.db.connect()
    const lock = `library:${brand}:${sourceTask}`
    let locked = false
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lock])).rows[0].locked
      if (!locked) throw new Error('Paket sedang disinkronkan. Coba beberapa saat lagi.')
      const pack = (await client.query(`SELECT p.*,t.title FROM approved_packages p JOIN tasks t ON t.id=p.source_task_id AND t.brand_id=p.brand_id
        WHERE p.brand_id=$1 AND p.source_task_id=$2`, [brand, sourceTask])).rows[0]
      if (!pack) throw new Error('Paket Approved tidak ditemukan di brand ini.')
      const publication = (await client.query('SELECT id,published_at FROM social_publications WHERE brand_id=$1 AND package_id=$2 ORDER BY published_at LIMIT 1',[brand,pack.id])).rows[0]
      if (pack.drive_status === 'synced' && (!publication || pack.drive_location === 'published')) return
      const config = (await client.query('SELECT folder_id FROM brand_drive_libraries WHERE brand_id=$1', [brand])).rows[0]
      if (!config) throw new Error('Folder pustaka Drive brand belum dipilih di Pengaturan.')
      if ((await this.store.integrationModes()).get(brand)?.get('drive') !== 'live') throw new Error('Aktifkan mode Live Drive untuk brand ini.')
      const drive = new DriveLibraryClient(await this.connections.accessToken(brand, 'drive'), this.fetcher)
      await drive.folder(config.folder_id)
      const approved = await drive.childFolder(config.folder_id, '04_Approved')
      const date = new Date(pack.approved_at)
      const year = await drive.childFolder(approved, String(date.getUTCFullYear()))
      const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
      const month = await drive.childFolder(year, `${String(date.getUTCMonth()+1).padStart(2,'0')}_${months[date.getUTCMonth()]}`)
      const title = pack.title.replace(/[^\p{L}\p{N} -]/gu, '').slice(0,70).trim() || 'Carousel'
      const folder = pack.drive_folder_id || await drive.childFolder(month, `Carousel_${title}_${sourceTask}`)
      await client.query('UPDATE approved_packages SET drive_folder_id=$3,drive_parent_id=coalesce(drive_parent_id,$4) WHERE brand_id=$1 AND source_task_id=$2', [brand, sourceTask, folder,month])
      const ids: Record<string,string> = pack.drive_files
      const files: Array<{id:string;name:string;mime:string;version:number}> = pack.assets
      if(pack.publication_asset_id)files.push({id:pack.publication_asset_id,name:'caption-publication.txt',mime:'text/plain',version:1})
      for (const asset of files) {
        const file = await this.store.assetFile(brand, asset.id)
        const text = file ? undefined : await this.store.asset(brand, asset.id)
        if (!file && !text) throw new Error(`Berkas approved ${asset.name} tidak ditemukan.`)
        if (!ids[asset.id]) {
          ids[asset.id] = await drive.generateId()
          await client.query('UPDATE approved_packages SET drive_files=$3 WHERE brand_id=$1 AND source_task_id=$2', [brand, sourceTask, JSON.stringify(ids)])
        }
        await drive.upload(ids[asset.id], folder, asset.name, file?.mime ?? asset.mime ?? 'text/plain', file?.data ?? Buffer.from(text!.content))
      }
      if (publication && pack.drive_location !== 'published') {
        const published = await drive.childFolder(config.folder_id, '05_Published')
        const publishedDate = new Date(publication.published_at)
        const publishedYear = await drive.childFolder(published,String(publishedDate.getUTCFullYear()))
        const publishedMonth = await drive.childFolder(publishedYear,`${String(publishedDate.getUTCMonth()+1).padStart(2,'0')}_${months[publishedDate.getUTCMonth()]}`)
        await drive.move(folder,pack.drive_parent_id??month,publishedMonth)
        await client.query("UPDATE approved_packages SET drive_location='published',drive_parent_id=$3 WHERE brand_id=$1 AND source_task_id=$2",[brand,sourceTask,publishedMonth])
      }
      await client.query("UPDATE approved_packages SET drive_status='synced',drive_error=NULL WHERE brand_id=$1 AND source_task_id=$2", [brand, sourceTask])
      await this.store.logEvent(client, {id:sourceTask,brandId:brand}, 'approved_library_synced', {folderId:folder,files:ids})
    } catch (error) {
      if (locked) await client.query("UPDATE approved_packages SET drive_status='failed',drive_error=$3 WHERE brand_id=$1 AND source_task_id=$2", [brand, sourceTask, error instanceof Error ? error.message : 'Sinkronisasi gagal.'])
      throw error
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]).catch(() => undefined)
      client.release()
    }
  }
}

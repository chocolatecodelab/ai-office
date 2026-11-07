import { SERVICES, credentialValue } from './catalog.js'
import { encryptionKey } from './crypto.js'

const BRAND_KEYS:Record<string,string>={otca:'OTCA',infojerman:'INFOJERMAN',ciaomanda:'CIAOMANDA',jepangkoey:'JEPANGKOEY'}

export interface MetaAccount {pageId:string;instagramId:string;version:string}
export interface MetaConfig extends MetaAccount {token:string;publicUrl:string;mediaKey:string}
export interface MetaCheckpoint {children?:string[];container?:string}
interface GraphResult {id?:string;name?:string;permalink?:string;permalink_url?:string;status_code?:string;instagram_business_account?:{id:string};error?:{code?:number}}

export function metaConfiguration(brand:string,platform:string,envDir?:string,env:NodeJS.ProcessEnv=process.env) {
  const def=SERVICES.find(item=>item.service==='meta-graph')!
  const prefix=BRAND_KEYS[brand]
  if(!prefix)throw new Error('Brand Meta tidak dikenal.')
  const read=(name:string)=>credentialValue(def,name,env,envDir)??''
  const names={token:`META_${prefix}_PAGE_ACCESS_TOKEN`,pageId:`META_${prefix}_PAGE_ID`,instagramId:`META_${prefix}_INSTAGRAM_ID`,version:'META_GRAPH_VERSION',publicUrl:'OFFICE_MEDIA_PUBLIC_URL',mediaKey:'INTEGRATIONS_ENCRYPTION_KEY'}
  const config:MetaConfig={token:read(names.token),pageId:read(names.pageId),instagramId:read(names.instagramId),version:read(names.version),publicUrl:read(names.publicUrl).replace(/\/+$/,''),mediaKey:read(names.mediaKey)}
  const missing:string[]=[]
  for(const key of ['token','pageId','version','publicUrl','mediaKey'] as const)if(!config[key])missing.push(names[key])
  if(platform==='instagram'&&!config.instagramId)missing.push(names.instagramId)
  const problems:string[]=[]
  if(config.mediaKey){try{encryptionKey(config.mediaKey)}catch{problems.push('Kunci integrasi harus valid agar tautan media dapat ditandatangani.')}}
  if(config.version&&!/^v\d+\.\d+$/.test(config.version))problems.push('Versi Graph API harus berbentuk vXX.0 sesuai versi aplikasi Meta.')
  if(config.pageId&&!/^\d+$/.test(config.pageId))problems.push('Page ID harus berupa angka.')
  if(config.instagramId&&!/^\d+$/.test(config.instagramId))problems.push('Instagram ID harus berupa angka.')
  if(config.publicUrl){
    try{
      const url=new URL(config.publicUrl)
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.localhost$|.*\.local$)/i.test(url.hostname))problems.push('Alamat media harus origin HTTPS publik yang mengarah ke server AI Office.')
    }catch{problems.push('Alamat media publik tidak valid.')}
  }
  return {config,missing,problems,ready:missing.length===0&&problems.length===0}
}

export class MetaGraph {
  constructor(private readonly config:MetaConfig,private readonly fetcher:typeof fetch=fetch) {}

  async request(path:string,params:Record<string,string>,post=false):Promise<GraphResult> {
    const base=`https://graph.facebook.com/${this.config.version}/${path}`
    const query=new URLSearchParams(params)
    let response:Response
    try{
      response=await this.fetcher(post?base:`${base}?${query}`,{
        method:post?'POST':'GET',headers:{Authorization:`Bearer ${this.config.token}`,...(post?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
        ...(post?{body:query}:{}),signal:AbortSignal.timeout(45_000),
      })
    }catch{throw new Error('Koneksi Meta terputus. Periksa status pengiriman sebelum mencoba lagi.')}
    const result=await response.json().catch(()=>({})) as GraphResult
    if(!response.ok||result.error)throw new Error(`Meta menolak permintaan (${result.error?.code??response.status}). Periksa izin akun dan token di Pengaturan.`)
    return result
  }

  async check(platform:string) {
    const page=await this.request(this.config.pageId,{fields:'id,name,instagram_business_account'})
    if(page.id!==this.config.pageId)throw new Error('Token Meta tidak cocok dengan Page brand ini.')
    if(platform==='instagram'&&page.instagram_business_account?.id!==this.config.instagramId)throw new Error('Instagram brand ini belum terhubung ke Page yang dipilih.')
    return {pageId:page.id,name:page.name,instagramId:page.instagram_business_account?.id}
  }

  async prepare(platform:string,images:string[],caption:string,checkpoint:MetaCheckpoint,save:(checkpoint:MetaCheckpoint)=>Promise<void>):Promise<string> {
    if(images.length<1||images.length>10)throw new Error('Publikasi mendukung 1–10 gambar.')
    const children=checkpoint.children??[]
    for(let index=children.length;index<images.length;index++){
      const result=platform==='instagram'
        ?await this.request(`${this.config.instagramId}/media`,{image_url:images[index],...(images.length>1?{is_carousel_item:'true'}:{caption})},true)
        :await this.request(`${this.config.pageId}/photos`,{url:images[index],published:'false'},true)
      if(!result.id)throw new Error('Meta tidak memberikan ID gambar.')
      children.push(result.id)
      checkpoint={...checkpoint,children:[...children]}
      await save(checkpoint)
    }
    if(platform==='facebook')return ''
    if(!checkpoint.container){
      if(images.length===1)checkpoint.container=children[0]
      else{
        const result=await this.request(`${this.config.instagramId}/media`,{media_type:'CAROUSEL',children:children.join(','),caption},true)
        if(!result.id)throw new Error('Meta tidak memberikan ID carousel.')
        checkpoint.container=result.id
      }
      await save(checkpoint)
    }
    const status=await this.request(checkpoint.container,{fields:'status_code'})
    if(['ERROR','EXPIRED'].includes(status.status_code??'')){
      await save({})
      throw new Error('Persiapan gambar di Meta gagal atau kedaluwarsa. Coba lagi untuk membuat container baru.')
    }
    if(status.status_code!=='FINISHED')throw new Error(status.status_code==='PUBLISHED'?'Container ini sudah terbit. Periksa posting di Instagram.':'Meta belum menyelesaikan persiapan gambar. Coba pengiriman lagi setelah beberapa saat.')
    return checkpoint.container
  }

  async publish(platform:string,caption:string,checkpoint:MetaCheckpoint):Promise<string> {
    const result=platform==='instagram'
      ?await this.request(`${this.config.instagramId}/media_publish`,{creation_id:checkpoint.container!},true)
      :await this.request(`${this.config.pageId}/feed`,{message:caption,attached_media:JSON.stringify((checkpoint.children??[]).map(id=>({media_fbid:id})))},true)
    if(!result.id)throw new Error('Meta belum mengonfirmasi ID posting.')
    return result.id
  }

  async permalink(id:string,platform:string):Promise<string> {
    const result=await this.request(id,{fields:platform==='instagram'?'permalink':'permalink_url'})
    const url=result.permalink??result.permalink_url
    if(!url)throw new Error('Posting telah dikirim. Tautan hasil belum tersedia dari Meta.')
    return url
  }
}

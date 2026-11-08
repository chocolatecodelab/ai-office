export interface LimitInfo {retryAt:string;timingSource:'provider'|'fallback';reason:string}
const duration=(text:string)=>{const parts=[...text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)(?=\s|\d|$|[,.;])/gi)];return parts.length?parts.reduce((sum,m)=>sum+Number(m[1])*({ms:1,s:1000,m:60000,h:3600000,d:86400000}[m[2].toLowerCase().replace(/^(seconds?|secs?)$/,'s').replace(/^(minutes?|mins?)$/,'m').replace(/^(hours?|hrs?)$/,'h').replace(/^days?$/,'d')]??0),0):undefined}
export function quotaInfo(input:unknown,headers?:Headers,now=Date.now(),status?:number):LimitInfo|undefined{
 const value=input instanceof Error?input.message:typeof input==='string'?input:JSON.stringify(input??'')
 if(status!==429&&!/usage limit|quota|rate.?limit|too many requests|\b429\b|limit (has been )?reached|try again (in|at|later)/i.test(value))return undefined
 const candidates:number[]=[]
 const add=(ms:number|undefined)=>{if(ms!==undefined&&Number.isFinite(ms)&&ms>=now-60000&&ms<now+366*86400000)candidates.push(Math.max(ms,now))}
 const retry=headers?.get('retry-after');if(retry)add(/^\d+(\.\d+)?$/.test(retry)?now+Number(retry)*1000:Date.parse(retry))
 for(const key of ['x-ratelimit-reset-requests','x-ratelimit-reset-tokens','x-ratelimit-reset','ratelimit-reset']){const raw=headers?.get(key);if(raw){const n=Number(raw);add(Number.isFinite(n)?n>1e12?n:n>1e9?n*1000:now+n*1000:duration(raw)!==undefined?now+duration(raw)!:Date.parse(raw))}}
 let body:unknown=input
 if(typeof input==='string')try{body=JSON.parse(input)}catch{/* Text fallback below. */}
 const visit=(x:unknown,depth=0)=>{if(!x||typeof x!=='object'||depth>4)return;for(const [k,v]of Object.entries(x)){
 if(/^(retry_after|retry_after_seconds|retryAfter)$/i.test(k)&&typeof v==='number')add(now+v*1000)
 if(k==='retry_after_ms'&&typeof v==='number')add(now+v)
 if(/^(reset_at|resets_at|retry_at|resetAt)$/i.test(k)){if(typeof v==='number')add(v>1e12?v:v*1000);if(typeof v==='string')add(Date.parse(v))}
 visit(v,depth+1)
 }};visit(body)
 const relative=/try again in\s+([^\n;]+)/i.exec(value);if(relative)add(duration(relative[1])!==undefined?now+duration(relative[1])!:undefined)
 for(const stamp of value.match(/\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)/g)??[])add(Date.parse(stamp))
 return {retryAt:new Date(candidates.length?Math.max(...candidates)+1000:now+30*60000).toISOString(),timingSource:candidates.length?'provider':'fallback',reason:value.slice(0,500)}
}
export class ProviderLimitError extends Error {constructor(message:string,readonly limit:LimitInfo){super(message);this.name='ProviderLimitError'}}
export function limitFromError(error:unknown){
 if(error instanceof ProviderLimitError)return error.limit
 if(!error||typeof error!=='object')return quotaInfo(error)
 const e=error as {message?:string;busy?:boolean;permanent?:boolean;status?:number;statusCode?:number;headers?:ConstructorParameters<typeof Headers>[0];retry_after?:number;retry_after_ms?:number;reset_at?:string;response?:{status?:number;headers?:ConstructorParameters<typeof Headers>[0];data?:unknown}}
 if(e.busy||e.permanent)return undefined
 let headers:Headers|undefined
 try{headers=new Headers(e.headers??e.response?.headers)}catch{/* Some SDK header wrappers are not ConstructorParameters<typeof Headers>[0]. */}
 return quotaInfo({message:e.message,error:e.response?.data,retry_after:e.retry_after,retry_after_ms:e.retry_after_ms,reset_at:e.reset_at},headers,Date.now(),e.status??e.statusCode??e.response?.status)
}
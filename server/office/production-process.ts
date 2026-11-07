import { spawn } from 'node:child_process'

/** Fixed executables and argument arrays only; never execute a prompt through a shell. */
export function runProductionProcess(executable:string,args:string[],cwd:string,options:{timeoutMs?:number;signal?:AbortSignal;env?:Record<string,string>;onOutput?:(text:string)=>void}={}) {
  return new Promise<string>((resolve,reject)=>{
    let settled=false,output=''
    const child=spawn(executable,args,{cwd,shell:false,windowsHide:true,signal:options.signal,env:{...process.env,...options.env,PYTHONUTF8:'1'}})
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(output)}
    const stop=()=>{
      // Kill the renderer's entire tree, including Chromium/FFmpeg children on Windows.
      if(process.platform==='win32'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false}).on('error',()=>child.kill())
      else child.kill('SIGKILL')
    }
    const timer=setTimeout(()=>{stop();finish(new Error('Pipeline melewati batas waktu; proses dihentikan.'))},options.timeoutMs??120000)
    for(const stream of [child.stdout,child.stderr])stream.on('data',(chunk:Buffer)=>{output=(output+chunk.toString()).slice(-32000);options.onOutput?.(chunk.toString())})
    child.on('error',error=>finish(error))
    child.on('close',code=>finish(code===0?undefined:new Error(`Pipeline gagal (${code??'dihentikan'}): ${output.slice(-2500)}`)))
    options.signal?.addEventListener('abort',stop,{once:true})
    child.on('close',()=>options.signal?.removeEventListener('abort',stop))
  })
}

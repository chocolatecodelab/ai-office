import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';
const root='D:/KERJAAN/CODING/CLAUDE/VIDEO_EDITOR/video-system';
const props=JSON.parse(readFileSync(root+'/proyek/2026-11_otca-nina-beasiswa-s1/storyboard-props-r2.json','utf8'));
const designs=[['gate',['Beasiswa S1.','Pahami peluangnya.']],['directory',['Pendanaan punya','sasaran berbeda.']],['directory',['S2. Doktoral.','Penelitian.']],['calendar',['Ada program','untuk mahasiswa S1.']],['compare',['Kursus musim panas','≠ kuliah S1 penuh.']],['selection',['Bukan jaminan.','Ada persyaratan.']],['selection',['Prestasi. Syarat.','Proses seleksi.']],['plan',['Rencanakan studi','secara menyeluruh.']],['link',['Mulai persiapan','bersama OTCA.']],['brand',[]]];
props.scenes=props.scenes.map((s,i)=>({...s,art:designs[i][0],heading:designs[i][1]}));
// Retain source word timings and corrected spelling already curated in native R2.
writeFileSync('tmp/office-r4-props.json',JSON.stringify(props,null,2));
const require=createRequire(root+'/remotion/package.json');const {bundle}=require('@remotion/bundler');const {selectComposition,renderStill}=require('@remotion/renderer');
const url=await bundle({entryPoint:root+'/remotion/src/OfficeEditorialR4.tsx',publicDir:root+'/remotion/public',outDir:root+'/.sementara/office-r4-bundle'});
const browserExecutable='C:/Program Files/Google/Chrome/Application/chrome.exe';
const composition=await selectComposition({serveUrl:url,id:'EditorialStudyR4',inputProps:props,browserExecutable});
const samples=props.scenes.map(s=>({id:s.id,time:Math.min(s.selesai-.15,Math.max(s.mulai+1.2,s.sample_time??s.mulai+1.5))}));
samples.push({id:'action-start',time:props.scenes[2].mulai+.15},{id:'action-middle',time:props.scenes[2].mulai+.65},{id:'action-end',time:props.scenes[2].mulai+1.6});
for(const s of samples){await renderStill({serveUrl:url,composition,inputProps:props,frame:Math.round(s.time*30),output:root+'/proyek/2026-11_otca-nina-office-r4/out/storyboard-r4/'+s.id+'.png',imageFormat:'png',browserExecutable,scale:.5});console.log('Rendered '+s.id)}
writeFileSync('tmp/office-r4-samples.json',JSON.stringify(samples));

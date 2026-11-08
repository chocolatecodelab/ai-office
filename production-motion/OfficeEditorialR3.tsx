import React from 'react';
import {AbsoluteFill,Composition,Img,OffthreadVideo,registerRoot,staticFile,useCurrentFrame,useVideoConfig,interpolate,Easing} from 'remotion';
import {pakaiFontToken} from './lib/font';
import type {Tokens} from './lib/kontrak';
// Frame-driven editorial grammar. Copy, timings, palettes and footage remain project props.
export const EditorialStudy=({tokens,scenes,pages,footage,logo}:any)=>{
 const f=useCurrentFrame(),{fps}=useVideoConfig(),t=f/fps,tok=pakaiFontToken(tokens as Tokens);
 const s=scenes.find((x:any)=>t>=x.mulai&&t<x.selesai)??scenes[scenes.length-1];
 const ease=(a:number,d=.7)=>interpolate(t,[a,a+d],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.16,1,.3,1)});
 const p=ease(s.mulai),full=s.mode==='full',brand=s.visual==='brand',gold=String(tok.warna.aksen),white=String(tok.warna['teks-utama']);
 const active=pages.find((page:any,i:number)=>t>=page[0].s&&t<Math.min(pages[i+1]?.[0].s??999,page[page.length-1].e+.25));
 const W=920,H=620;
 const document=(x:number,y:number,w:number,h:number,angle=0)=> <g transform={`translate(${x} ${y}) rotate(${angle})`}><rect x="9" y="15" width={w} height={h} rx="14" fill="#372a0e"/><rect width={w} height={h} rx="14" fill="#f5f1e8" stroke={gold} strokeWidth="3"/><path d={`M28 45h${w-56}M28 65h${w-75}M28 85h${w-65}`} stroke="#b5b0a6" strokeWidth="7"/><path d={`M28 ${h-48}h${w*.4}`} stroke={gold} strokeWidth="12"/></g>;
 const label=(text:string,x:number,y:number,size=30,color=white)=><text x={x} y={y} fill={color} fontFamily={tok.font.isi.family} fontSize={size} fontWeight="700">{text}</text>;
 const a=(i:number)=>ease(s.anchors?.[i]??s.mulai+.3+i*.35);
 const art=()=>{
 switch(s.art){
 case 'gate':return <>{document(290,80,300,360,-7+7*p)}<path d="M420 140v250" stroke="#000" strokeWidth="12"/>{[0,1,2].map(i=><g key={i} transform={`translate(${130+i*245} ${350-100*a(i)})`} opacity={a(i)}><path d="M0 15l110-50 110 50-110 50z" fill={gold}/><path d="M48 44v55q62 45 124 0V44" fill="#846018"/>{label(['','S1',''][i],88,86,32,'#fff')}</g>)}</>;
 case 'directory':return <>{document(120,140,260,330,-8*p)}<path d={`M390 305H${390+100*p}`} stroke={gold} strokeWidth="6"/>{[0,1,2].map(i=><g key={i} opacity={a(i)} transform={`translate(${500+60*(1-a(i))} ${100+i*160})`}><path d="M0 50h52" stroke={gold} strokeWidth="4"/><circle cx="66" cy="50" r="10" fill={gold}/>{label(['Master','Doktoral','Peneliti'][i],100,62,40)}<path d="M100 87h250" stroke="#564723" strokeWidth="2"/></g>)}{label('DAAD',167,359,38,'#000')}</>;
 case 'calendar':return <>{document(130,130,340,330,-5*p)}<g transform={`translate(${320+150*p} 200)`}><rect width="270" height="275" rx="18" fill="#211a0c" stroke={gold} strokeWidth="4"/><path d="M0 70h270" stroke={gold} strokeWidth="4"/>{label('KURSUS',35,49,30,gold)}{[0,1,2,3,4,5,6,7,8].map(i=><rect key={i} x={40+(i%3)*70} y={105+Math.floor(i/3)*50} width="26" height="23" rx="3" fill={i===4?gold:'#756647'}/>)}</g>{label('Program tertentu',145,535,40,gold)}</>;
 case 'compare':return <>{document(75,120,250,300,-5)}{document(595,120,250,300,5)}{label('Kursus',128,492,35)}{label('S1 penuh',614,492,35)}<path d="M412 250h100M412 290h100M493 210l-60 125" stroke={gold} strokeWidth={12} strokeDasharray="200" strokeDashoffset={200*(1-p)}/>{label('Cakupan berbeda',255,580,36,gold)}</>;
 case 'selection':return <>{document(290,100,330,390,-4+4*p)}{[0,1,2].map(i=><g key={i} opacity={a(i)} transform={`translate(0 ${30*(1-a(i))})`}><circle cx="365" cy={215+i*90} r="21" fill={gold}/>{label(['Prestasi','Persyaratan','Seleksi'][i],410,225+i*90,29,'#000')}</g>)}<circle cx={680-100*p} cy={390-150*p} r="105" fill="#0002" stroke={gold} strokeWidth="14"/><path d={`M${755-100*p} ${465-150*p}l70 70`} stroke={gold} strokeWidth="24"/></>;
 case 'plan':return <><path d="M100 410C240 410 240 230 460 230S650 410 820 210" fill="none" stroke="#4b3b19" strokeWidth="8"/><path d="M100 410C240 410 240 230 460 230S650 410 820 210" fill="none" stroke={gold} strokeWidth="8" strokeDasharray="1000" strokeDashoffset={1000*(1-p)}/>{[0,1,2].map(i=><g key={i} opacity={a(i)}>{document(70+i*285,170+(i===1?-70:50),190,235,i===1?0:-6)}{label(['Persiapan','Dokumen','Rencana'][i],75+i*285,520,26,gold)}</g>)}</>;
 case 'link':return <><g transform={`translate(${80+90*p} 170)`}><rect width="335" height="165" rx="82" fill="none" stroke={gold} strokeWidth="35" transform="rotate(-25 170 80)"/></g><g transform={`translate(${520-90*p} 250)`}><rect width="335" height="165" rx="82" fill="none" stroke="#f1daa4" strokeWidth="35" transform="rotate(-25 170 80)"/></g>{label('Mulai persiapan',235,550,45,gold)}</>;
 default:return null;
 }};
 const captionWords=active??[],mid=captionWords.length>5?Math.ceil(captionWords.length/2):0;
 return <AbsoluteFill style={{background:'#000',color:white,fontFamily:tok.font.judul.family}}>
 {!full&&!brand&&<AbsoluteFill style={{top:960,overflow:'hidden'}}><OffthreadVideo src={staticFile(footage)} muted style={{width:1080,height:1920,objectFit:'cover',position:'absolute',top:-550}}/></AbsoluteFill>}
 {!brand&&<><Img src={staticFile(logo)} style={{position:'absolute',left:422.5,top:275,width:235,height:72,objectFit:'contain'}}/>
 <div style={{position:'absolute',top:full?425:385,left:108,right:120,fontSize:full?76:59,fontWeight:800,lineHeight:1.12,letterSpacing:-1.5,color:gold,opacity:p,transform:`translateY(${24*(1-p)}px)`}}>{s.heading.map((line:string,i:number)=><div key={i}>{line}</div>)}</div>
 <svg width="920" height="620" viewBox={`0 0 ${W} ${H}`} style={{position:'absolute',left:80,top:full?650:500,height:full?620:365,width:920,opacity:p,overflow:'visible'}}>{art()}</svg>
 {!full&&<div style={{position:'absolute',left:0,right:0,top:925,height:95,background:'linear-gradient(#000,transparent)'}}/>}
 {active&&<div style={{position:'absolute',top:full?1305:845,left:108,right:120,padding:'20px 24px',background:'#000',borderTop:`3px solid ${gold}`,fontFamily:tok.font.caption.family,fontSize:48,lineHeight:1.3,fontWeight:700,textAlign:'left'}}>{(mid?[captionWords.slice(0,mid),captionWords.slice(mid)]:[captionWords]).map((line:any[],i:number)=><div key={i}>{line.map((w:any,j:number)=><React.Fragment key={j}><span style={{color:t>=w.s&&t<w.e?gold:white}}>{w.w}</span>{' '}</React.Fragment>)}</div>)}</div>}</>}
 {brand&&<><Img src={staticFile(logo)} style={{position:'absolute',top:730,left:190,width:700,height:215,objectFit:'contain',opacity:p}}/><div style={{position:'absolute',top:1020,left:150,right:150,height:7,background:`linear-gradient(90deg,${gold},#FDF1A4,#B3822C)`,transform:`scaleX(${p})`}}/></>}
 </AbsoluteFill>
};
registerRoot(()=> <Composition id="EditorialStudyR3" component={EditorialStudy} width={1080} height={1920} fps={30} durationInFrames={1547} defaultProps={{}}/>);

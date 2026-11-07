export interface VideoNarrativePlan {
  objective:string;audience:string;subtitleStyle:string;
  scenes:Array<{title:string;duration:number;narration:string;onScreen:string;layout:string;visual:string;motion:string;audio:string}>;
  materials:string[];risks:string[]
}

export function VideoPlanReview({plan}:{plan:VideoNarrativePlan}) {
  let cursor=0
  return <section className="video-plan-review" aria-label="Naskah dan rencana adegan">
    <header><h3>Naskah dan rencana adegan</h3><p>{plan.objective}</p><small>{plan.audience} · {plan.scenes.reduce((sum,scene)=>sum+scene.duration,0)} detik estimasi · subtitle {plan.subtitleStyle}</small></header>
    <p>Timing dan subtitle masih draf. Storyboard visual dengan still perlu ditinjau sebelum render penuh.</p>
    <ol>{plan.scenes.map((scene,index)=>{
      const start=cursor;cursor+=scene.duration
      return <li key={index}><header><strong>{scene.title}</strong><small>{start.toFixed(1)}–{cursor.toFixed(1)} dtk · {scene.layout}</small></header><p className="video-plan-narration">{scene.narration}</p><dl><dt>Teks layar</dt><dd>{scene.onScreen}</dd><dt>Visual</dt><dd>{scene.visual}</dd></dl><details><summary>Gerak dan audio</summary><p>{scene.motion}</p><p>{scene.audio}</p></details></li>
    })}</ol>
    {plan.materials.length>0&&<section><h4>Bahan yang diperlukan</h4><ul>{plan.materials.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}
    {plan.risks.length>0&&<section><h4>Perlu dikonfirmasi</h4><ul>{plan.risks.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}
  </section>
}

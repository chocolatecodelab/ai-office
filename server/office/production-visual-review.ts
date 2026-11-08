import sharp from 'sharp'
import { z } from 'zod'
import type { ProducedFile } from './production-engines.js'
export const visualReviewSchema=z.object({summary:z.string().min(1).max(2000),issues:z.array(z.object({slide:z.number().int().min(1).max(10),severity:z.enum(['blocking','suggestion']),message:z.string().min(1).max(1200)})).max(20)}).strict()
export function parseVisualReview(output:string){
 const review=visualReviewSchema.parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')))
 return {...review,assessment:'ai-visual-review',passed:!review.issues.some(i=>i.severity==='blocking')}
}
export async function visualSlideImages(files:ProducedFile[]){
 const slides=files.filter(f=>/^slide-\d+\.png$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name))
 if(!slides.length||slides.length>10)throw new Error('Gambar slide untuk tinjauan visual tidak tersedia.')
 return Promise.all(slides.map(async f=>'data:image/jpeg;base64,'+(await sharp(f.data).resize({width:900,withoutEnlargement:true}).jpeg({quality:85}).toBuffer()).toString('base64')))
}

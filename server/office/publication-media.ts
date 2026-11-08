import express from 'express'
import type { OfficeServices } from './index.js'

/** Only time-limited, signed copies of the exact approved slide set are served here. */
export function publicationMediaRouter(services:Promise<OfficeServices>) {
  const router=express.Router()
  router.get('/:brand/:schedule/:asset.jpg',async(request,response)=>{
    response.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'})
    try{
      const {brand,schedule,asset}=request.params
      if(!/^[a-z0-9-]+$/.test(brand)||![schedule,asset].every(value=>/^[a-f0-9-]{36}$/i.test(value)))throw new Error('Invalid media path')
      const data=await (await services).publisher.media(brand,schedule,asset,String(request.query.expires??''),String(request.query.signature??''))
      response.type('image/jpeg').send(data)
    }catch{response.status(403).json({error:'Gambar tidak tersedia atau tautan sudah kedaluwarsa.'})}
  })
  return router
}

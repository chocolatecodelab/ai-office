import json,sys,shutil
from pathlib import Path
root,work=map(lambda x:Path(x).resolve(),sys.argv[1:3]);req=json.loads((work/'request.json').read_text(encoding='utf-8'));sys.path.insert(0,str(root/'pipeline/scripts'))
import thumbnail
from sistem import Proyek
source=Proyek(root/'proyek'/req['project']);target=root/'proyek'/req['target']
if target.exists():raise ValueError('Versi revisi sudah ada; tidak ditimpa.')
target.mkdir();(target/'cache').mkdir();shutil.copyfile(source.dir/'cache/sumber.json',target/'cache/sumber.json')
m=dict(source.manifest);m['proyek']=req['target'];m['status']='thumbnail-review';m.pop('persetujuan',None);cfg=dict(m.get('thumbnail',{}));patch=req['patch']
for key in ['headline','subheadline','frame_time','margin']:
 if key in patch:cfg[key]=patch[key]
if 'margin' in patch:cfg['headline']=' '.join(cfg.get('headline','').split())
m['thumbnail']=cfg;m['aset']=dict(m.get('aset',{}));m['aset']['rekaman']=str(source.path_aset(m['aset']['rekaman']))
if cfg.get('photo'):cfg['photo']=str(source.path_aset(cfg['photo']))
(target/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding='utf-8')
# Per-project template override, preserving native typography, limits, gradient and QA.
template=json.loads(thumbnail.TEMPLATE.read_text(encoding='utf-8'));brand=thumbnail.brand_for(source)
if 'margin' in cfg:template['brands'][brand]['margin']=cfg['margin']
config=work/'thumbnail-project-template.json';config.write_text(json.dumps(template),encoding='utf-8');thumbnail.TEMPLATE=config
thumbnail.generate(Proyek(target))
(target/'out/thumbnail-revision.json').write_text(json.dumps({'sourceProject':req['project'],'project':req['target'],'patch':patch,'scope':'thumbnail-only','videoRerendered':False,'templateOverride':str(config)},indent=2),encoding='utf-8')
print(req['target'])

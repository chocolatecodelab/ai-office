import sys,json
from pathlib import Path
root,project,work=map(Path,sys.argv[1:4]);sys.path.insert(0,str(root/'pipeline/scripts'))
import thumbnail
from sistem import Proyek
p=Proyek(project);cfg=p.manifest.get('thumbnail',{});template=json.loads(thumbnail.TEMPLATE.read_text(encoding='utf-8'))
if 'margin' in cfg:template['brands'][thumbnail.brand_for(p)]['margin']=cfg['margin']
path=work/'cover-template.json';path.write_text(json.dumps(template),encoding='utf-8');thumbnail.TEMPLATE=path;thumbnail.generate(p)

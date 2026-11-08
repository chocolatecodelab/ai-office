import sys, json, re
from pathlib import Path

root, project, work = map(Path, sys.argv[1:4])
sys.path.insert(0, str(root / 'pipeline/scripts'))

# 1. Normalize manifest.json before creating Proyek(project)
manifest_path = project / 'manifest.json'
m = json.loads(manifest_path.read_text(encoding='utf-8'))
if 'gaya' not in m:
    m['gaya'] = 'glass-tech@0.6'
if 'template' not in m:
    m['template'] = 'explainer@0.2'

# Ensure aset.rekaman points to footage from cache/sumber.json
if 'aset' not in m or not m['aset'].get('rekaman'):
    sumber_file = project / 'cache/sumber.json'
    if sumber_file.exists():
        sumber = json.loads(sumber_file.read_text(encoding='utf-8'))
        if sumber.get('utama', {}).get('path'):
            m['aset'] = {'rekaman': sumber['utama']['path']}

# Clean and shorten thumbnail headline if necessary to fit max 3 lines
cfg = m.get('thumbnail', {})
raw_headline = cfg.get('headline') or m.get('judul', 'VIDEO REVISI')
cleaned = re.sub(r'^(?:buat(?:kan)?|render|bikin(?:kan)?)\s+(?:rencana\s+)?video\s+(?:reels\s+)?', '', raw_headline, flags=re.I)
cleaned = re.sub(r'\s+untuk\s+(?:otca|info\s*jerman|ciao\s*manda|jepang\s*koey).*$', '', cleaned, flags=re.I).strip()
if not cleaned:
    cleaned = 'VIDEO REVISI'

words = cleaned.split()
if len(words) > 8:
    cleaned = ' '.join(words[:6])

cfg['headline'] = cleaned
if not cfg.get('frame_time'):
    cfg['frame_time'] = 1.0

m['thumbnail'] = cfg
manifest_path.write_text(json.dumps(m, indent=2), encoding='utf-8')

import thumbnail
from sistem import Proyek

p = Proyek(project)
template = json.loads(thumbnail.TEMPLATE.read_text(encoding='utf-8'))
if 'margin' in cfg:
    template['brands'][thumbnail.brand_for(p)]['margin'] = cfg['margin']

path = work / 'cover-template.json'
path.write_text(json.dumps(template), encoding='utf-8')
thumbnail.TEMPLATE = path

try:
    thumbnail.generate(p)
except Exception as e:
    if 'maksimum 3 baris' in str(e) or 'terlalu panjang' in str(e):
        words = cleaned.split()
        half = max(1, len(words) // 2)
        m['thumbnail']['headline'] = f"{' '.join(words[:half])}\n{' '.join(words[half:])}".strip()
        manifest_path.write_text(json.dumps(m, indent=2), encoding='utf-8')
        p = Proyek(project)
        thumbnail.generate(p)
    else:
        raise

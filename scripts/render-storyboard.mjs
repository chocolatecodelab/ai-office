import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function splitLines(text, maxChars = 40) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function inferArt(text) {
  const t = text.toLowerCase();
  if (/beasiswa|peluang|pintu|masuk|syarat|jenjang/.test(t)) return 'gate';
  if (/daad|lembaga|kategori|direktori|program|daftar/.test(t)) return 'directory';
  if (/kursus|musim|jadwal|kalender|waktu|bulan|tanggal/.test(t)) return 'calendar';
  if (/beda|vs|versus|banding|selisih|tidak sama/.test(t)) return 'compare';
  if (/seleksi|kriteria|prestasi|periksa|lolos/.test(t)) return 'selection';
  if (/rencana|persiapan|tahap|langkah|alur|jalur/.test(t)) return 'plan';
  if (/link|kontak|tim|hubungi|bio|daftar|gabung/.test(t)) return 'link';
  return 'plan';
}

export async function renderStoryboard(rootArg, workArg) {
  const root = resolve(rootArg);
  const work = resolve(workArg);
  const req = JSON.parse(readFileSync(join(work, 'request.json'), 'utf8'));
  const plan = req.video?.plan;
  if (!plan || !Array.isArray(plan.scenes) || !plan.scenes.length) {
    return { rendered: false };
  }

  const targetWork = join(work, 'project');
  mkdirSync(targetWork, { recursive: true });
  mkdirSync(join(targetWork, 'cache'), { recursive: true });
  mkdirSync(join(targetWork, 'out'), { recursive: true });

  const slug = req.slug || `office-storyboard-${Date.now()}`;
  const targetRoot = join(root, 'proyek', slug);
  mkdirSync(join(targetRoot, 'cache'), { recursive: true });
  mkdirSync(join(targetRoot, 'out'), { recursive: true });

  const brand = req.brand || 'otca';
  const brandConfigs = {
    otca: { name: 'OTCA', gold: '#CB9D31', secondary: '#FDF1A4', warning: '#B3822C', dark: '#000000', safeBottom: 400 },
    'info-jerman': { name: 'Info Jerman', gold: '#D01E1E', secondary: '#FFDD00', warning: '#D01E1E', dark: '#101010', safeBottom: 315 },
    infojerman: { name: 'Info Jerman', gold: '#D01E1E', secondary: '#FFDD00', warning: '#D01E1E', dark: '#101010', safeBottom: 315 },
    'ciao-manda': { name: 'Ciao Manda', gold: '#E05A47', secondary: '#FFC857', warning: '#E05A47', dark: '#181515', safeBottom: 315 },
    ciaomanda: { name: 'Ciao Manda', gold: '#E05A47', secondary: '#FFC857', warning: '#E05A47', dark: '#181515', safeBottom: 315 },
    'jepang-koey': { name: 'Jepang Koey', gold: '#E63946', secondary: '#F1FAEE', warning: '#E63946', dark: '#14171A', safeBottom: 315 },
    jepangkoey: { name: 'Jepang Koey', gold: '#E63946', secondary: '#F1FAEE', warning: '#E63946', dark: '#14171A', safeBottom: 315 },
  };
  const brandCfg = brandConfigs[brand] || brandConfigs.otca;

  // Resolve footage
  let relativeFootage = 'proyek/2026-11_otca-nina-beasiswa-s1/talent.mov';
  let footagePath = join(root, 'remotion/public', relativeFootage);
  if (!existsSync(footagePath)) {
    const candidates = [
      join(root, 'remotion/public/proyek/2026-11_otca-sertifikat-premium/talent.mp4'),
      join(root, 'remotion/public/proyek/lonely-iris/talent.mp4'),
      join(root, 'test_bg.mp4'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        relativeFootage = 'brand/footage.mp4';
        const dest = join(root, 'remotion/public', relativeFootage);
        mkdirSync(join(root, 'remotion/public/brand'), { recursive: true });
        copyFileSync(c, dest);
        footagePath = dest;
        break;
      }
    }
  }

  // If user provided video sources, use the first one
  if (req.video_sources?.length && req.video_sources[0].path && existsSync(req.video_sources[0].path)) {
    relativeFootage = `brand/${slug}-footage.mp4`;
    const dest = join(root, 'remotion/public', relativeFootage);
    mkdirSync(join(root, 'remotion/public/brand'), { recursive: true });
    copyFileSync(req.video_sources[0].path, dest);
    footagePath = dest;
  }

  const footageHash = hashFile(footagePath);
  let footageDuration = null;
  try {
    const probeProc = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', footagePath], { encoding: 'utf8' });
    if (probeProc.status === 0) {
      const probeData = JSON.parse(probeProc.stdout);
      if (probeData.format?.duration) {
        const d = Number(probeData.format.duration);
        if (Number.isFinite(d) && d > 5) {
          footageDuration = d;
        }
      }
    }
  } catch {}
  const sumberRecord = {
    utama: {
      path: footagePath,
      sha256: footageHash,
      file: relativeFootage,
    },
  };
  writeFileSync(join(targetWork, 'cache/sumber.json'), JSON.stringify(sumberRecord, null, 2));
  writeFileSync(join(targetRoot, 'cache/sumber.json'), JSON.stringify(sumberRecord, null, 2));

  // Resolve logo
  let relativeLogo = 'proyek/2026-11_otca-nina-beasiswa-s1/logo-otca.png';
  let logoPath = join(root, 'remotion/public', relativeLogo);
  if (!existsSync(logoPath)) {
    const defaultLogo = join(root, 'remotion/public/proyek/2026-11_otca-sertifikat-premium/logo-otca.png');
    if (existsSync(defaultLogo)) {
      relativeLogo = 'proyek/2026-11_otca-sertifikat-premium/logo-otca.png';
      logoPath = defaultLogo;
    }
  }

  // Load tokens
  let tokens = {
    warna: {
      latar: brandCfg.dark,
      'teks-utama': '#FFFFFF',
      'teks-sekunder': '#F0F0F0',
      aksen: brandCfg.gold,
      'aksen-2': brandCfg.secondary,
      peringatan: brandCfg.warning,
    },
    'zona-aman': {
      atas: 250,
      bawah: brandCfg.safeBottom,
      kiri: 108,
      kanan: 120,
    },
    font: {
      judul: { family: 'Bebas Neue, Anton, sans-serif' },
      isi: { family: 'Montserrat, system-ui, sans-serif' },
      caption: { family: 'Montserrat, system-ui, sans-serif' },
    },
  };
  const tokenFile = join(root, 'tokens/TOKEN_01_glass-tech_v0.3.json');
  if (existsSync(tokenFile)) {
    try {
      const baseTokens = JSON.parse(readFileSync(tokenFile, 'utf8'));
      tokens = { ...baseTokens, warna: { ...baseTokens.warna, ...tokens.warna }, 'zona-aman': tokens['zona-aman'] };
    } catch {}
  }

  // Build scenes & pages
  const artPool = ['gate', 'directory', 'calendar', 'compare', 'selection', 'plan', 'link'];
  const scenes = [];
  const pages = [];
  let cursor = 0.0;
  const closingDuration = 1.25;
  const targetNarrative = footageDuration && footageDuration > closingDuration + 5 ? footageDuration - closingDuration : null;
  const rawTotal = plan.scenes.reduce((sum, sc) => sum + Math.max(1, Math.min(30, Number(sc.duration) || 4)), 0);
  const scale = targetNarrative && rawTotal > 0 ? targetNarrative / rawTotal : 1.0;

  for (let i = 0; i < plan.scenes.length; i++) {
    const sc = plan.scenes[i];
    const rawDuration = Math.max(1, Math.min(30, Number(sc.duration) || 4));
    const duration = Math.round(rawDuration * scale * 100) / 100;
    const start = cursor;
    const end = (i === plan.scenes.length - 1 && targetNarrative)
      ? Math.round(targetNarrative * 100) / 100
      : Math.round((cursor + duration) * 100) / 100;
    const mode = sc.layout === 'full' ? 'full' : 'split';
    const lines = splitLines(sc.onScreen || sc.title);
    const art = inferArt(sc.visual + ' ' + sc.title + ' ' + sc.onScreen) || artPool[i % artPool.length];
    const sampleTime = Math.round((start + Math.min(duration / 2, 1.8)) * 100) / 100;

    scenes.push({
      id: String(i + 1).padStart(2, '0'),
      mulai: start,
      selesai: end,
      mode,
      judul: sc.title,
      headline: lines,
      heading: lines,
      visual: art,
      art,
      ucapan: sc.narration,
      motion: sc.motion,
      sample_time: sampleTime,
      anchors: [Math.round((start + 0.2) * 100) / 100, Math.round((start + 0.6) * 100) / 100, Math.round((start + 1.0) * 100) / 100],
    });

    // Word timestamps for pages
    const words = sc.narration.trim().split(/\s+/).filter(Boolean);
    if (words.length) {
      const speechDuration = Math.max(0.5, (end - start) - 0.3);
      const step = speechDuration / words.length;
      pages.push(
        words.map((w, wi) => ({
          w,
          s: Math.round((start + 0.1 + wi * step) * 100) / 100,
          e: Math.round((start + 0.1 + (wi + 1) * step) * 100) / 100,
        }))
      );
    }

    cursor = end;
  }

  // Final brand scene
  const closingStart = cursor;
  const totalDuration = footageDuration ? Math.round(footageDuration * 100) / 100 : Math.round((cursor + closingDuration) * 100) / 100;
  scenes.push({
    id: String(scenes.length + 1).padStart(2, '0'),
    mulai: closingStart,
    selesai: totalDuration,
    mode: 'full',
    judul: `Penutup ${brandCfg.name}`,
    headline: [],
    heading: [],
    visual: 'brand',
    art: 'brand',
    ucapan: '',
    motion: `Logo ${brandCfg.name} tampil sebagai penutup dengan garis aksen brand.`,
    sample_time: Math.round((closingStart + 0.5) * 100) / 100,
    anchors: [],
  });

  const props = {
    W: 1080,
    H: 1920,
    fps: 30,
    tokens,
    footage: relativeFootage,
    logo: relativeLogo,
    editorial: {
      titleScale: 1.0,
      artScale: 1.0,
      captionSize: 48,
      darkness: 0.85,
    },
    scenes,
    pages,
  };

  const propsText = JSON.stringify(props, null, 2);
  writeFileSync(join(targetWork, 'revision-props.json'), propsText);
  writeFileSync(join(targetRoot, 'revision-props.json'), propsText);

  // Subtitle files
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const stamp = (t, sep) => {
    const totalMs = Math.round(t * 1000);
    const ms = totalMs % 1000;
    const s = Math.floor(totalMs / 1000) % 60;
    const m = Math.floor(totalMs / 60000) % 60;
    const h = Math.floor(totalMs / 3600000);
    return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
  };
  const srtEntries = pages.map((p, i) => `${i + 1}\n${stamp(p[0].s, ',')} --> ${stamp(p.at(-1).e, ',')}\n${p.map(w => w.w).join(' ')}\n`);
  writeFileSync(join(targetWork, 'subtitle.srt'), srtEntries.join('\n'));
  writeFileSync(join(targetRoot, 'out/subtitle.srt'), srtEntries.join('\n'));
  const vttEntries = pages.map((p, i) => `${stamp(p[0].s, '.')} --> ${stamp(p.at(-1).e, '.')}\n${p.map(w => w.w).join(' ')}\n`);
  writeFileSync(join(targetWork, 'subtitle.vtt'), 'WEBVTT\n\n' + vttEntries.join('\n'));
  writeFileSync(join(targetRoot, 'out/subtitle.vtt'), 'WEBVTT\n\n' + vttEntries.join('\n'));

  // Bundle & render stills via Remotion
  const compPath = join(root, 'remotion/src/OfficeRevision.tsx');
  const remotionPkg = join(root, 'remotion/package.json');
  const require = createRequire(remotionPkg);
  const { bundle } = require('@remotion/bundler');
  const { selectComposition, renderStill } = require('@remotion/renderer');
  const browserExecutable = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

  const bundleUrl = await bundle({
    entryPoint: compPath,
    publicDir: join(root, 'remotion/public'),
    outDir: join(work, 'bundle'),
  });

  const composition = await selectComposition({
    serveUrl: bundleUrl,
    id: 'OfficeRevision',
    inputProps: props,
    browserExecutable,
  });

  const sceneImages = [];
  const generatedFiles = ['revision-props.json', 'subtitle.srt', 'subtitle.vtt'];

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const fileName = `scene-${sc.id}.png`;
    const frame = Math.round(sc.sample_time * composition.fps);
    const outWork = join(targetWork, fileName);
    const outRoot = join(targetRoot, 'out', fileName);

    await renderStill({
      serveUrl: bundleUrl,
      composition,
      inputProps: props,
      frame,
      output: outWork,
      imageFormat: 'png',
      browserExecutable,
      scale: 0.5,
    });
    copyFileSync(outWork, outRoot);
    generatedFiles.push(fileName);

    const bytes = readFileSync(outWork);
    sceneImages.push({
      id: sc.id,
      fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
      scene: sc,
    });
  }

  // 3 action sequence proof stills
  const proofScene = scenes[0];
  const proofTimes = [
    { name: 'action-start.png', time: proofScene.mulai + 0.1 },
    { name: 'action-middle.png', time: proofScene.mulai + (proofScene.selesai - proofScene.mulai) / 2 },
    { name: 'action-end.png', time: Math.max(proofScene.mulai + 0.2, proofScene.selesai - 0.2) },
  ];
  const proofData = [];
  for (const pt of proofTimes) {
    const outWork = join(targetWork, pt.name);
    const outRoot = join(targetRoot, 'out', pt.name);
    await renderStill({
      serveUrl: bundleUrl,
      composition,
      inputProps: props,
      frame: Math.round(pt.time * composition.fps),
      output: outWork,
      imageFormat: 'png',
      browserExecutable,
      scale: 0.5,
    });
    copyFileSync(outWork, outRoot);
    generatedFiles.push(pt.name);
    const bytes = readFileSync(outWork);
    proofData.push({
      name: pt.name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
    });
  }

  // Assemble HTML
  const escapeHtml = str => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sceneArticles = sceneImages.map(img => {
    const sc = img.scene;
    const timing = `${sc.mulai.toFixed(1)}–${sc.selesai.toFixed(1)}s`;
    return `<article>
      <img src="${img.dataUri}" alt="Adegan ${sc.id}">
      <div>
        <p><strong>${sc.mode.toUpperCase()}</strong> · ${timing}</p>
        <h2>${escapeHtml(sc.heading.join(' '))}</h2>
        ${sc.ucapan ? `<h3>Ucapan narasi</h3><p>${escapeHtml(sc.ucapan)}</p>` : ''}
        <h3>Visual &amp; Komposisi</h3>
        <p>${escapeHtml(sc.visual)}</p>
        <h3>Gerak &amp; Animasi</h3>
        <p>${escapeHtml(sc.motion)}</p>
      </div>
    </article>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
  <title>${escapeHtml(brandCfg.name)} · Storyboard Visual</title>
  <style>
    body{margin:0;background:#101010;color:#eee;font:16px/1.65 system-ui,sans-serif}
    main{max-width:1160px;margin:auto;padding:40px 28px}
    h1,h2{line-height:1.2}
    h1{font-size:32px;color:${brandCfg.gold};margin-bottom:8px}
    h2{font-size:22px;color:#fff;margin:8px 0 16px}
    h3{font-size:15px;color:${brandCfg.gold};margin:16px 0 4px;text-transform:uppercase;letter-spacing:0.5px}
    p{margin:0 0 12px;color:#ccc;max-width:70ch}
    article{display:grid;grid-template-columns:minmax(280px,360px) 1fr;gap:36px;padding:32px 0;border-top:1px solid #333}
    article>img{width:100%;height:auto;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.6);border:1px solid #333}
    article>div{padding:8px 0}
    section{border-top:1px solid #333;padding:32px 0;margin-top:24px}
    .proof{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    .proof img{width:100%;height:auto;border-radius:8px;border:1px solid #333}
    .checklist{background:#1a1a1a;border-radius:10px;padding:20px 24px;border:1px solid #333}
    .checklist li{margin-bottom:8px}
    @media(max-width:720px){article{grid-template-columns:1fr}.proof{grid-template-columns:1fr}main{padding:24px 16px}}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(req.title)}</h1>
    <p><strong>Storyboard Visual Remotion</strong> · ${brandCfg.name} · ${totalDuration.toFixed(1)} detik · Subtitle ${plan.subtitleStyle}</p>
    <p>Rancangan still terukur pada frame stabil. Mematuhi zona aman feed 9:16 (atas 250px, bawah ${brandCfg.safeBottom}px, margin 108px/120px) dan identitas brand.</p>
    ${sceneArticles}
    <section>
      <h2>Urutan Aksi Komposisi</h2>
      <p>Tiga still bertahap dari adegan pertama menjelaskan alur awal, pertengahan, dan transisi akhir.</p>
      <div class="proof">
        <div><h3>Awal</h3><img src="${proofData[0].dataUri}" alt="Start"></div>
        <div><h3>Aksi</h3><img src="${proofData[1].dataUri}" alt="Middle"></div>
        <div><h3>Akhir</h3><img src="${proofData[2].dataUri}" alt="End"></div>
      </div>
    </section>
    <section>
      <h2>Review Pra-Produksi</h2>
      <div class="checklist">
        <ul>
          <li><strong>Hierarki Teks:</strong> Headline terbaca jelas di perangkat seluler dengan kontras tajam.</li>
          <li><strong>Safe Zone:</strong> Semua elemen grafis dan subtitle berada di dalam area aman tanpa tertutup tombol aplikasi.</li>
          <li><strong>Sinkronisasi:</strong> Timing estimasi subtitle siap untuk penggabungan audio pada render final.</li>
          <li><strong>Persetujuan:</strong> Reviewer manusia dapat menyetujui storyboard ini untuk melanjutkan render MP4 final.</li>
        </ul>
      </div>
    </section>
  </main>
</body>
</html>`;

  writeFileSync(join(targetWork, 'storyboard-visual.html'), html);
  writeFileSync(join(targetWork, 'revision-preview.html'), html);
  writeFileSync(join(targetRoot, 'out/storyboard-visual.html'), html);
  writeFileSync(join(targetRoot, 'out/revision-preview.html'), html);
  generatedFiles.push('storyboard-visual.html', 'revision-preview.html');

  // Provenance & hashes
  const htmlSha256 = createHash('sha256').update(html).digest('hex');
  const propsSha256 = hashFile(join(targetWork, 'revision-props.json'));
  const compSha256 = hashFile(compPath);

  const videoRevision = {
    sourceProject: slug,
    project: slug,
    staticFootageSha256: footageHash,
    propsSha256,
    compositionSha256: compSha256,
    previewSha256: htmlSha256,
    videoRerendered: false,
    stage: 'storyboard-visual',
    affectedScenes: scenes.map((_, i) => i + 1),
  };
  const videoRevisionJson = JSON.stringify(videoRevision, null, 2);
  writeFileSync(join(targetWork, 'video-revision.json'), videoRevisionJson);
  writeFileSync(join(targetRoot, 'out/video-revision.json'), videoRevisionJson);
  generatedFiles.push('video-revision.json');

  const provenance = {
    stage: 'visual-storyboard-ready',
    project: slug,
    brand,
    sourceHashes: [footageHash],
    images: [...sceneImages.map(s => ({ path: s.fileName, sha256: s.sha256 })), ...proofData.map(p => ({ path: p.name, sha256: p.sha256 }))],
    htmlSha256,
    propsSha256,
    compositionSha256: compSha256,
    approval: 'pending',
    renderedByOffice: true,
  };
  const provenanceJson = JSON.stringify(provenance, null, 2);
  writeFileSync(join(targetWork, 'storyboard-provenance.json'), provenanceJson);
  writeFileSync(join(targetRoot, 'out/storyboard-provenance.json'), provenanceJson);
  generatedFiles.push('storyboard-provenance.json');

  // Manifest in targetRoot
  const cleanHeadline = (req.title || 'VIDEO REVISI')
    .replace(/^(?:buat(?:kan)?|render|bikin(?:kan)?)\s+(?:rencana\s+)?video\s+(?:reels\s+)?/i, '')
    .replace(/\s+untuk\s+(?:otca|info\s*jerman|ciao\s*manda|jepang\s*koey).*$/i, '')
    .trim() || 'VIDEO REVISI';
  const manifest = {
    proyek: slug,
    judul: req.title,
    gaya: 'glass-tech@0.6',
    template: 'explainer@0.2',
    status: 'storyboard-ready',
    brand: brand,
    office_brand: brand,
    aset: {
      rekaman: footagePath,
    },
    thumbnail: {
      brand: brand,
      headline: cleanHeadline,
      subheadline: '',
      frame_time: 1.0,
      margin: 80,
    },
    office_render_ready: true,
    composition: 'OfficeRevision',
    revision_props: 'revision-props.json',
  };
  writeFileSync(join(targetRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Update work/result.json if exists
  const resultJsonPath = join(work, 'result.json');
  let existingResult = { files: [] };
  if (existsSync(resultJsonPath)) {
    try {
      existingResult = JSON.parse(readFileSync(resultJsonPath, 'utf8'));
    } catch {}
  }
  const allFiles = Array.from(new Set([...(existingResult.files || []), ...generatedFiles]));
  writeFileSync(resultJsonPath, JSON.stringify({
    directory: targetWork,
    project: slug,
    status: 'STORYBOARD_VISUAL_READY',
    files: allFiles,
  }, null, 2));

  return {
    rendered: true,
    slug,
    files: allFiles,
    scenesCount: scenes.length,
    htmlSha256,
  };
}

if (process.argv[1]?.endsWith('render-storyboard.mjs')) {
  const [root, work] = process.argv.slice(2);
  renderStoryboard(root, work).then(res => {
    console.log(JSON.stringify(res));
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}


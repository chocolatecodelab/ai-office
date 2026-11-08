"""Prepare an isolated Office project using the existing pipeline's preset resolver.
No global INDEX updates, full render, setuju, archive, or external media imports.
"""
import json
import html
import hashlib
import shutil
import sys
from pathlib import Path

root, work = (Path(p).resolve() for p in sys.argv[1:3])
sys.path.insert(0, str(root / "pipeline" / "scripts"))
import video  # noqa: E402
from sistem import baca_json, frontmatter, gabung, resolve, tulis_json  # noqa: E402

request = json.loads((work / "request.json").read_text(encoding="utf-8"))
preset = resolve("preset", request["video"]["preset"])
data = video.preset_efektif(baca_json(preset.path), request["video"]["seed"])
style, template = resolve("gaya", data["gaya"]), resolve("template", data["template"])
target = work / "project"
shutil.copytree(root / "proyek" / "_template-proyek", target, dirs_exist_ok=True)
manifest = gabung(baca_json(target / "manifest.json"), data.get("manifest", {}))
fm, _ = frontmatter(style.path)
manifest.update(proyek=request["slug"], judul=request["title"], status="brief",
                gaya=style.ref, template=template.ref, preset=preset.ref,
                konteks=fm.get("konteks", []) + data.get("_konteks_tambahan", []),
                koreografi=data.get("_koreografi"), seed=data.get("_seed"),
                office_brand=request["brand"], office_context_version=request["contextVersion"])
manifest.pop("persetujuan", None)
sources = request.get("video_sources", [])
source_records = []
for index, source in enumerate(sources, 1):
    extension = Path(source["name"]).suffix.lower()
    if extension not in (".mp4", ".mov", ".webm"):
        raise ValueError("Format footage tidak didukung")
    relative = f"aset/rekaman/footage-{index:02}{extension}"
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source["path"], destination)
    digest = hashlib.sha256()
    with destination.open("rb") as footage:
        for block in iter(lambda: footage.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != source["sha256"]:
        raise ValueError("Isi footage berubah setelah dipilih. Unggah ulang bahan.")
    source_records.append({"attachment_id": source["id"], "name": source["name"], "file": relative, "sha256": source["sha256"]})
if source_records:
    manifest.setdefault("aset", {})["rekaman"] = source_records[0]["file"]
    tulis_json(target / "source-footage.json", source_records)
tulis_json(target / "manifest.json", manifest)
if data.get("beat_sheet"):
    tulis_json(target / "beat-sheet.json", data["beat_sheet"])
(target / "brief.md").write_text(request["brief"] + "\n", encoding="utf-8")
(target / "README-office.md").write_text(
    "# Draf proyek video\n\nBrief telah disimpan. Beat-sheet berasal dari preset dan masih memuat contoh; "
    "sesuaikan dengan naskah dan footage sebelum membuat storyboard. "
    "Belum ada persetujuan storyboard, render, transkripsi, atau QA video.\n", encoding="utf-8")
plan = request["video"].get("plan")
status = "DRAFT_PROJECT"
if plan:
    status = "NARRATIVE_PLAN"
    manifest["status"] = "rencana"
    manifest["office_render_ready"] = False
    manifest["office_materials"] = plan["materials"]
    tulis_json(target / "manifest.json", manifest)
    tulis_json(target / "production-plan.json", plan)
    script = [f"# {request['title']}", "", plan["objective"], "", f"Audiens: {plan['audience']}", ""]
    storyboard = [f"# Rencana adegan — {request['title']}", "", "Timing masih estimasi. Rencana ini belum memuat still dari renderer atau persetujuan storyboard visual.", "", f"Pilihan subtitle: {plan['subtitleStyle']}", ""]
    beats, subtitles, cards = [], [], []
    cursor = 0.0

    def stamp(seconds):
        milliseconds = round(seconds * 1000)
        hours, remainder = divmod(milliseconds, 3600000)
        minutes, remainder = divmod(remainder, 60000)
        seconds, milliseconds = divmod(remainder, 1000)
        return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"

    for index, scene in enumerate(plan["scenes"], 1):
        end = cursor + scene["duration"]
        timing = f"{cursor:.1f}–{end:.1f} detik"
        script += [f"## {index}. {scene['title']} · {timing}", "", scene["narration"], ""]
        storyboard += [f"## {index}. {scene['title']} · {timing}", "", f"Layout: {scene['layout']}", f"Teks layar: {scene['onScreen']}", "", f"Visual: {scene['visual']}", "", f"Gerak: {scene['motion']}", "", f"Audio: {scene['audio']}", "", f"Narasi: {scene['narration']}", ""]
        beats.append({"id": f"scene-{index:02}", "beat": scene["title"], "mulai": round(cursor, 3), "selesai": round(end, 3), "_ucapan": scene["narration"], "_office_draft": True, "_rencana_visual": scene["visual"], "_rencana_gerak": scene["motion"], "elemen": [{"tipe": "judul", "teks": scene["onScreen"], "posisi": "atas", "sfx": True}]})
        narration = " ".join(scene["narration"].split()).replace("-->", "→")
        subtitles.append(f"{index}\n{stamp(cursor)} --> {stamp(end)}\n{narration}\n")
        fields = [("Layout", scene["layout"]), ("Teks layar", scene["onScreen"]), ("Visual", scene["visual"]), ("Gerak", scene["motion"]), ("Audio", scene["audio"]), ("Narasi", scene["narration"])]
        content = "".join(f"<dt>{label}</dt><dd>{html.escape(value)}</dd>" for label, value in fields)
        cards.append(f"<article><p>{index:02} · {timing}</p><h2>{html.escape(scene['title'])}</h2><dl>{content}</dl></article>")
        cursor = end
    storyboard += ["## Bahan yang diperlukan", ""] + [f"- {item}" for item in plan["materials"]]
    storyboard += ["", "## Hal yang perlu dikonfirmasi", ""] + [f"- {item}" for item in plan["risks"]]
    tulis_json(target / "beat-sheet.json", {"_catatan": "Draf timing dan copy dari rencana adegan. Koreografi, footage, audio dan subtitle harus disesuaikan sebelum storyboard visual dan persetujuan native pipeline.", "caption": {"aktif": False, "posisi": "bawah", "kecuali": []}, "beats": beats})
    (target / "naskah.md").write_text("\n".join(script), encoding="utf-8")
    (target / "storyboard.md").write_text("\n".join(storyboard), encoding="utf-8")
    (target / "subtitle-draft.srt").write_text("\n".join(subtitles), encoding="utf-8")
    (target / "rencana-adegan.html").write_text("<!doctype html><html lang='id'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Rencana adegan</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 24px;color:#202020;background:#f7f7f5;line-height:1.65}article{background:white;border:1px solid #ddd;padding:24px;margin:20px 0;border-radius:12px}h1{font-size:26px}h2{font-size:20px}dt{font-weight:600;margin-top:12px}dd{margin-left:0;white-space:pre-wrap}p{color:#555}</style>" + f"<h1>{html.escape(request['title'])}</h1><p>Rencana adegan · {cursor:.1f} detik · timing estimasi · subtitle {plan['subtitleStyle']}</p><p>Still visual dan render penuh menunggu bahan serta review storyboard pipeline.</p>" + "".join(cards) + "</html>", encoding="utf-8")
    (target / "README-office.md").write_text("# Rencana produksi video\n\nNaskah, rencana adegan, kebutuhan aset, beat-sheet draf, dan subtitle estimasi sudah disusun dari brief.\n\nLengkapi bahan dan koreografi. Buat storyboard visual melalui pipeline, tinjau still serta pra-QA, lalu minta persetujuan pengguna atas hash beat-sheet sebelum render penuh. Persetujuan rencana di AI Office belum merupakan persetujuan storyboard native.\n", encoding="utf-8")

files = [p.name for p in target.iterdir() if p.is_file() and p.suffix in (".md", ".json", ".html", ".srt")]
(work / "result.json").write_text(json.dumps({"directory": str(target), "status": status, "files": files}), encoding="utf-8")

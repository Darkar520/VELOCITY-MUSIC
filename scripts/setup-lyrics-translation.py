"""Install official Argos EN/ES model packs into the local, ignored runtime.

Run with tools/lyrics-translation/Scripts/python.exe after installing
the pinned scripts/lyrics-translation-requirements.txt dependencies.
"""
import hashlib
import json
from pathlib import Path
import urllib.request
import urllib.error
import zipfile
import subprocess

root = Path(__file__).resolve().parents[1] / 'tools' / 'lyrics-translation' / 'models'
root.mkdir(parents=True, exist_ok=True)
index = json.load(urllib.request.urlopen('https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json', timeout=30))
manifest = []
for source, target, version, checksum in [('en', 'es', '1.0', 'd698d0ef87ad70d5d184b7fa6965905bf4368f09a2bb9ffb165a79bac96af0c4'), ('es', 'en', '1.9', 'c54df2b62fceaf54a3ce5d97db6bf56efd7940063329f6778f4212d2acb370d4')]:
    item = next(p for p in index if p['from_code'] == source and p['to_code'] == target and p['package_version'] == version)
    archive = root / f'{source}_{target}.argosmodel'
    if not archive.exists():
        try:
            urllib.request.urlretrieve(item['links'][0], archive)
        except urllib.error.HTTPError:
            # Argos' original R2 distribution, referenced in upstream issue 365.
            subprocess.run(['node', '--input-type=module', '-e', "import{createWriteStream}from'node:fs';import{Readable}from'node:stream';import{pipeline}from'node:stream/promises';const r=await fetch(process.argv[1]);if(!r.ok)throw Error(String(r.status));await pipeline(Readable.fromWeb(r.body),createWriteStream(process.argv[2]));", 'https://pub-dbae765fb25a4114aac1c88b90e94178.r2.dev/v1/' + item['links'][0].split('/')[-1], str(archive)], check=True, timeout=300)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != checksum:
        raise ValueError('Model checksum mismatch; archive was not extracted')
    with zipfile.ZipFile(archive) as pack:
        for entry in pack.infolist():
            destination = (root / entry.filename).resolve()
            if not destination.is_relative_to(root.resolve()):
                raise ValueError('Unsafe model archive path')
        pack.extractall(root)
    # This Marian-derived pack has no <s> in its vocabulary. Use its actual
    # decoder boundary token (</s>) with current CTranslate2 releases.
    if source == 'es':
        config_file = root / 'translate-es_en-1_9' / 'model' / 'config.json'
        config = json.loads(config_file.read_text(encoding='utf-8'))
        config['decoder_start_token'] = '</s>'
        config_file.write_text(json.dumps(config, indent=2), encoding='utf-8')
    manifest.append({'source': source, 'target': target, 'version': version, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'url': item['links'][0]})
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest))

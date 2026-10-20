"""Compare installed Argos line-wise and short-context translation on the fixed fixture."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / 'tools/lyrics-translation/Scripts/python.exe'
FIXTURE = json.loads((ROOT / 'test/fixtures/translation-naturalness.json').read_text(encoding='utf-8'))
baseline = {}
for source in ('en', 'es'):
    source_lines = [line for row in FIXTURE if row['source'] == source for line in [*row['lines'], '']]
    legacy = subprocess.run([str(PYTHON), str(ROOT / 'scripts/translate-lyrics.py')], input=json.dumps({'lines': source_lines}), capture_output=True, text=True, encoding='utf-8', check=True)
    baseline[source] = json.loads(legacy.stdout)['lines']

import ctranslate2
import sentencepiece
from langdetect import DetectorFactory, detect_langs
from lyrics_context import align_translation, phrase_groups, normalize_idioms
DetectorFactory.seed = 0
out = []
for source in ('en', 'es'):
    rows = [row for row in FIXTURE if row['source'] == source]
    lines = [line for row in rows for line in [*row['lines'], '']]
    model_root = ROOT / 'tools/lyrics-translation/models'
    package = next(p.parent for p in model_root.rglob('metadata.json') if (lambda m: m.get('from_code') == source and m.get('to_code') == ('es' if source == 'en' else 'en'))(json.loads(p.read_text(encoding='utf-8'))))
    metadata = json.loads((package / 'metadata.json').read_text(encoding='utf-8'))
    if (package / 'sentencepiece.model').exists():
        tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(package / 'sentencepiece.model'))
        encode = lambda text: tokenizer.encode(text, out_type=str)
        decode = lambda tokens: tokenizer.decode(tokens).replace('_', ' ')
    else:
        from sacremoses import MosesTokenizer, MosesDetokenizer, MosesPunctNormalizer
        from subword_nmt.apply_bpe import BPE
        tok, detok, norm = MosesTokenizer(source), MosesDetokenizer('en'), MosesPunctNormalizer(source)
        with (package / 'bpe.model').open(encoding='utf-8') as stream: bpe = BPE(stream)
        encode = lambda text: bpe.segment_tokens(tok.tokenize(norm.normalize(text)))
        decode = lambda tokens: detok.detokenize(' '.join(tokens).replace('@@ ', '').split())
    translator = ctranslate2.Translator(str(package / 'model'), device='cpu', compute_type='float32' if source == 'es' else 'int8', inter_threads=1, intra_threads=2)
    groups = phrase_groups(lines, encode, max_lines=3, max_tokens=96, transform_group=lambda text: normalize_idioms(text, source))
    context_inputs = [[token for _, row in group for token in row] for group in groups]
    owners = [[owner for owner, (_, row) in enumerate(group) for _ in row] for group in groups]
    prefix = metadata.get('target_prefix', '')
    grouped_results = translator.translate_batch(context_inputs, target_prefix=[[prefix]] * len(context_inputs) if prefix else None, beam_size=4, replace_unknowns=True, max_batch_size=256, batch_type='tokens', length_penalty=.2, max_decoding_length=256, return_attention=True)
    # Report phrase translations without inventing per-line boundaries. Alignment is evaluated separately.
    aligned_groups = []
    failures = 0
    for group, owner, result in zip(groups, owners, grouped_results):
        try:
            aligned = align_translation(result.hypotheses[0], result.attention, owner, len(group), decode)
        except (ValueError, KeyError, TypeError):
            aligned = []
            failures += 1
        aligned_groups.append({'source':[lines[index] for index,_ in group], 'translation':decode(result.hypotheses[0]).strip(), 'aligned':aligned})
    out.append({'source':source,'model':'argos-'+source+'-'+('es' if source=='en' else 'en')+'-'+metadata.get('package_version',''),'alignmentFailures':failures,'groups':aligned_groups})
print(json.dumps({'linewise':baseline,'context':out},ensure_ascii=False))

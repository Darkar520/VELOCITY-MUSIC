"""JSON stdin/stdout boundary. Local CPU inference; never logs lyric text."""
import json
from pathlib import Path
import sys
import re
import ctranslate2
import sentencepiece
from langdetect import detect_langs, DetectorFactory
from lyrics_context import phrase_groups, align_translation, normalize_idioms

DetectorFactory.seed = 0
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
payload = json.load(sys.stdin)
lines = payload['lines']
sample = '\n'.join(dict.fromkeys(line for line in lines if line.strip()))
languages = detect_langs(sample)
detected = languages[0]
if detected.lang not in ('en', 'es') or detected.prob < .8:
    print(json.dumps({'status': 'unsupported', 'sourceLanguage': detected.lang}))
    sys.exit(0)
source = detected.lang
target = 'es' if source == 'en' else 'en'
root = Path(__file__).resolve().parents[1] / 'tools' / 'lyrics-translation' / 'models'
package = next(p.parent for p in root.rglob('metadata.json') if (lambda m: m.get('from_code') == source and m.get('to_code') == target)(json.loads(p.read_text(encoding='utf-8'))))
metadata = json.loads((package / 'metadata.json').read_text(encoding='utf-8'))
if (package / 'sentencepiece.model').exists():
    tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(package / 'sentencepiece.model'))
    encode = lambda line: tokenizer.encode(line, out_type=str)
    decode = lambda tokens: tokenizer.decode(tokens).replace('▁', ' ').replace('_', ' ')
else:
    from sacremoses import MosesTokenizer, MosesDetokenizer, MosesPunctNormalizer
    from subword_nmt.apply_bpe import BPE
    tokenizer, detokenizer, normalizer = MosesTokenizer(source), MosesDetokenizer(target), MosesPunctNormalizer(source)
    with (package / 'bpe.model').open(encoding='utf-8') as codes:
        bpe = BPE(codes)
    encode = lambda line: bpe.segment_tokens(tokenizer.tokenize(normalizer.normalize(line)))
    decode = lambda tokens: detokenizer.detokenize(' '.join(tokens).replace('@@ ', '').split(' '))
# The OPUS ES->EN pack produces degenerate output when dynamically quantized
# to int8 on this CPU. Keep its native float32 weights; EN->ES is int8-tested.
translator = ctranslate2.Translator(str(package / 'model'), device='cpu', compute_type='float32' if source == 'es' else 'int8', inter_threads=1, intra_threads=2)
groups = phrase_groups(lines, encode, max_lines=3, max_tokens=96, transform_group=lambda text: normalize_idioms(text, source))
prefix = metadata.get('target_prefix', '')
inputs = [[token for _, row in group for token in row] for group in groups]
owners = [[owner for owner, (_, row) in enumerate(group) for _ in row] for group in groups]
results = translator.translate_batch(inputs, target_prefix=[[prefix]] * len(inputs) if prefix else None, beam_size=4, replace_unknowns=True, max_batch_size=256, batch_type='tokens', length_penalty=.2, max_decoding_length=256, return_attention=True)
translations = [''] * len(lines)
for group, owner, result in zip(groups, owners, results):
    text = decode(result.hypotheses[0])
    if len(result.hypotheses[0]) >= 256 or re.search(r'(.{4,24})\1{6,}', text):
        raise ValueError('Degenerate or truncated model output')
    if prefix and text.startswith(prefix):
        text = text[len(prefix):]
    aligned = align_translation(result.hypotheses[0], result.attention, owner, len(group), decode)
    for (line_index, _), translated in zip(group, aligned):
        translations[line_index] = translated
print(json.dumps({'status': 'ready', 'sourceLanguage': source, 'targetLanguage': target, 'model': 'argos-' + source + '-' + target + '-' + metadata.get('package_version', ''), 'engineVersion': 'argos-context-v3', 'lines': translations}, ensure_ascii=False))

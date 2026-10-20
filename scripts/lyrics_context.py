"""Phrase-aware preprocessing and monotonic alignment for timed lyric rows."""
import math
import re
import unicodedata

VERSION = 'context-v2'

IDIOM_EQUIVALENTS = {
    'en': (
        (re.compile(r'\b(?:try )?put(?:ting)? yourself in my shoes\b', re.I), 'try to understand my situation'),
        (re.compile(r'\bbrushing me off\b', re.I), 'ignoring me'),
        (re.compile(r'\bget this off my chest\b', re.I), 'talk about how I feel'),
        (re.compile(r"\b(?:i'm done|i am done) walking on eggshells around you\b", re.I), 'i will not keep trying to avoid upsetting you'),
    ),
    'es': (
        (re.compile(r'\bpasar página\b', re.I), 'seguir adelante'),
        (re.compile(r'\bse me hizo un nudo en la garganta\b', re.I), 'no podía hablar por la emoción'),
        (re.compile(r'\bno sabes la falta que me haces\b', re.I), 'no sabes cuánto te extraño'),
        (re.compile(r'\bme da pena que esto termine así\b', re.I), 'me siento triste porque esto termine así'),
    ),
}

def normalize_idioms(text, source):
    for pattern, replacement in IDIOM_EQUIVALENTS.get(source, ()):
        text = pattern.sub(replacement, text)
    return text

def normalize_text(text):
    return unicodedata.normalize('NFKC', text).replace('’', "'").replace('‘', "'").strip()

def phrase_groups(lines, encode, max_lines=3, max_tokens=96):
    groups, current, size = [], [], 0
    for index, raw in enumerate(lines):
        line = normalize_text(raw)
        if not line:
            if current:
                groups.append(current)
                current, size = [], 0
            continue
        tokens = encode(line)
        if current and (len(current) >= max_lines or size + len(tokens) > max_tokens):
            groups.append(current)
            current, size = [], 0
        current.append((index, tokens))
        size += len(tokens)
        if re.search(r'[.!?…]["\')]*$', line):
            groups.append(current)
            current, size = [], 0
    if current:
        groups.append(current)
    return groups

def align_translation(tokens, attention, owners, line_count, decode):
    # CTranslate2 4.8 returns hypothesis/target/source attention.
    while len(attention) == 1 and attention[0] and isinstance(attention[0][0], (list, tuple)):
        attention = attention[0]
    if line_count == 1:
        return [decode(tokens).strip()]
    # Break only at target word boundaries: never bisect a SentencePiece word.
    words = []
    for index, token in enumerate(tokens):
        # Support both SentencePiece (▁ starts a word) and subword-nmt BPE
        # (@@ marks a continuation of the current word).
        starts_word = token.startswith('▁') or (index > 0 and not tokens[index - 1].endswith('@@'))
        if not words or starts_word:
            words.append([])
        words[-1].append(index)
    if len(words) < line_count or len(attention) < len(tokens):
        raise ValueError('Insufficient target alignment')
    scores = []
    for word in words:
        row = []
        for line in range(line_count):
            value = sum(float(attention[t][s]) for t in word for s, owner in enumerate(owners) if owner == line and s < len(attention[t]))
            row.append(value / len(word))
        scores.append(row)
    # Maximize attention captured by contiguous, nonempty translated rows.
    count = len(words)
    dp = [[-math.inf] * (count + 1) for _ in range(line_count + 1)]
    previous = {}
    dp[0][0] = 0
    for line in range(line_count):
        prefix = [0]
        for row in scores:
            prefix.append(prefix[-1] + row[line])
        for end in range(line + 1, count - (line_count - line - 1) + 1):
            for start in range(line, end):
                candidate = dp[line][start] + prefix[end] - prefix[start]
                if candidate > dp[line + 1][end]:
                    dp[line + 1][end] = candidate
                    previous[(line + 1, end)] = start
    output, end = [], count
    for line in range(line_count, 0, -1):
        start = previous[(line, end)]
        selected = [tokens[index] for word in words[start:end] for index in word]
        output.append(decode(selected).strip())
        end = start
    return list(reversed(output))

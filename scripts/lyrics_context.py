"""Phrase-aware preprocessing and monotonic alignment for timed lyric rows."""
import math
import re
import unicodedata

VERSION = 'context-v3'

IDIOM_EQUIVALENTS = {
    'en': (
        (re.compile(r'\b(?:try )?put(?:ting)? yourself in my shoes\b', re.I), 'try to understand how I feel'),
        (re.compile(r'\bbrushing me off\b', re.I), 'not taking me seriously'),
        (re.compile(r'\bget this off my chest\b', re.I), 'tell you something that has been weighing on me'),
        (re.compile(r"\b(?:i'm done|i am done) walking on eggshells around you\b", re.I), 'i cannot keep trying to avoid upsetting you'),
    ),
    'es': (
        (re.compile(r'\bpasar página\b', re.I), 'seguir adelante'),
        (re.compile(r'\bse me hizo un nudo en la garganta\b', re.I), 'sentí un nudo en la garganta'),
        (re.compile(r'\bno sabes la falta que me haces\b', re.I), 'no sabes cuánto te extraño'),
        (re.compile(r'\bme da pena que esto termine así\b', re.I), 'me entristece que esto tenga que terminar así'),
    ),
}

def normalize_idioms(text, source):
    for pattern, replacement in IDIOM_EQUIVALENTS.get(source, ()):
        def preserve_sentence_case(match):
            before = text[:match.start()]
            at_sentence_start = not before.strip() or re.search(r'[.!?…]["\')]*\s*$', before)
            if at_sentence_start and match.group(0)[:1].isupper():
                return replacement[:1].upper() + replacement[1:]
            return replacement
        text = pattern.sub(preserve_sentence_case, text)
    return text

def normalize_text(text):
    return unicodedata.normalize('NFKC', text).replace('’', "'").replace('‘', "'").strip()

def _token_words(tokens):
    words = []
    for index, token in enumerate(tokens):
        starts_word = token.startswith('▁') or (index > 0 and not tokens[index - 1].endswith('@@'))
        if not words or starts_word:
            words.append([])
        words[-1].append(index)
    return words

def phrase_groups(lines, encode, max_lines=3, max_tokens=96, transform_group=None):
    groups, current, size = [], [], 0

    def finish(group):
        if not group or not transform_group:
            return group
        original = ' '.join(normalize_text(lines[index]) for index, _ in group)
        transformed = transform_group(original)
        if transformed == original:
            return group
        tokens = encode(transformed)
        words = _token_words(tokens)
        if len(words) < len(group) or len(tokens) > max_tokens:
            return group
        weights = [max(1, len(row)) for _, row in group]
        total_weight = sum(weights)
        output, start, cumulative = [], 0, 0
        for row_index, (line_index, _) in enumerate(group):
            cumulative += weights[row_index]
            if row_index == len(group) - 1:
                end = len(words)
            else:
                ideal = round(len(words) * cumulative / total_weight)
                end = max(start + 1, min(ideal, len(words) - (len(group) - row_index - 1)))
            output.append((line_index, [tokens[index] for word in words[start:end] for index in word]))
            start = end
        return output

    for index, raw in enumerate(lines):
        line = normalize_text(raw)
        if not line:
            if current:
                groups.append(finish(current))
                current, size = [], 0
            continue
        tokens = encode(line)
        if current and (len(current) >= max_lines or size + len(tokens) > max_tokens):
            groups.append(finish(current))
            current, size = [], 0
        current.append((index, tokens))
        size += len(tokens)
        if re.search(r'[.!?…]["\')]*$', line):
            groups.append(finish(current))
            current, size = [], 0
    if current:
        groups.append(finish(current))
    return groups

def align_translation(tokens, attention, owners, line_count, decode):
    # CTranslate2 4.8 returns hypothesis/target/source attention.
    while len(attention) == 1 and attention[0] and isinstance(attention[0][0], (list, tuple)):
        attention = attention[0]
    if line_count == 1:
        return [decode(tokens).strip()]
    # Break only at target word boundaries: never bisect a SentencePiece word.
    words = _token_words(tokens)
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

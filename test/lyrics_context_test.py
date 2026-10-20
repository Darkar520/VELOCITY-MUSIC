import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from lyrics_context import phrase_groups, align_translation, normalize_text

class ContextTests(unittest.TestCase):
    def test_phrases_join_continuations_but_respect_stanzas_and_punctuation(self):
        groups = phrase_groups(['I almost gave up', 'when you arrived.', '', 'Another thought', 'continues here'], lambda s: s.split())
        self.assertEqual([[i for i, _ in group] for group in groups], [[0, 1], [3, 4]])

    def test_context_is_bounded(self):
        groups = phrase_groups(['one'] * 10, lambda s: s.split(), max_lines=3)
        self.assertEqual([len(group) for group in groups], [3, 3, 3, 1])
        self.assertEqual(normalize_text('  I’m here  '), "I'm here")

    def test_attention_alignment_keeps_every_word_once_and_does_not_split_words(self):
        tokens = ['▁Me', '▁cuesta', '▁seguir', '▁adel', 'ante', '▁sin', '▁ti', '.']
        attention = [[.9, .1]] * 5 + [[.1, .9]] * 3
        decode = lambda xs: ''.join(xs).replace('▁', ' ').strip()
        result = align_translation(tokens, attention, [0, 1], 2, decode)
        self.assertEqual(result, ['Me cuesta seguir adelante', 'sin ti.'])
        self.assertEqual(' '.join(result), decode(tokens))
        self.assertEqual(align_translation(tokens, [attention], [0, 1], 2, decode), result)

    def test_alignment_rejects_too_few_words_instead_of_inventing_a_row(self):
        with self.assertRaises(ValueError):
            align_translation(['▁Yes'], [[1]], [0], 2, lambda xs: ''.join(xs))

if __name__ == '__main__':
    unittest.main()

import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from lyrics_context import phrase_groups, align_translation, normalize_text, normalize_idioms, argos_decoding_parameters

class ContextTests(unittest.TestCase):
    def test_phrases_join_continuations_but_respect_stanzas_and_punctuation(self):
        groups = phrase_groups(['I almost gave up', 'when you arrived.', '', 'Another thought', 'continues here'], lambda s: s.split())
        self.assertEqual([[i for i, _ in group] for group in groups], [[0, 1], [3, 4]])

    def test_context_is_bounded(self):
        groups = phrase_groups(['one'] * 10, lambda s: s.split(), max_lines=3)
        self.assertEqual([len(group) for group in groups], [3, 3, 3, 1])
        self.assertEqual(normalize_text('  I’m here  '), "I'm here")

    def test_argos_decoding_parameters_are_direction_specific(self):
        self.assertEqual(argos_decoding_parameters('en'), {'beam_size': 4, 'length_penalty': .2})
        self.assertEqual(argos_decoding_parameters('es'), {'beam_size': 4, 'length_penalty': .6})
        with self.assertRaises(ValueError):
            argos_decoding_parameters('fr')

    def test_common_english_and_spanish_idioms_use_meaning_preserving_equivalents(self):
        self.assertEqual(
            normalize_idioms('Now I finally understand what you were trying to tell me.', 'en'),
            'At last I understand what you meant.',
        )
        self.assertEqual(normalize_idioms('Try putting yourself in my shoes.', 'en'), 'Try to understand how I feel.')
        self.assertEqual(normalize_idioms('You keep brushing me off.', 'en'), 'You keep not taking me seriously.')
        self.assertEqual(normalize_idioms('I need to get this off my chest.', 'en'), 'I need to tell you something that has been weighing on me.')
        self.assertEqual(normalize_idioms("I'm done walking on eggshells around you.", 'en'), 'I cannot keep trying to avoid upsetting you.')
        self.assertEqual(normalize_idioms('No sabes la falta que me haces.', 'es'), 'No sabes cuánto te extraño.')
        self.assertEqual(normalize_idioms('Se me hizo un nudo en la garganta.', 'es'), 'Sentí un nudo en la garganta.')
        self.assertEqual(normalize_idioms('Me da pena que esto termine así.', 'es'), 'Me entristece que esto tenga que terminar así.')

    def test_idiom_equivalence_is_applied_across_timed_rows_without_losing_alignment_tokens(self):
        groups = phrase_groups(
            ['You keep brushing', 'me off.'],
            lambda text: text.split(),
            transform_group=lambda text: normalize_idioms(text, 'en'),
        )
        self.assertEqual([index for index, _ in groups[0]], [0, 1])
        self.assertEqual([token for _, row in groups[0] for token in row], 'You keep not taking me seriously.'.split())
        self.assertTrue(all(row for _, row in groups[0]))

        chest = phrase_groups(
            ['I need to get', 'this off my chest.'],
            lambda text: text.split(),
            transform_group=lambda text: normalize_idioms(text, 'en'),
        )
        self.assertEqual([token for _, row in chest[0] for token in row], 'I need to tell you something that has been weighing on me.'.split())

        continuation = phrase_groups(
            ['Now I finally understand', 'what you were trying to tell me.'],
            lambda text: text.split(),
            transform_group=lambda text: normalize_idioms(text, 'en'),
        )
        self.assertEqual([token for _, row in continuation[0] for token in row], 'At last I understand what you meant.'.split())

    def test_idiom_equivalences_do_not_cross_blank_stanza_boundaries(self):
        groups = phrase_groups(
            ['You keep brushing', '', 'me off.'],
            lambda text: text.split(),
            transform_group=lambda text: normalize_idioms(text, 'en'),
        )
        self.assertEqual([token for _, row in groups[0] for token in row], ['You', 'keep', 'brushing'])
        self.assertEqual([token for _, row in groups[1] for token in row], ['me', 'off.'])

    def test_attention_alignment_keeps_every_word_once_and_does_not_split_words(self):
        tokens = ['▁Me', '▁cuesta', '▁seguir', '▁adel', 'ante', '▁sin', '▁ti', '.']
        attention = [[.9, .1]] * 5 + [[.1, .9]] * 3
        decode = lambda xs: ''.join(xs).replace('▁', ' ').strip()
        result = align_translation(tokens, attention, [0, 1], 2, decode)
        self.assertEqual(result, ['Me cuesta seguir adelante', 'sin ti.'])
        self.assertEqual(' '.join(result), decode(tokens))
        self.assertEqual(align_translation(tokens, [attention], [0, 1], 2, decode), result)

    def test_attention_alignment_keeps_common_connective_units_together(self):
        tokens = ['▁Por', '▁fin', '▁entiendo', '▁lo', '▁que', '▁querías', '▁decir']
        # Attention alone prefers a cut after "fin", which strands the adverbial.
        attention = [[.9, .1], [.9, .1], [.1, .9], [.1, .9], [.1, .9], [.1, .9], [.1, .9]]
        decode = lambda xs: ''.join(xs).replace('▁', ' ').strip()
        self.assertEqual(
            align_translation(tokens, attention, [0, 1], 2, decode, 'es'),
            ['Por fin entiendo', 'lo que querías decir'],
        )

    def test_connective_constraint_falls_back_when_it_cannot_fill_all_rows(self):
        tokens = ['▁por', '▁fin']
        attention = [[.9, .1], [.1, .9]]
        decode = lambda xs: ''.join(xs).replace('▁', ' ').strip()
        self.assertEqual(
            align_translation(tokens, attention, [0, 1], 2, decode, 'es'),
            ['por', 'fin'],
        )

    def test_alignment_rejects_too_few_words_instead_of_inventing_a_row(self):
        with self.assertRaises(ValueError):
            align_translation(['▁Yes'], [[1]], [0], 2, lambda xs: ''.join(xs))

if __name__ == '__main__':
    unittest.main()

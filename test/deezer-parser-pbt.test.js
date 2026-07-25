import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import DeezerParser from '../src/extractors/deezerParser.js';

const RUNS = { numRuns: 100 };
const parser = () => new DeezerParser();
const textArb = fc.string({ minLength: 1, maxLength: 40 });
const idArb = fc.oneof(
  fc.integer({ min: 1, max: 1_000_000 }),
  fc.string({ minLength: 1, maxLength: 20 }),
);
const durationSecondsArb = fc.oneof(
  fc.integer({ min: 0, max: 3_600 }),
  fc.double({ min: 0, max: 3_600, noNaN: true, noDefaultInfinity: true }),
);

const nestedTrackArb = fc.record({
  id: idArb,
  title: textArb,
  artist: fc.record({ id: idArb, name: textArb }),
  album: fc.record({
    id: idArb,
    title: textArb,
    cover_xl: fc.option(textArb, { nil: undefined }),
  }),
  duration: durationSecondsArb,
  cover_xl: fc.option(textArb, { nil: undefined }),
  stream_url: fc.option(textArb, { nil: undefined }),
  release_date: fc.option(textArb, { nil: undefined }),
  genre: fc.option(fc.record({ name: textArb }), { nil: undefined }),
});

// **Validates: Requirements 1.11**
test('Property 1: parser round-trip conserva metadata normalizada', () => {
  fc.assert(
    fc.property(nestedTrackArb, (rawTrack) => {
      const firstParse = parser().parseSearchResponse({ data: [rawTrack] });
      assert.equal(firstParse.length, 1);

      const serialized = parser().serializeTrackMetadata(firstParse[0]);
      const reparsed = parser().parseSearchResponse(JSON.parse(serialized));

      assert.deepEqual(reparsed, firstParse);
    }),
    RUNS,
  );
});

const QUALITY_EXPECTATIONS = {
  MP3_128: 'MP3_128',
  'MP3-128': 'MP3_128',
  MP3128: 'MP3_128',
  'mp3 128': 'MP3_128',
  128: 'MP3_128',
  MP3: 'MP3_128',
  MP3_LOW: 'MP3_128',
  MP3_320: 'MP3_320',
  'MP3-320': 'MP3_320',
  MP3320: 'MP3_320',
  'mp3 320': 'MP3_320',
  320: 'MP3_320',
  MP3_HIGH: 'MP3_320',
  MP3_HQ: 'MP3_320',
  FLAC: 'FLAC',
  FLAC_1411: 'FLAC',
  'FLAC-1411': 'FLAC',
  LOSSLESS: 'FLAC',
};
const qualityAliasArb = fc.constantFrom(...Object.keys(QUALITY_EXPECTATIONS));
const qualityInputArb = fc.tuple(
  qualityAliasArb,
  fc.constantFrom('raw', 'format', 'quality', 'code'),
);

// **Validates: Requirements 1.11**
test('Property 2: mapping de calidad devuelve el formato Velocity canónico', () => {
  fc.assert(
    fc.property(qualityInputArb, ([alias, wrapper]) => {
      const expected = QUALITY_EXPECTATIONS[alias];
      const input = wrapper === 'raw' ? alias : { [wrapper]: alias };
      const deezerFormat = parser().normalizeQualityFormat(input);

      assert.equal(deezerFormat, expected);
      assert.equal(parser().toDeezerFormat(expected), expected);
    }),
    RUNS,
  );
});

const semanticTrackArb = fc.record({
  id: idArb,
  title: textArb,
  artistId: idArb,
  artistName: textArb,
  albumId: idArb,
  albumName: textArb,
  durationSeconds: durationSecondsArb,
  artworkUrl: textArb,
  streamUrl: textArb,
  releaseDate: textArb,
  genreName: textArb,
});

// **Validates: Requirements 1.11**
test('Property 3: estructuras Deezer anidadas y aplanadas comparten campos', () => {
  fc.assert(
    fc.property(semanticTrackArb, (values) => {
      const nested = {
        id: values.id,
        title: values.title,
        artist: { id: values.artistId, name: values.artistName },
        album: {
          id: values.albumId,
          title: values.albumName,
          cover_xl: values.artworkUrl,
        },
        duration: values.durationSeconds,
        cover_xl: values.artworkUrl,
        stream_url: values.streamUrl,
        release_date: values.releaseDate,
        genre: { name: values.genreName },
      };
      const flattened = {
        trackId: values.id,
        name: values.title,
        artistId: values.artistId,
        artistName: values.artistName,
        albumId: values.albumId,
        albumName: values.albumName,
        durationSeconds: values.durationSeconds,
        artworkUrl: values.artworkUrl,
        streamUrl: values.streamUrl,
        releaseDate: values.releaseDate,
        genreName: values.genreName,
      };

      const nestedMetadata = parser().parseTrackResponse({ data: nested });
      const flattenedMetadata = parser().parseTrackResponse(flattened);
      const searchMetadata = parser().parseSearchResponse({ tracks: { data: [nested] } });

      assert.deepEqual(nestedMetadata, flattenedMetadata);
      assert.deepEqual(searchMetadata, [nestedMetadata]);
    }),
    RUNS,
  );
});

const malformedInputArb = fc.oneof(
  fc.jsonValue(),
  fc.constantFrom(
    '',
    '{',
    '[',
    '{"data":',
    '{"tracks":{"data":',
    'not valid JSON',
    'null trailing text',
  ),
);

// **Validates: Requirements 1.11**
test('Property 4: entradas JSON malformadas no provocan crash', () => {
  fc.assert(
    fc.property(malformedInputArb, (input) => {
      assert.doesNotThrow(() => {
        const searchResult = parser().parseSearchResponse(input);
        const trackResult = parser().parseTrackResponse(input);

        assert.ok(Array.isArray(searchResult));
        assert.ok(trackResult === null || typeof trackResult === 'object');
      });
    }),
    RUNS,
  );
});

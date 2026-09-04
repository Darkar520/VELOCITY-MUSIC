import { describe, expect, it } from 'vitest';

import { buildTrackShareUrl } from '../useCatalogNavigation.js';

describe('buildTrackShareUrl', () => {
  it('usa el origen de la aplicación y codifica el ID de la pista', () => {
    expect(buildTrackShareUrl('jSNvyzsNEaQ', 'https://velocitymusic.uk'))
      .toBe('https://velocitymusic.uk/track/jSNvyzsNEaQ');
    expect(buildTrackShareUrl('id/con-caracteres', 'https://preview.pages.dev'))
      .toBe('https://preview.pages.dev/track/id%2Fcon-caracteres');
  });

  it('rechaza IDs vacíos sin construir un enlace inválido', () => {
    expect(buildTrackShareUrl('', 'https://velocitymusic.uk')).toBe('');
    expect(buildTrackShareUrl(null, 'https://velocitymusic.uk')).toBe('');
  });
});

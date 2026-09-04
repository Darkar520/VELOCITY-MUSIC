import { describe, expect, it } from 'vitest';

import { parseSharedRoute } from '../useSharedRoute.js';

describe('parseSharedRoute', () => {
  it('reconoce enlaces de canción y álbum', () => {
    expect(parseSharedRoute('/track/jSNvyzsNEaQ')).toEqual({ type: 'track', id: 'jSNvyzsNEaQ' });
    expect(parseSharedRoute('/album/MPREb_album123')).toEqual({ type: 'album', id: 'MPREb_album123' });
  });

  it('decodifica IDs y rechaza rutas que no son contenido compartido', () => {
    expect(parseSharedRoute('/track/id%2Fcon-caracteres')).toEqual({ type: 'track', id: 'id/con-caracteres' });
    expect(parseSharedRoute('/')).toBeNull();
    expect(parseSharedRoute('/search/foo')).toBeNull();
    expect(parseSharedRoute('/track/')).toBeNull();
  });
});

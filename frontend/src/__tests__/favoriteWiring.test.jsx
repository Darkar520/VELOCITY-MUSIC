import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
const appSource = source('App.jsx');
const surfaces = {
  HomeTab: 'tabs/HomeTab.jsx',
  SearchTab: 'tabs/SearchTab.jsx',
  LibraryTab: 'tabs/LibraryTab.jsx',
  DetailView: 'tabs/DetailView.jsx',
  TrackMenu: 'modals/TrackMenu.jsx',
};

describe('durable favorite wiring', () => {
  it('passes the durable callback to every UI surface', () => {
    for (const component of Object.keys(surfaces)) {
      const renderLine = appSource.split('\n').find((line) => line.includes(`<${component}`));
      expect(renderLine, `${component} render`).toContain(`onToggleFav={toggleFav}`);
    }
  });

  it('does not bypass useLibraryActions from UI surfaces', () => {
    for (const file of Object.values(surfaces)) {
      const componentSource = source(file);
      expect(componentSource).not.toContain('toggleFavInStore');
      expect(componentSource).toContain('onToggleFav');
      expect(componentSource).toContain('const toggleFav = onToggleFav');
    }
  });
});

import React from 'react';
import {cleanup,fireEvent,render,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';

vi.mock('../components.jsx',()=>({CoverImg:({src})=><img alt="portrait" src={src}/> }));
vi.mock('../feed/artistPortraits.js',()=>({
  getCachedPortrait:vi.fn(()=>null),
  requestArtistPortrait:vi.fn(),
}));

import {ArtistPortrait} from '../components/ArtistPortrait.jsx';
import {requestArtistPortrait} from '../feed/artistPortraits.js';

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('retries a missing artist portrait when the connection returns',async()=>{
  vi.stubGlobal('IntersectionObserver',undefined);
  requestArtistPortrait.mockResolvedValueOnce(null).mockResolvedValueOnce({thumbnail:'https://cdn.test/queen.jpg'});
  const {container}=render(<ArtistPortrait artist={{name:'Queen',artistId:'queen-id'}} active={false} accent="#fff"/>);
  await waitFor(()=>expect(container.textContent).toBe('Q'));
  fireEvent(window,new Event('online'));
  await waitFor(()=>expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/queen.jpg'));
  expect(requestArtistPortrait).toHaveBeenCalledTimes(2);
});

import {afterEach,expect,it,vi} from 'vitest';
import {api} from '../../api.js';
import {cacheTrack} from '../../catalog.js';
import {useCatalogNavigation} from '../useCatalogNavigation.js';
afterEach(()=>{vi.restoreAllMocks();localStorage.removeItem('velocity.dj.previous.anonymous');});
const options=()=>({setExpanded:vi.fn(),setView:vi.fn(),setOpenPlaylist:vi.fn(),setTab:vi.fn(),setDetailData:vi.fn(),setDetailLoading:vi.fn(),setCatVer:vi.fn(),showToast:vi.fn(),play:vi.fn(),recent:[],favs:[],downloaded:new Set(),playlists:[],savedPlaylists:[]});

it('AI DJ starts from actual listening context and supplies 50 related recordings',async()=>{
 const seed={id:'dj-seed',title:'Creep',artist:'Radiohead'};cacheTrack(seed);
 const other={id:'download-only',title:'Unrelated download',artist:'Different artist'};cacheTrack(other);
 const radio=vi.spyOn(api,'radio').mockResolvedValue(Array.from({length:65},(_,i)=>({id:'dj-'+i,title:'Related '+i,artist:i%2?'Muse':'Radiohead'})));
 const o={...options(),recent:[seed.id],downloaded:new Set([other.id])};
 await useCatalogNavigation(o).startAiDj();
 expect(radio.mock.calls[0][0]).toBe(seed.id);
 expect(o.play.mock.calls[0][0].id).toBe('dj-0'); // Related discovery precedes the just-played seed.
 expect(o.play.mock.calls[0][1]).toContain(seed.id);
 expect(o.play.mock.calls[0][1].length).toBe(50);
 expect(o.play.mock.calls[0][1]).not.toContain(other.id);
});
it('AI DJ cannot substitute a generic nominal search when no personal seed exists',async()=>{
 const search=vi.spyOn(api,'search');const o=options();
 await useCatalogNavigation(o).startAiDj();
 expect(search).not.toHaveBeenCalled();expect(o.play).not.toHaveBeenCalled();
 expect(o.showToast.mock.calls.at(-1)[0]).toContain('50 canciones relacionadas');
});

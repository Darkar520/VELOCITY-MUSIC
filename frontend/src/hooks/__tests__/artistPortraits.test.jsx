import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../../api.js',()=>({api:{searchAll:vi.fn(),artist:vi.fn()}}));
import {api} from '../../api.js';
import {requestArtistPortrait} from '../../feed/artistPortraits.js';
afterEach(()=>{vi.clearAllMocks();});
it('loads a matching artist portrait, ignoring album art and similarly named channels',async()=>{
 api.searchAll.mockResolvedValue({artists:[{name:'Queen Covers',thumbnail:'https://bad.test/fan'},{name:'Queen',artistId:'queen',thumbnail:'https://good.test/portrait'}],songs:[{artist:'Queen',cover:'https://bad.test/album'}]});
 const result=await requestArtistPortrait({name:'Queen'},new AbortController().signal);
 expect(result.thumbnail).toBe('https://good.test/portrait');
});
it('falls back to the exact artist profile when search has no photo',async()=>{
 api.searchAll.mockResolvedValue({artists:[{name:'Radiohead',artistId:'radiohead'}]});
 api.artist.mockResolvedValue({name:'Radiohead',thumbnail:'https://good.test/radiohead'});
 const result=await requestArtistPortrait({name:'Radiohead'},new AbortController().signal);
 expect(result.thumbnail).toBe('https://good.test/radiohead');
});
it('does not call the catalogue for work canceled before it starts',async()=>{
 const controller=new AbortController();controller.abort();
 expect(await requestArtistPortrait({name:'Canceled portrait'},controller.signal)).toBe(null);
 expect(api.searchAll).not.toHaveBeenCalled();
});

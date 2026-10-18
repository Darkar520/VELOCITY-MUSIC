import {renderHook,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
vi.mock('../../api.js',()=>({api:{searchAll:vi.fn()}}));
import {api} from '../../api.js';
import {useOnboardingArtists} from '../useOnboardingArtists.js';
const genres=['EDM','Rock','Metal'].map(label=>({label,q:label+' 2025'}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('offers 48 artists even when the remote catalogue fails',async()=>{
 api.searchAll.mockRejectedValue(new Error('offline'));
 const {result}=renderHook(()=>useOnboardingArtists(2,genres));
 expect(result.current.artists).toHaveLength(48);
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.artists.some(a=>a.name==='Deftones')).toBe(true);
});
it('does not turn compilation uploaders into artist suggestions',async()=>{
 api.searchAll.mockResolvedValue({artists:[{name:'Greatest Rock Hits',artistId:'junk'}],songs:[{artist:'EDM RTTWLR'},{artist:'Deftones',artistId:'deftones-id'}]});
 const {result}=renderHook(()=>useOnboardingArtists(2,genres));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(result.current.artists.some(a=>a.name==='EDM RTTWLR'||a.name==='Greatest Rock Hits')).toBe(false);
 expect(result.current.artists.find(a=>a.name==='Deftones').artistId).toBe('deftones-id');
});

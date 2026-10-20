import React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {HomeDiscovery} from '../../components/HomeDiscovery.jsx';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const fullTracks=()=>Array.from({length:50},(_,i)=>({id:'track-'+i,title:'Track '+i,artist:'Artist '+i}));
it('observes scrolling when content arrives after the empty state and requests one page per entry',()=>{
 const observe=vi.fn(),disconnect=vi.fn();let callback;
 vi.stubGlobal('IntersectionObserver',class {constructor(cb){callback=cb;}observe=observe;disconnect=disconnect;});
 const dispatch=vi.spyOn(window,'dispatchEvent');
 const props={play:vi.fn(),goMix:vi.fn(),prefs:{genres:[]},loading:false};
 const {rerender}=render(<HomeDiscovery {...props} rows={[]}/>);
 expect(observe).not.toHaveBeenCalled();
 const row={section:'Discover',mixes:[{label:'Mix',featured:true,tracks:fullTracks()}]};
 rerender(<HomeDiscovery {...props} rows={[row]}/>);
 expect(observe).toHaveBeenCalledOnce();
 callback([{isIntersecting:true}]);
 rerender(<HomeDiscovery {...props} rows={[row,{...row,section:'More'}]}/>);
 callback([{isIntersecting:true}]);
 expect(dispatch.mock.calls.filter(([event])=>event.type==='velocity:feed-more')).toHaveLength(1);
 dispatch.mockRestore();
});
it('renders real recommendations and connects playback, mix navigation, favorites and menus',()=>{
 const play=vi.fn(),goMix=vi.fn(),onToggleFav=vi.fn(),onMenu=vi.fn();
 const tracks=fullTracks();tracks[0]={id:'a',title:'Rosemary',artist:'Deftones',cover:''};tracks[1]={id:'b',title:'Entombed',artist:'Deftones',cover:''};
 const mix={label:'Deftones',tracks};
 render(<HomeDiscovery rows={[{section:'El sonido que elegiste',mixes:[mix]}]} prefs={{genres:[{q:'metal',label:'Metal'}]}} {...{play,goMix,onToggleFav,onMenu}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Reproducir selección'}));expect(play).toHaveBeenCalledWith(tracks[0],tracks.map(t=>t.id),{mixLabel:'Deftones'});
 fireEvent.click(screen.getByRole('button',{name:'Abrir Deftones'}));expect(goMix).toHaveBeenCalledWith(mix);
 fireEvent.click(screen.getByRole('button',{name:'Me gusta Rosemary'}));expect(onToggleFav).toHaveBeenCalledWith('a');
 fireEvent.click(screen.getByRole('button',{name:'Opciones de Rosemary'}));expect(onMenu).toHaveBeenCalledWith('a');
 expect(screen.queryByText('Escuchado recientemente')).toBe(null);
});
it('a failed network has an actionable state rather than blank space',()=>{
 const retry=vi.fn();render(<HomeDiscovery rows={[]} retry={retry}/>);
 fireEvent.click(screen.getByRole('button',{name:'Volver a intentar'}));expect(retry).toHaveBeenCalledOnce();
});
it('shows a filled heart for a liked recommendation',()=>{
 const track={id:'liked',title:'Scars',artist:'Artist'};
 render(<HomeDiscovery rows={[{section:'Discover',mixes:[{label:'Mix',tracks:[track]}]}]} favs={['liked']} offline play={vi.fn()} goMix={vi.fn()}/>);
 const heart=screen.getByRole('button',{name:'Quitar Me gusta de Scars'});
 expect(heart.getAttribute('aria-pressed')).toBe('true');
 expect(heart.querySelector('svg').getAttribute('fill')).toBe('currentColor');
});
it('does not expose an incomplete generated selection as a playable mix',()=>{
 const rows=[{section:'Discover',mixes:[{label:'Incomplete',pending:true,tracks:[{id:'one',title:'One',artist:'Artist'}]}]}];
 render(<HomeDiscovery rows={rows} loading play={vi.fn()} goMix={vi.fn()}/>);
 expect(screen.queryByRole('button',{name:'Abrir Incomplete'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Reproducir selección'})).toBeNull();
 expect(screen.getByText('Afinando tu selección…')).toBeTruthy();
});
it('does not show a cached 12-song selection as the featured 50-song mix',()=>{
 const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}));
 render(<HomeDiscovery rows={[{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',featured:true,tracks}]}]} loading play={vi.fn()} goMix={vi.fn()}/>);
 expect(screen.getByText('Afinando tu selección…')).toBeTruthy();
 expect(getComputedStyle(screen.getByText('Afinando tu selección…')).color).toBe('rgb(244, 247, 245)');
 expect(screen.queryByText('12 canciones')).toBeNull();
 expect(screen.queryByRole('button',{name:'Reproducir selección'})).toBeNull();
});
it('keeps the song order after playback even when another recommendation page arrives',()=>{
 const tracks=['First','Scars','Third'].map((title,i)=>({id:String(i),title,artist:'Artist '+i}));
 const row={section:'Discover',mixes:[{label:'Mix',tracks}]};
 const props={play:vi.fn(),goMix:vi.fn(),prefs:{genres:[{label:'Rock',q:'rock'}]},offline:true};
 const {rerender}=render(<HomeDiscovery {...props} rows={[row]}/>);
 const region=screen.getByRole('region',{name:'Tu próxima favorita'});
 const before=[...region.querySelectorAll('.discovery-song-main')].map(x=>x.textContent);
 fireEvent.click(screen.getByRole('button',{name:'Reproducir Scars'}));
 rerender(<HomeDiscovery {...props} rows={[row,{section:'More',mixes:[{label:'New',tracks:[{id:'new',title:'New song',artist:'New artist'}]}]}]}/>);
 expect([...region.querySelectorAll('.discovery-song-main')].map(x=>x.textContent)).toEqual(before);
});

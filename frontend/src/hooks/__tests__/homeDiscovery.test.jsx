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
 const tracks=fullTracks();tracks[0]={id:'liked',title:'Scars',artist:'Artist'};
 render(<HomeDiscovery rows={[{section:'Discover',mixes:[{label:'Mix',tracks}]}]} favs={['liked']} play={vi.fn()} goMix={vi.fn()}/>);
 const heart=screen.getByRole('button',{name:'Quitar Me gusta de Scars'});
 expect(heart.getAttribute('aria-pressed')).toBe('true');
 expect(heart.querySelector('svg').getAttribute('fill')).toBe('currentColor');
});
it('does not expose an incomplete generated selection as a playable mix',()=>{
 const rows=[{section:'Discover',mixes:[{label:'Incomplete',pending:true,tracks:[{id:'one',title:'One',artist:'Artist'}]}]}];
 const {container}=render(<HomeDiscovery rows={rows} loading play={vi.fn()} goMix={vi.fn()}/>);
 expect(screen.queryByRole('button',{name:'Abrir Incomplete'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Reproducir selección'})).toBeNull();
 expect(container.querySelector('.discovery-cycle:not(.discovery-repeat) h2').textContent).toBe('Afinando tu selección…');
});
it('does not show a cached 12-song selection as the featured 50-song mix',()=>{
 const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}));
 const {container}=render(<HomeDiscovery rows={[{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',featured:true,tracks}]}]} loading play={vi.fn()} goMix={vi.fn()}/>);
 const heading=container.querySelector('.discovery-cycle:not(.discovery-repeat) h2');
 expect(heading.textContent).toBe('Afinando tu selección…');
 expect(getComputedStyle(heading).color).toBe('rgb(244, 247, 245)');
 expect(screen.queryByText('12 canciones')).toBeNull();
 expect(screen.queryByRole('button',{name:'Reproducir selección'})).toBeNull();
});
it('does not render a legacy partial frequency mix as a normal carousel',()=>{
 const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}));
 const {container}=render(<HomeDiscovery rows={[{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',tracks}]}]} loading play={vi.fn()} goMix={vi.fn()}/>);
 const main=container.querySelector('.discovery-cycle:not(.discovery-repeat)');
 expect(main.textContent).not.toContain('12 canciones');
 expect(main.querySelector('.discovery-section')).toBeNull();
 expect(main.querySelector('.discovery-empty h2').textContent).toBe('Afinando tu selección…');
});
it('hides a partial frequency mix if its legacy section title includes a subtitle',()=>{
 const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:'Track '+i,artist:'Linkin Park'}));
 const {container}=render(<HomeDiscovery rows={[{section:'En tu frecuencia: Un mundo por escuchar',mixes:[{label:'Linkin Park',tracks}]}]} loading play={vi.fn()} goMix={vi.fn()}/>);
 const main=container.querySelector('.discovery-cycle:not(.discovery-repeat)');
 expect(main.textContent).not.toContain('12 canciones');
 expect(main.querySelector('.discovery-section')).toBeNull();
 expect(main.querySelector('.discovery-empty h2').textContent).toBe('Afinando tu selección…');
});
it('opens the complete 50-track frequency mix from the hero action',()=>{
 const goMix=vi.fn(),tracks=fullTracks();
 render(<HomeDiscovery rows={[{section:'En tu frecuencia: Un mundo por escuchar',mixes:[{label:'Linkin Park',tracks}]}]} prefs={{genres:[]}} play={vi.fn()} goMix={goMix}/>);
 fireEvent.click(screen.getByRole('button',{name:/Explorar mix/}));
 expect(goMix).toHaveBeenCalledOnce();
 expect(goMix.mock.calls[0][0].tracks).toHaveLength(50);
});
it('keeps a short offline playlist in its own section instead of promoting it as Tu frecuencia',()=>{
 const tracks=Array.from({length:12},(_,i)=>({id:'local-'+i,title:'Local '+i,artist:'Linkin Park'}));
 const {container}=render(<HomeDiscovery rows={[{section:'Tus playlists',mixes:[{label:'Linkin Park',tracks}]}]} offline play={vi.fn()} goMix={vi.fn()}/>);
 const main=container.querySelector('.discovery-cycle:not(.discovery-repeat)');
 expect(screen.queryByRole('region',{name:'Selección destacada'})).toBeNull();
 expect(main.querySelector('h2').textContent).toBe('Tu frecuencia volverá al conectar.');
 expect(main.textContent).toContain('Tus playlists');
 expect(main.textContent).toContain('Linkin Park');
});
it('keeps the song order after playback even when another recommendation page arrives',()=>{
 const tracks=fullTracks();tracks[0]={id:'0',title:'First',artist:'Artist 0'};tracks[1]={id:'1',title:'Scars',artist:'Artist 1'};tracks[2]={id:'2',title:'Third',artist:'Artist 2'};
 const row={section:'Discover',mixes:[{label:'Mix',tracks}]};
 const props={play:vi.fn(),goMix:vi.fn(),prefs:{genres:[{label:'Rock',q:'rock'}]},offline:true};
 const {rerender}=render(<HomeDiscovery {...props} rows={[row]}/>);
 const region=screen.getByRole('region',{name:'Tu próxima favorita'});
 const before=[...region.querySelectorAll('.discovery-song-main')].map(x=>x.textContent);
 fireEvent.click(screen.getByRole('button',{name:'Reproducir Scars'}));
 rerender(<HomeDiscovery {...props} rows={[row,{section:'More',mixes:[{label:'New',tracks:[{id:'new',title:'New song',artist:'New artist'}]}]}]}/>);
 expect([...region.querySelectorAll('.discovery-song-main')].map(x=>x.textContent)).toEqual(before);
});

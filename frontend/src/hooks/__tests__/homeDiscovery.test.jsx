import React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {HomeDiscovery} from '../../components/HomeDiscovery.jsx';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('observes scrolling when content arrives after the empty state and requests one page per entry',()=>{
 const observe=vi.fn(),disconnect=vi.fn();let callback;
 vi.stubGlobal('IntersectionObserver',class {constructor(cb){callback=cb;}observe=observe;disconnect=disconnect;});
 const dispatch=vi.spyOn(window,'dispatchEvent');
 const props={play:vi.fn(),goMix:vi.fn(),prefs:{genres:[]},loading:false};
 const {rerender}=render(<HomeDiscovery {...props} rows={[]}/>);
 expect(observe).not.toHaveBeenCalled();
 const row={section:'Discover',mixes:[{label:'Mix',tracks:[{id:'one',title:'One',artist:'Artist'}]}]};
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
 const tracks=[{id:'a',title:'Rosemary',artist:'Deftones',cover:''},{id:'b',title:'Entombed',artist:'Deftones',cover:''}];
 const mix={label:'Deftones',tracks};
 render(<HomeDiscovery rows={[{section:'El sonido que elegiste',mixes:[mix]}]} prefs={{genres:[{q:'metal',label:'Metal'}]}} {...{play,goMix,onToggleFav,onMenu}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Reproducir selección'}));expect(play).toHaveBeenCalledWith(tracks[0],['a','b'],{mixLabel:'Deftones'});
 fireEvent.click(screen.getByRole('button',{name:'Abrir Deftones'}));expect(goMix).toHaveBeenCalledWith(mix);
 fireEvent.click(screen.getByRole('button',{name:'Me gusta Rosemary'}));expect(onToggleFav).toHaveBeenCalledWith('a');
 fireEvent.click(screen.getByRole('button',{name:'Opciones de Rosemary'}));expect(onMenu).toHaveBeenCalledWith('a');
 expect(screen.queryByText('Escuchado recientemente')).toBe(null);
});
it('a failed network has an actionable state rather than blank space',()=>{
 const retry=vi.fn();render(<HomeDiscovery rows={[]} retry={retry}/>);
 fireEvent.click(screen.getByRole('button',{name:'Volver a intentar'}));expect(retry).toHaveBeenCalledOnce();
});

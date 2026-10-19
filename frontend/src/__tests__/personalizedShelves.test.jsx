import React from 'react';
import {act, cleanup, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {api} from '../api.js';
import {usePersonalizedShelves} from '../hooks/usePersonalizedShelves.js';
import {PersonalizedShelves} from '../components/PersonalizedShelves.jsx';
import {HomeDiscovery} from '../components/HomeDiscovery.jsx';
const tracks = Array.from({length:4},(_,i)=>({id:'shelf-'+i,title:'Song '+i,artist:'Queen',cover:'https://cover.test/'+i}));
const rows = [{mixes:[{tracks}]}];
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('personalized tail shelves',()=>{
  it('uses an available mix cover when the first recording has no artwork',()=>{
    const mixed=[{...tracks[0],cover:''},tracks[1]];
    const {container}=render(<HomeDiscovery rows={[{section:'Test',mixes:[{label:'Mix',tracks:mixed}]}]} prefs={null} play={vi.fn()} goMix={vi.fn()}/>);
    expect(container.querySelector('.discovery-mosaic img').getAttribute('src')).toContain('cover.test/1');
    expect(container.querySelector('.discovery-mix-art img').getAttribute('src')).toContain('cover.test/1');
  });
  it('plays the displayed selection in its displayed order and opens its actual mix',()=>{
    const play=vi.fn(),goMix=vi.fn();
    const card={id:'test',label:'Queen',tag:'TU BÚSQUEDA',reason:'Buscaste «Queen»',tracks};
    render(<PersonalizedShelves shelves={[{id:'curiosity',title:'Tu curiosidad tiene continuación',cards:[card]}]} play={play} goMix={goMix}/>);
    fireEvent.click(screen.getByRole('button',{name:'Reproducir Queen'}));
    expect(play).toHaveBeenCalledWith(tracks[0],tracks.map(t=>t.id),{mixLabel:'Queen'});
    fireEvent.click(screen.getByRole('button',{name:'Abrir Queen'}));
    expect(goMix).toHaveBeenCalledWith(card);
  });

  it('does no search work while offline',()=>{
    const search=vi.spyOn(api,'search').mockResolvedValue(tracks);
    const {result}=renderHook(()=>usePersonalizedShelves({rows,prefs:null,recent:[],favs:[],searches:['Queen'],account:'a',loading:false,offline:true}));
    expect(search).not.toHaveBeenCalled();
    expect(result.current[0].cards[0].label).toBe('Queen');
  });

  it('aborts old account searches and discards a late response after account change',async()=>{
    let finishOld;
    const search=vi.spyOn(api,'search').mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;})).mockResolvedValue([]);
    const base={rows:[],prefs:null,recent:[],favs:[],searches:['Old query'],account:'a',loading:false,offline:false};
    const {result,rerender}=renderHook(props=>usePersonalizedShelves(props),{initialProps:base});
    const signal=search.mock.calls[0][1];
    rerender({...base,searches:['New query'],account:'b'});
    expect(signal.aborted).toBe(true);
    await act(async()=>finishOld(tracks));
    await waitFor(()=>expect(search).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual([]);
  });
});

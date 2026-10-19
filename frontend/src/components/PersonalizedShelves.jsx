import React from 'react';
import {CoverImg} from '../components.jsx';
import {Icon} from '../Icons.jsx';
import './personalizedShelves.css';
import {bestCoverFor} from '../catalog.js';
import {MIX_MIN} from '../feed/seededMix.js';

export function PersonalizedShelves({shelves, play, goMix, onInteract}) {
  return shelves.map(shelf => <section className={`personal-shelf personal-shelf-${shelf.id}`} key={shelf.id} aria-label={shelf.title}>
    <header><div><span className="discovery-eyebrow">{shelf.eyebrow}</span><h2>{shelf.title}</h2><p>{shelf.description}</p></div><span className="personal-shelf-mark" aria-hidden="true">{shelf.id === 'curiosity' ? '↗' : '⤳'}</span></header>
    <div className="personal-shelf-rail" role="region" aria-label={`Selecciones: ${shelf.title}`} tabIndex={0}>
      {shelf.cards.map((card, index) => { const ready=!card.pending&&!card.error&&card.tracks.length===MIX_MIN; return <article className="personal-card" key={card.id} data-seed-id={card.seedId} data-track-count={ready?card.tracks.length:0}>
        <button className="personal-card-open" disabled={!ready} onClick={() => { onInteract?.(); goMix(card); }} aria-label={`Abrir ${card.label}`}>
          <div className="personal-card-art"><CoverImg src={bestCoverFor(card.tracks[0]?.id,card.tracks[0]?.cover)} alt="" size={384} radius={0}/><span className="personal-card-number">{String(index + 1).padStart(2, '0')}</span><span className="personal-card-tag">{card.tag}</span></div>
          <span className="personal-card-copy"><strong>{card.label}</strong><small>{card.reason}</small></span>
        </button>
        <div className="personal-card-footer">{!ready?<><span role="status">{card.pending?'Preparando 50 canciones…':'Selección no disponible'}</span>{!card.pending&&<button aria-label={`Reintentar ${card.label}`} onClick={()=>window.dispatchEvent(new Event('velocity:retry-personal-mixes'))}><span aria-hidden="true">↻</span></button>}</>:<><span>{card.tracks.length} canciones</span><button onClick={() => { onInteract?.(); play(card.tracks[0], card.tracks.map(t => t.id), {mixLabel: card.label}); }} aria-label={`Reproducir ${card.label}`}><Icon.Play sz={17}/></button></>}</div>
      </article>;})}
    </div>
  </section>);
}

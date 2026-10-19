import React from 'react';
import {CoverImg} from '../components.jsx';
import {Icon} from '../Icons.jsx';
import './personalizedShelves.css';

export function PersonalizedShelves({shelves, play, goMix, onInteract}) {
  return shelves.map(shelf => <section className={`personal-shelf personal-shelf-${shelf.id}`} key={shelf.id} aria-label={shelf.title}>
    <header><div><span className="discovery-eyebrow">{shelf.eyebrow}</span><h2>{shelf.title}</h2><p>{shelf.description}</p></div><span className="personal-shelf-mark" aria-hidden="true">{shelf.id === 'curiosity' ? '↗' : '⤳'}</span></header>
    <div className="personal-shelf-rail" role="region" aria-label={`Selecciones: ${shelf.title}`} tabIndex={0}>
      {shelf.cards.map((card, index) => <article className="personal-card" key={card.id}>
        <button className="personal-card-open" onClick={() => { onInteract?.(); goMix(card); }} aria-label={`Abrir ${card.label}`}>
          <div className="personal-card-art"><CoverImg src={card.tracks.find(t => t.cover)?.cover} alt="" size={384} radius={0}/><span className="personal-card-number">{String(index + 1).padStart(2, '0')}</span><span className="personal-card-tag">{card.tag}</span></div>
          <span className="personal-card-copy"><strong>{card.label}</strong><small>{card.reason}</small></span>
        </button>
        <div className="personal-card-footer"><span>{card.tracks.length} canciones</span><button onClick={() => { onInteract?.(); play(card.tracks[0], card.tracks.map(t => t.id), {mixLabel: card.label}); }} aria-label={`Reproducir ${card.label}`}><Icon.Play sz={17}/></button></div>
      </article>)}
    </div>
  </section>);
}

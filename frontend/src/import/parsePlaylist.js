
export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

export function parseTextPlaylist(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const tracks = [];
  let isCSV = false;
  let titleCol = -1;
  let artistCol = -1;
  if (lines.length > 0) {
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('track name') || firstLine.includes('artist name') || firstLine.includes('track list') || firstLine.includes('title')) {
      isCSV = true;
      const headers = parseCSVLine(lines[0]);
      titleCol = headers.findIndex(h => h.includes('track name') || h.includes('title') || h.includes('nombre'));
      artistCol = headers.findIndex(h => h.includes('artist') || h.includes('artista'));
    }
  }
  const startIndex = isCSV ? 1 : 0;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (isCSV && titleCol !== -1 && artistCol !== -1) {
      const cols = parseCSVLine(line);
      const title = cols[titleCol];
      const artist = cols[artistCol];
      if (title) {
        tracks.push({ title, artist: artist || 'Desconocido' });
      }
    } else {
      let title = '';
      let artist = '';
      if (line.includes(' - ')) {
        const parts = line.split(' - ');
        title = parts[0].trim();
        artist = parts.slice(1).join(' - ').trim();
      } else if (line.includes(' by ')) {
        const parts = line.split(' by ');
        title = parts[0].trim();
        artist = parts.slice(1).join(' by ').trim();
      } else {
        title = line;
        artist = '';
      }
      if (title) {
        tracks.push({ title, artist: artist || '' });
      }
    }
  }
  return tracks;
}

// Bookmarklet gratis: lee la playlist abierta en open.spotify.com (sesión del usuario, sin API Premium).
const SPOTIFY_BOOKMARKLET = `javascript:(function(){try{const lines=[];const seen=new Set();const add=(t,a)=>{t=(t||'').trim();if(!t||t.length>200)return;const k=t.toLowerCase()+'|'+(a||'').toLowerCase();if(seen.has(k))return;seen.add(k);lines.push(a?t+' - '+a:t)};document.querySelectorAll('[data-testid="tracklist-row"],[data-testid="track-list"] [role="row"],div[role="row"]').forEach(row=>{const titleEl=row.querySelector('[data-testid="internal-track-link"],a[href*="/track/"]');const t=titleEl?(titleEl.getAttribute('aria-label')||titleEl.textContent||''):'';const arts=[...row.querySelectorAll('a[href*="/artist/"]')].map(x=>(x.textContent||'').trim()).filter(Boolean);const uniq=[...new Set(arts)];add(t.split(/\\n/)[0],uniq.join(', '))});if(!lines.length){document.querySelectorAll('a[href*="/track/"]').forEach(a=>{const t=(a.textContent||'').trim();const row=a.closest('[role="row"],div')||a.parentElement;const arts=row?[...row.querySelectorAll('a[href*="/artist/"]')].map(x=>(x.textContent||'').trim()).filter(Boolean):[];add(t,[...new Set(arts)].join(', '))})}if(!lines.length){alert('No encontré canciones.\\n\\n1) Abre la playlist en open.spotify.com (navegador, no la app).\\n2) Desplázate un poco para cargar temas.\\n3) Vuelve a tocar el marcador.');return}const txt=lines.join('\\n');const done=()=>alert('✓ '+lines.length+' canciones copiadas.\\n\\nVuelve a Velocity → Importar → pega la lista.');if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done).catch(()=>{window.prompt('Copia (Ctrl+C) y pega en Velocity:',txt)})}else{window.prompt('Copia (Ctrl+C) y pega en Velocity:',txt)}}catch(e){alert('Error: '+(e&&e.message||e))}})();`;


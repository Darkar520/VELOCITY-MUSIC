import React, { useState, useEffect, useRef, useMemo } from 'react';

export function useListSearch(list) {
  const [search, setSearch] = useState('');
  const showSearch = list.length >= 8;
  const norm = (s) => String(s || '').toLowerCase();
  const filtered = search.trim()
    ? list.filter(t => norm(t.title).includes(norm(search)) || norm(t.artist).includes(norm(search)))
    : list;
  return [search, setSearch, filtered, showSearch];
}

// ═══════════════════════════════════════════════════════════════
// LIBRARY TAB


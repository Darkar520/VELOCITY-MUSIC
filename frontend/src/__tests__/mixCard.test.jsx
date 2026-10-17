import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MixCard } from '../components.jsx';
import { T, makeTrack } from './uiFixtures.js';

afterEach(cleanup);

it('renders a cached mix without label instead of unmounting the app and its download queue', () => {
  render(<MixCard mix={{ title: 'Lista recuperada', tracks: [makeTrack()] }} T={T} />);
  expect(screen.getByText('Lista recuperada')).toBeTruthy();
});

it('renders a safe title when both optional mix names are absent', () => {
  render(<MixCard mix={{ tracks: [] }} T={T} />);
  expect(screen.getAllByText('Mezcla').length).toBeGreaterThan(0);
});

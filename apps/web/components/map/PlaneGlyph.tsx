/** Airliner seen from above, nose up (track 0°), in a 64×64 box. */
const BODY =
  'M32 2C34.2 2 35 4.6 35 8L35 23L59 36.5L60 40L35 34.5L34.5 50L43 56.5L43 59.5' +
  'L33.2 57L32 61L30.8 57L21 59.5L21 56.5L29.5 50L29 34.5L4 40L5 36.5L29 23L29 8' +
  'C29 4.6 29.8 2 32 2Z';

const PARTS =
  `<path d="${BODY}"/>` +
  '<rect x="17.5" y="25" width="4" height="9" rx="2"/>' +
  '<rect x="42.5" y="25" width="4" height="9" rx="2"/>';

export type PlaneKind = 'arr' | 'dep' | 'none';

/** Marker markup for Leaflet divIcons; colors come from the `.aircraft-*` classes. */
export function planeSvg(track: number): string {
  return `<svg class="aircraft-plane" viewBox="0 0 64 64" style="transform: rotate(${track}deg)">${PARTS}</svg>`;
}

/** The same plane as a React element, for the legend. */
export function PlaneGlyph({ kind }: { kind: PlaneKind }) {
  return (
    <svg
      className={`plane-glyph aircraft-${kind}`}
      viewBox="0 0 64 64"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: PARTS }}
    />
  );
}

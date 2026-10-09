# SkyDetective

A sky explorer with optical (DSS2) and near-infrared (2MASS) atlas backgrounds, fixed-area navigation, and dated SPHEREx observations.

## Run locally

Use Node.js 22.18 or newer and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. For a production build, run `npm run build` followed by `npm start`.

## What you can do

- Pan and zoom the live Aladin Lite sky atlas; switch optical/infrared backgrounds.
- Find stars, galaxies, or nebulae by name using CDS Sesame, or enter decimal ICRS coordinates.
- Browse 132 candidate targets: featured fields, the Messier catalog, and additional nebulae, clusters, galaxies, and variable-star fields.
- Save up to 50 positions in this browser, including survey and field width. Export/import JSON backups; imports merge without replacing existing bookmarks.
- Open **Compare dates**, then **Timelapse** for play/pause, previous/next, frame scrubbing, and adjustable speed. Swipe mode remains available.
- Download original FITS links, a preview PNG, and JSON observation details from the comparison panel.
- Inspect up to 20 downloaded SPHEREx FITS files locally to read dates, detectors, image centers, dimensions, and units; export their metadata without uploading science data.
- Use **Research & help** to search IRSA at the current sky position, export field details, or share a link that restores coordinates, zoom, and survey.
- Use arrow keys, +/−, Home, and Enter while the map is focused. Escape closes panels.

## Data and scientific limits

The local comparison contains two actual SPHEREx QR2 detector-1 observations, acquired on May 3 and May 22, 2025. It loops two dates; it does not invent intermediate observations or claim continuous coverage. Both previews are reprojected onto the same 0.70° × 0.525° tangent-plane patch at RA 127.69444°, Dec −39.17760°, with a shared intensity stretch.

Candidate areas are search starting points, not verified multi-date sequences. M102 has an ambiguous historical identification. The atlas backgrounds are DSS2/2MASS, not dated SPHEREx observations. SPHEREx's linear variable filter gives different wavelengths at different detector positions: the same detector does not guarantee the same wavelength. Check wavelength maps, quality masks, and uncertainties before interpreting brightness differences.

Original FITS files are not included in Git. Automatic ingestion, alignment, and playback of arbitrary FITS datasets are not implemented. The eight additional URLs supplied during development need their footprints and wavelengths checked before they can be added to a shared-area timeline.

## Rebuild the included previews

Install NumPy and Pillow in a Python environment. Put these files in `data/spherex-demo/` (ignored by Git), or pass `--data-dir` for their existing folder:

- `level2_2025W18_2B_0237_4D1_spx_l2b-v20-2025-241.fits`
- `level2_2025W21_1B_0582_2D1_spx_l2b-v20-2025-248.fits`

```sh
python3 scripts/render_spherex_previews.py --data-dir /path/to/downloads
```

The renderer reads the IMAGE extension, applies TAN-SIP coordinates and bilinear sampling, and writes the two PNGs into `public/spherex-previews/`. Sources remain untouched. This is a visualization tool, not a full scientific calibration pipeline.

## Checks

```sh
npm test
npm run lint
npm run build
```

The tests cover shared-link validation, bounded archive searches, bookmark import validation, object-resolver success/failure behavior, and FITS header parsing and malformed-file rejection without requiring network access.

## External services and privacy

The live atlas loads Aladin Lite and survey tiles from CDS. Name searches are resolved through the server against CDS Sesame. Archive links open NASA/IPAC IRSA. An internet connection is needed for those services. If the atlas fails, the local starfield and bundled SPHEREx comparison remain available. Bookmarks stay in browser storage; export a backup before clearing browser data. No account, analytics, or application database is configured.

- [SPHEREx archive](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- [Release documentation](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html)
- [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/)
- [CDS Sesame](https://vizier.cds.unistra.fr/vizier/doc/sesame.htx)

## Project structure

`src/app/components/sky-viewport.tsx` manages the atlas and panels. `spherex-comparison.tsx` handles dated previews and playback. `area-browser.tsx` provides candidate targets. `research-tools.tsx` provides archive access and sharing. `saved-positions.tsx` manages browser bookmarks. `sky-data.ts` contains shared URL and validation helpers. `src/app/api/object-search/route.ts` is the name-resolution endpoint.

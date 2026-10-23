# OPD Saathi

Local hackathon prototype for sample hospital registration, queue status, emergency flags, and accessible wayfinding.

## HospitalWayfinder

The `/find` screen includes a reusable React + TypeScript `HospitalWayfinder` component. Its floor plans and walkable graph come from `src/data/hospital-wayfinder.json`, so a different sample hospital can be added by editing the data. The bundled layout preserves the prompt's City District Hospital destinations: OPD rooms 1–8, Ward 4/5/6, laboratory, pharmacy, help desk, emergency, lifts, stairs, ramp, waiting halls, and washrooms.

The wayfinder supports JSON-backed floors, A* routes, lifts/stairs and accessible routing. Its default view is a playable Three.js, open-top 3D hospital scene; the top-down floor plan remains available as an inspection view. Use the touch joystick or WASD/arrow keys to steer, drag the scene to orbit the camera, and pinch or scroll to zoom. The player stays on graph-connected walkways, doors open at the selected destination, and reaching junctions recalculates the remaining route. Turn-by-turn guidance, estimated distance, a first-person-style door view, play/pause/replay, voice directions and reduced-motion options are also available. This is a simulated game: it does not use GPS or camera scanning. The supplied architecture is an illustrative hospital layout, not a surveyed building plan.

The 3D scene is generated from `src/data/hospital-wayfinder.json`; edit that file to add or rearrange floors, rooms, corridors, doors and links. The React scene uses Three.js and the same walkable graph as A* routing.

## Run locally

1. Install Node.js and npm.
2. In this folder, run `npm install`.
3. Run `npm run dev` and open the local URL Vite prints (usually `http://localhost:5173`).

## Background video and appearance

The hospital clip at `public/images/hospital-ambient.mp4` runs behind all pages. Replace that file with another muted MP4 to use a different hospital background; keep the same filename so no code changes are needed. The interface uses a light glass-panel style with subtle motion, and honors the system reduced-motion preference.

The prototype stores made-up demo patients and queues in this browser's local storage. Open `/staff` and `/board` in other tabs to see cross-tab updates. Use the staff dashboard's reset control to clear demo state.

To create a production bundle, run `npm run build`.

To run the routing unit tests, use `npm run test:wayfinder`. To type-check the TypeScript wayfinder, use `npm run typecheck`.

### Simulated player controls

Use the Starting point selector to begin at the main gate or a room door. In the 3D view, drag the joystick to move continuously; release to stop. Drag elsewhere on the scene to orbit, pinch/scroll to zoom, and use the floor chips to inspect a level. In the top-down view, drag the player along the walkable paths. GPS, camera scanning and live device movement are not used.

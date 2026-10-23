import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Accessibility, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LocateFixed, Minus, Navigation, Pause, Play, Plus, QrCode, RotateCcw, Volume2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import hospitalData from '../data/hospital-wayfinder.json';
import { findRoute, routeDistance, type HospitalMap, type HospitalRoom } from './pathfinding.mjs';
const HospitalGame3D = lazy(() => import('./HospitalGame3D'));
import './wayfinder.css';

const map = hospitalData as HospitalMap;
const colors: Record<string, string> = { entrance: '#dcf4e8', service: '#e9efff', emergency: '#ffe5e0', lab: '#fff1d6', amenity: '#e1f4f0', vertical: '#f0e8ff', pharmacy: '#fff0dc', opd: '#e8f2ff', ward: '#f2eafa' };
const namesHi: Record<string, string> = { entrance: 'मुख्य प्रवेश', registration: 'पंजीकरण काउंटर', help: 'सहायता कक्ष', emergency: 'आपातकाल (कैजुअल्टी)', laboratory: 'प्रयोगशाला', toilet0: 'शौचालय', toilet1: 'शौचालय', pharmacy: 'फार्मेसी', waitingA: 'प्रतीक्षा कक्ष A', lift0: 'लिफ्ट', lift1: 'लिफ्ट', lift2: 'लिफ्ट', stairs0: 'सीढ़ियाँ', stairs1: 'सीढ़ियाँ', stairs2: 'सीढ़ियाँ', room1: 'OPD 1 · जनरल मेडिसिन', room2: 'OPD 2 · जनरल मेडिसिन', room3: 'OPD 3 · बच्चों का विभाग', room4: 'OPD 4 · महिला एवं गर्भावस्था', room5: 'OPD 5 · हड्डियाँ और जोड़', room6: 'OPD 6 · ईएनटी', room7: 'OPD 7 · आँखें', room8: 'OPD 8 · त्वचा', ward4: 'वार्ड 4 · मेडिसिन', ward5: 'वार्ड 5 · सर्जरी', ward6: 'वार्ड 6 · बच्चों का विभाग', nurses: 'नर्स स्टेशन' };
const label = (room: HospitalRoom | undefined, hindi: boolean) => room ? hindi ? namesHi[room.node] ?? room.name : room.name : '';
const center = (room: HospitalRoom) => ({ x: room.x + room.width / 2, y: room.y + room.height / 2 });
const portal = (room: HospitalRoom) => {
  const side = map.doors.find((door) => door.node === room.node)?.side;
  const p = center(room);
  if (side === 'west') return { x: room.x - 13, y: p.y };
  if (side === 'east') return { x: room.x + room.width + 13, y: p.y };
  if (side === 'north') return { x: p.x, y: room.y - 13 };
  if (side === 'south') return { x: p.x, y: room.y + room.height + 13 };
  return p;
};
function nearestWalkPoint(floor: number, x: number, y: number) {
  let best: { x: number; y: number; node: string; gap: number } | null = null;
  for (const [from, to] of map.edges) {
    const a = map.rooms.find((room) => room.node === from); const b = map.rooms.find((room) => room.node === to);
    if (!a || !b || a.floor !== floor || b.floor !== floor) continue;
    const p = portal(a); const q = portal(b); const dx = q.x - p.x; const dy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / Math.max(1, dx * dx + dy * dy)));
    const px = p.x + dx * t; const py = p.y + dy * t; const gap = Math.hypot(x - px, y - py);
    const node = Math.hypot(px - p.x, py - p.y) <= Math.hypot(px - q.x, py - q.y) ? from : to;
    if (!best || gap < best.gap) best = { x: px, y: py, node, gap };
  }
  return best;
}

export default function HospitalWayfinder({ language = 'en', initialDestination = 'room3' }: { language?: 'en' | 'hi'; initialDestination?: string }) {
  const hindi = language === 'hi';
  const [destination, setDestination] = useState(initialDestination);
  const [query, setQuery] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [qrBase, setQrBase] = useState(() => localStorage.getItem('opd-wayfinder-qr-base') || location.origin);
  const [start, setStart] = useState(() => { const requested = new URLSearchParams(location.search).get('start') || 'gate'; return map.rooms.some((room) => room.node === requested) ? requested : 'gate'; });
  const [floor, setFloor] = useState(() => map.rooms.find((room) => room.node === (new URLSearchParams(location.search).get('start') || 'gate'))?.floor ?? 0);
  const [accessible, setAccessible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [draggingPerson, setDraggingPerson] = useState(false);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number; node: string } | null>(null);
  const [gameMessage, setGameMessage] = useState('');
  const [walking, setWalking] = useState(false);
  const [gameMode, setGameMode] = useState<'3d' | 'map'>('3d');
  const walkTimer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const previous = useRef<number | null>(null);
  const route = useMemo(() => findRoute(map, start, destination, accessible), [start, destination, accessible]);
  const qrOrigin = useMemo(() => { try { const url = new URL(qrBase); return ['http:', 'https:'].includes(url.protocol) ? url.origin : location.origin; } catch { return location.origin; } }, [qrBase]);
  const qrUsesLoopback = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(new URL(qrOrigin).hostname);
  useEffect(() => { localStorage.setItem('opd-wayfinder-qr-base', qrOrigin); }, [qrOrigin]);
  useEffect(() => { if (map.rooms.some((room) => room.node === initialDestination)) { setDestination(initialDestination); setProgress(0); setPlaying(false); } }, [initialDestination]);
  const roomsByNode = useMemo(() => new Map(map.rooms.map((room) => [room.node, room])), []);
  const routeRooms = route.map((id) => roomsByNode.get(id)).filter((room): room is HospitalRoom => Boolean(room));
  const distance = routeDistance(map, route);
  const remainingDistance = Math.ceil(distance * (1 - progress));
  const etaSeconds = Math.ceil((1 - progress) * Math.max(6, distance * .15) / speed);
  const at = useMemo(() => {
    if (!routeRooms.length) return null;
    if (progress >= 1) { const room = routeRooms.at(-1)!; return { room, point: center(room), angle: 0 }; }
    const total = Math.max(1, routeRooms.length - 1);
    const step = Math.min(total - 0.0001, Math.max(0, progress) * total);
    const index = Math.floor(step);
    const a = routeRooms[index]; const b = routeRooms[Math.min(index + 1, routeRooms.length - 1)];
    if (a.floor !== b.floor) return { room: progress >= (index + 1) / total ? b : a, point: center(progress >= (index + 1) / total ? b : a), angle: 0 };
    const from = portal(a); const to = portal(b); const t = step - index;
    return { room: a, point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, angle: Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI };
  }, [progress, routeRooms]);
  useEffect(() => { if (at && (playing || progress >= 1) && at.room.floor !== floor) setFloor(at.room.floor); }, [at, floor, playing, progress]);
  useEffect(() => {
    if (!at || (!playing && !walking)) return;
    setPan({ x: (420 - at.point.x) * zoom, y: (320 - at.point.y) * zoom });
  }, [at?.point.x, at?.point.y, playing, walking, zoom]);
  useEffect(() => {
    const animate = (now: number) => {
      if (previous.current !== null) {
        const durationMs = Math.max(6000, distance * 150);
        setProgress((value) => { const next = Math.min(1, value + ((now - previous.current!) * speed) / durationMs); if (next >= 1) setPlaying(false); return next; });
      }
      previous.current = now;
      if (playing) raf.current = requestAnimationFrame(animate);
    };
    if (playing) raf.current = requestAnimationFrame(animate); else { previous.current = null; if (raf.current !== null) cancelAnimationFrame(raf.current); }
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [playing, distance, speed]);
  const currentNode = at?.room.node ?? start;
  const currentRoom = roomsByNode.get(draggingPerson && dragPosition ? dragPosition.node : currentNode);
  const visiblePosition = draggingPerson && dragPosition ? { room: roomsByNode.get(dragPosition.node) ?? at?.room, point: { x: dragPosition.x, y: dragPosition.y }, angle: at?.angle ?? 0 } : at;
  const segment = Math.min(Math.max(0, routeRooms.length - 2), Math.floor(progress * Math.max(1, routeRooms.length - 1)));
  const segmentStart = routeRooms[segment]; const segmentEnd = routeRooms[Math.min(segment + 1, routeRooms.length - 1)];
  const segmentA = segmentStart ? center(segmentStart) : null; const segmentB = segmentEnd ? center(segmentEnd) : null;
  const nextDirection = !segmentStart || !segmentEnd || segmentStart.floor !== segmentEnd.floor ? 'up' : Math.abs(segmentB!.x - segmentA!.x) >= Math.abs(segmentB!.y - segmentA!.y) ? segmentB!.x > segmentA!.x ? 'right' : 'left' : segmentB!.y > segmentA!.y ? 'down' : 'up';
  const directionSteps = useMemo(() => {
    const steps: { icon: string; text: string; floor?: number }[] = [];
    for (let i = 1; i < routeRooms.length; i++) {
      const prev = routeRooms[i - 1]; const next = routeRooms[i];
      if (prev.floor !== next.floor) {
        const via = next.node.startsWith('stairs') ? (hindi ? 'सीढ़ियों से' : 'Take the stairs') : (hindi ? 'लिफ्ट से' : 'Take the lift');
        steps.push({ icon: 'lift', text: `${via} ${map.floors[next.floor].label}.`, floor: next.floor });
      } else {
        const a = portal(prev); const b = portal(next);
        const turn = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? (hindi ? 'दाएँ मुड़ें' : 'Turn right') : (hindi ? 'बाएँ मुड़ें' : 'Turn left')) : (hindi ? 'सीधे चलें' : 'Walk straight');
        const metres = map.edges.find(([x, y]) => (x === prev.node && y === next.node) || (x === next.node && y === prev.node))?.[2] ?? 12;
        steps.push({ icon: turn === 'Walk straight' || turn === 'सीधे चलें' ? 'straight' : turn.includes('right') || turn.includes('दाएँ') ? 'right' : 'left', text: `${turn} ${metres} m${hindi ? ' चलें' : ''}. ${hindi ? next.landmark : `Pass ${next.landmark}.`}` });
      }
    }
    const destinationRoom = routeRooms.at(-1);
    if (destinationRoom) steps.push({ icon: 'arrive', text: hindi ? `${label(destinationRoom, true)} पहुँच गए। ${destinationRoom.landmark}।` : `You have arrived at ${destinationRoom.name}. It is ${destinationRoom.landmark}.` });
    return steps;
  }, [routeRooms, hindi]);
  const currentStepIndex = directionSteps.length ? Math.min(directionSteps.length - 1, Math.floor(progress * Math.max(1, directionSteps.length))) : -1;
  const currentStep = currentStepIndex >= 0 ? directionSteps[currentStepIndex] : undefined;
  const nearestOf = (nodes: string[]) => nodes.map((id) => ({ id, metres: routeDistance(map, findRoute(map, start, id, accessible)) })).filter((item) => item.metres > 0 || item.id === start).sort((a, b) => a.metres - b.metres)[0]?.id ?? nodes[0];
  const shortcuts = [
    { id: nearestOf(['toilet0', 'toilet1']), title: hindi ? 'नज़दीकी शौचालय' : 'Nearest washroom', icon: '♧' },
    { id: nearestOf(['lift0', 'lift1', 'lift2']), title: hindi ? 'नज़दीकी लिफ्ट' : 'Nearest lift', icon: '↕' },
    { id: 'room3', title: 'OPD', icon: '✚' },
    { id: 'ward4', title: hindi ? 'वार्ड' : 'Ward', icon: '▤' },
    { id: 'lab', title: hindi ? 'लैब' : 'Lab', icon: '⚗' },
  ];
  const setDestAndReset = (id: string) => { setDestination(id); setProgress(0); setPlaying(false); };
  const voice = () => { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(directionSteps.map((step) => step.text).join(' ')); utterance.lang = hindi ? 'hi-IN' : 'en-IN'; speechSynthesis.speak(utterance); };
  const play = () => { if (!route.length) return; if (progress >= 1) setProgress(0); setPlaying(true); };
  const stepForward = (direction: string) => {
    if (draggingPerson) return;
    setPlaying(false);
    const node = currentRoom?.node ?? start;
    const neighbors = map.edges.flatMap(([from, to, , kind]) => {
      if (accessible && kind === 'stairs') return [];
      if (from === node) return [to]; if (to === node) return [from]; return [];
    }).filter((id) => {
      const a = roomsByNode.get(node); const b = roomsByNode.get(id); if (!a || !b) return false;
      if (a.floor !== b.floor) return a.floor < b.floor ? direction === 'up' : direction === 'down';
      const p = portal(a); const q = portal(b); const dx = q.x - p.x; const dy = q.y - p.y;
      const bearing = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'down' : 'up';
      return bearing === direction;
    });
    if (!neighbors.length) {
      setGameMessage(hindi ? 'उस दिशा में चलने योग्य रास्ता नहीं है।' : 'There is no walkable corridor in that direction.');
      return;
    }
    const nextNode = neighbors.sort((a, b) => routeDistance(map, findRoute(map, a, destination, accessible)) - routeDistance(map, findRoute(map, b, destination, accessible)))[0];
    setGameMessage('');
    setWalking(true); if (walkTimer.current !== null) window.clearTimeout(walkTimer.current); walkTimer.current = window.setTimeout(() => setWalking(false), 460);
    setStart(nextNode); setProgress(0); setFloor(roomsByNode.get(nextNode)?.floor ?? floor);
  };
  const pointerDown = (event: React.PointerEvent<SVGSVGElement>) => { if (draggingPerson) return; setDrag({ x: event.clientX, y: event.clientY, ox: pan.x, oy: pan.y }); event.currentTarget.setPointerCapture(event.pointerId); };
  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPerson) {
      const svg = event.currentTarget; const screenPoint = svg.createSVGPoint(); screenPoint.x = event.clientX; screenPoint.y = event.clientY;
      const matrix = svg.getScreenCTM(); if (!matrix) return;
      const local = screenPoint.matrixTransform(matrix.inverse());
      const x = (local.x - pan.x - 420) / zoom + 420; const y = (local.y - pan.y - 320) / zoom + 320;
      const nearest = nearestWalkPoint(floor, x, y); if (nearest) setDragPosition(nearest);
      return;
    }
    if (drag) setPan({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
  };
  const pointerUp = () => {
    if (draggingPerson && dragPosition) {
      setStart(dragPosition.node); setProgress(0); setPlaying(false); setFloor(roomsByNode.get(dragPosition.node)?.floor ?? floor);
      setGameMessage(hindi ? `${label(roomsByNode.get(dragPosition.node), true)} पर खिलाड़ी की जगह अपडेट हुई।` : `Player moved to ${roomsByNode.get(dragPosition.node)?.name ?? 'the corridor'}; route updated.`);
      setWalking(true); if (walkTimer.current !== null) window.clearTimeout(walkTimer.current); walkTimer.current = window.setTimeout(() => setWalking(false), 420);
    }
    setDraggingPerson(false); setDragPosition(null); setDrag(null);
  };
  const beginPersonDrag = (event: React.PointerEvent<SVGGElement>) => {
    event.stopPropagation(); event.preventDefault(); setPlaying(false); setDrag(null); setDraggingPerson(true);
    const svg = event.currentTarget.ownerSVGElement; if (svg) svg.setPointerCapture(event.pointerId);
    const nearest = nearestWalkPoint(floor, at?.point.x ?? 0, at?.point.y ?? 0); if (nearest) setDragPosition(nearest);
  };

  return <section className="wayfinder" aria-label={hindi ? 'अस्पताल रास्ता खोजक' : 'Hospital wayfinder'} onKeyDown={(event) => { const tag = (event.target as HTMLElement).tagName; if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return; const keys: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }; if (keys[event.key]) { event.preventDefault(); stepForward(keys[event.key]); } }}>
    <div className="wf-top"><div><span className="wf-kicker">{hindi ? 'गेम-शैली अस्पताल रास्ता' : 'GAME-STYLE HOSPITAL WAYFINDER'}</span><h2>{hindi ? 'आपको कहाँ जाना है?' : 'Where do you need to go?'}</h2><p>{map.hospital} · {hindi ? 'उदाहरण के लिए बना नक्शा · गति नियंत्रण से' : 'Illustrative map · movement is controlled in the game'}</p></div><div className="wf-position"><span className="wf-pulse"/>{hindi ? 'खिलाड़ी की जगह' : 'PLAYER POSITION'}<small>{hindi ? 'सिमुलेशन' : 'SIMULATED'}</small></div></div>

    <div className="wf-search-row"><label className="wf-select"><span>{hindi ? 'कहाँ से' : 'Starting point'}</span><select value={start} onChange={(event) => { setStart(event.target.value); setProgress(0); setPlaying(false); setFloor(roomsByNode.get(event.target.value)?.floor ?? 0); }} aria-label={hindi ? 'शुरुआती जगह चुनें' : 'Choose starting point'}><option value="gate">{hindi ? 'मुख्य द्वार / सामने का गेट' : 'Front gate (default)'}</option>{map.rooms.map((room) => <option key={room.node} value={room.node}>{label(room, hindi)}</option>)}</select></label><label className="wf-select"><span>{hindi ? 'खोजें या गंतव्य चुनें' : 'Search or choose destination'}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={hindi ? 'जैसे OPD, शौचालय, वार्ड 4' : 'e.g. OPD, washroom, Ward 4'}/><select value={destination} onChange={(event) => setDestAndReset(event.target.value)} aria-label={hindi ? 'गंतव्य चुनें' : 'Choose destination'}>{map.rooms.filter((room) => room.node !== 'gate' && !room.node.startsWith('stairs') && `${room.name} ${label(room, hindi)}`.toLowerCase().includes(query.toLowerCase())).map((room) => <option key={room.node} value={room.node}>{label(room, hindi)}</option>)}</select></label></div>
    <div className="wf-shortcuts" aria-label={hindi ? 'त्वरित गंतव्य' : 'Quick destinations'}>{shortcuts.map((shortcut) => <button className={destination === shortcut.id ? 'active' : ''} key={shortcut.id} onClick={() => setDestAndReset(shortcut.id)}><span aria-hidden="true">{shortcut.icon}</span>{shortcut.title}</button>)}</div>
    <div className="wf-location-share"><button onClick={() => setShowQR((value) => !value)}><QrCode size={18}/>{hindi ? 'मेरी जगह का QR' : 'Share this starting point'}</button>{showQR && <div className="wf-qr-share"><div className="wf-qr-card"><QRCodeSVG value={`${qrOrigin}/find?start=${encodeURIComponent(currentRoom?.node ?? start)}`} size={112} level="M"/><span><b>{hindi ? 'शुरुआती जगह का QR' : 'Starting point QR'}</b>{hindi ? `${currentRoom ? label(currentRoom, true) : 'आपकी जगह'} से रास्ता शुरू करें।` : `Opens directions from ${currentRoom?.name ?? 'this location'}.`}</span></div><label className="wf-qr-origin"><span>{hindi ? 'इस डिवाइस का पता' : 'Address for the other device'}</span><input type="url" value={qrBase} onChange={(event) => setQrBase(event.target.value)} placeholder="http://192.168.1.25:5173" aria-label={hindi ? 'दूसरे डिवाइस के लिए ऐप पता' : 'App address for the other device'}/></label>{qrUsesLoopback && <p className="wf-qr-warning"><b>{hindi ? 'यह QR केवल इसी कंप्यूटर पर खुलेगा।' : 'This QR currently points to localhost.'}</b> {hindi ? 'फ़ोन पर चलाने के लिए कंप्यूटर का Wi-Fi IP पता भरें; दोनों डिवाइस एक ही Wi-Fi पर हों।' : 'On your phone, replace localhost with your computer’s Wi‑Fi address, for example http://192.168.1.25:5173. Keep both devices on the same Wi‑Fi and run Vite with --host 0.0.0.0.'}</p>}</div>}</div>
    <label className="wf-access"><input type="checkbox" checked={accessible} onChange={(event) => { setAccessible(event.target.checked); setProgress(0); }} /><Accessibility size={19}/>{hindi ? 'सुलभ रास्ता (सीढ़ियाँ नहीं)' : 'Accessible route (avoid stairs)'}<span>{hindi ? 'लिफ्ट और रैंप का उपयोग' : 'Uses lifts and ramps'}</span></label>

      <div className="wf-mode-switch" role="group" aria-label={hindi ? 'दृश्य चुनें' : 'Choose navigation view'}><button className={gameMode === '3d' ? 'active' : ''} onClick={() => setGameMode('3d')}>{hindi ? '3D गेम खेलें' : '3D game'}</button><button className={gameMode === 'map' ? 'active' : ''} onClick={() => setGameMode('map')}>{hindi ? 'ऊपर से नक्शा' : 'Top-down map'}</button><span>{hindi ? 'जॉयस्टिक या WASD से खिलाड़ी चलाएँ' : 'Move with the joystick or WASD'}</span></div>
      {gameMode === '3d' && <Suspense fallback={<div className="h3d-loading">Preparing the hospital game world…</div>}><HospitalGame3D hospital={map} start={start} destination={destination} accessible={accessible} floor={floor} hindi={hindi} onNodeChange={(node) => { setStart(node); setProgress(0); }} onFloorChange={setFloor} onProgressChange={setProgress} onMovementStart={() => setPlaying(false)} /></Suspense>}

      <section className="wf-walkthrough" aria-label={hindi ? 'चलने का दृश्य' : 'Walkthrough view'}><div className="wf-walkthrough-head"><div><span className="wf-kicker">{hindi ? 'चलने का दृश्य' : 'WALKTHROUGH VIEW'}</span><b>{hindi ? `खिलाड़ी: ${currentRoom ? label(currentRoom, true) : 'रास्ते पर'}` : `Player at ${currentRoom?.name ?? 'the route'}`}</b><small>{progress > .78 ? hindi ? 'दरवाज़ा खुल रहा है · अगला मोड़ देखें' : 'Door opening · follow the next turn' : hindi ? 'रास्ते पर चलें; दरवाज़े के पास दिशा बदलें' : 'Walk the route; the door opens as you arrive'}</small></div><span className={`wf-door-status ${progress > .78 ? 'open' : ''}`}>{progress > .78 ? (hindi ? 'दरवाज़ा खुला' : 'DOOR OPEN') : (hindi ? 'दरवाज़ा बंद' : 'DOOR AHEAD')}</span></div><svg className="wf-room-view" viewBox="0 0 760 250" role="img" aria-label={hindi ? 'सामने का दरवाज़ा और आगे का रास्ता' : 'First-person corridor view with a door and turn cue'}><defs><linearGradient id="wf-wall" x2="0" y2="1"><stop stopColor="#f7f7f0"/><stop offset="1" stopColor="#dbe6df"/></linearGradient><linearGradient id="wf-floor" x2="0" y2="1"><stop stopColor="#d3dfd7"/><stop offset="1" stopColor="#aebeb4"/></linearGradient></defs><rect width="760" height="250" fill="url(#wf-wall)"/><path d="M0 175 L270 113 H490 L760 175 V250 H0z" fill="url(#wf-floor)"/><path d="M0 0 L270 113 M760 0 L490 113 M380 115V250 M185 132L95 250 M575 132L665 250" fill="none" stroke="#fff" strokeWidth="3" opacity=".8"/><path d="M300 113V28h160v85" fill="#c4d1c9" stroke="#6d8277" strokeWidth="4"/><g className={`wf-door ${progress > .78 ? 'opening' : ''}`} transform={`translate(${380 * (1 - (.72 + progress * .42))} ${70 * (1 - (.72 + progress * .42))}) scale(${.72 + progress * .42})`}><path d="M310 112V34h140v78z" fill="#986d4c" stroke="#694b37" strokeWidth="4"/><path d="M324 104V46h112v58z" fill="#ad805b" stroke="#c59b72" strokeWidth="3"/><circle cx="423" cy="75" r="4" fill="#f0d188"/></g><path d="M380 171l-24 30h16v18h16v-18h16z" fill="#2484dc" className="wf-view-arrow"/><g className={`wf-view-person ${playing || walking ? 'walking' : ''}`} transform="translate(380 226)"><circle cy="-28" r="9" fill="#f3bd8c" stroke="#543c32" strokeWidth="2"/><path d="M0 -17v24m-12 -12h24m-12 12l-9 16m9-16l9 16" stroke="#255d96" strokeWidth="7" strokeLinecap="round"/></g><text x="380" y="18" textAnchor="middle" className="wf-view-sign">{label(roomsByNode.get(destination), hindi)} · {map.floors[roomsByNode.get(destination)?.floor ?? 0].label}</text></svg><div className="wf-game-controls"><div className="wf-dpad" aria-label={hindi ? 'दिशा नियंत्रण' : 'Direction controls'}><button className={nextDirection === 'up' ? 'correct' : ''} aria-label="Move forward" onClick={() => stepForward('up')}><ArrowUp/></button><button className={nextDirection === 'left' ? 'correct' : ''} aria-label="Move left" onClick={() => stepForward('left')}><ArrowLeft/></button><button className={nextDirection === 'down' ? 'correct' : ''} aria-label="Move down" onClick={() => stepForward('down')}><ArrowDown/></button><button className={nextDirection === 'right' ? 'correct' : ''} aria-label="Move right" onClick={() => stepForward('right')}><ArrowRight/></button></div><span>{hindi ? `अगला कदम: ${nextDirection === 'up' ? 'सीधे' : nextDirection === 'left' ? 'बाएँ' : nextDirection === 'right' ? 'दाएँ' : 'नीचे'}` : `Next move: ${nextDirection === 'up' ? 'forward' : nextDirection}`}</span><small>{hindi ? 'कोई GPS नहीं · केवल गेम नियंत्रण' : 'No GPS or motion tracking · game controls only'}</small>{gameMessage && <small role="status">{gameMessage}</small>}<kbd>↑ ↓ ← →</kbd></div></section>

      {gameMode === 'map' && <div className="wf-map-card">
      <div className="wf-map-toolbar"><div className="wf-floor-switch" aria-label="Floor selector">{map.floors.map((item) => <button key={item.level} className={floor === item.level ? 'selected' : ''} onClick={() => setFloor(item.level)}>{hindi ? ['भूतल','पहली मंजिल','दूसरी मंजिल'][item.level] : item.label}</button>)}</div><div className="wf-zoom"><button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(.8, z - .15))}><Minus size={18}/></button><button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.8, z + .15))}><Plus size={18}/></button><button aria-label="Center on you" onClick={() => setPan({ x: 0, y: 0 })}><LocateFixed size={18}/></button></div></div>
      {!route.length ? <div className="wf-no-route">{hindi ? 'इस गंतव्य तक कोई रास्ता उपलब्ध नहीं है।' : 'No route is available to this destination.'}</div> : <svg className="wf-floor-svg" viewBox="0 0 840 640" role="img" aria-label={`${map.floors[floor].label} map · ${label(roomsByNode.get(destination), hindi)}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        <defs><pattern id="wf-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dce8e2" strokeWidth=".7"/></pattern><marker id="wf-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#3684e8"/></marker></defs>
        <g className="wf-camera" transform={`translate(${pan.x} ${pan.y}) translate(420 320) scale(${zoom}) translate(-420 -320)`}><rect width="840" height="640" fill="url(#wf-grid)"/>
          {map.corridors.filter((corridor) => corridor.floor === floor).map((corridor) => <g key={corridor.id}><path d={corridor.path} fill="none" stroke="#d0ddd7" strokeWidth="28" strokeLinecap="round"/><path d={corridor.path} fill="none" stroke="#fff" strokeWidth="20" strokeLinecap="round"/></g>)}
          {map.edges.map(([from, to, , kind]) => { const a = roomsByNode.get(from)!; const b = roomsByNode.get(to)!; if (a.floor !== floor || b.floor !== floor) return null; const p = portal(a); const q = portal(b); return <line key={`${from}-${to}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={`wf-graph-edge ${kind}`} />; })}
          {routeRooms.slice(1).map((room, index) => { const prev = routeRooms[index]; if (room.floor !== floor || prev.floor !== floor) return null; const a = portal(prev); const b = portal(room); return <line key={`route-${prev.node}-${room.node}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="wf-route-line" markerEnd="url(#wf-arrow)"/>; })}
          {map.rooms.filter((room) => room.floor === floor).map((room) => { const p = center(room); const isDestination = room.node === destination; const isStart = room.node === start; const door = map.doors.find((item) => item.node === room.node); const x1 = door?.side === 'west' ? room.x : door?.side === 'east' ? room.x + room.width : p.x - 8; const x2 = door?.side === 'west' ? room.x : door?.side === 'east' ? room.x + room.width : p.x + 8; const y1 = door?.side === 'north' ? room.y : door?.side === 'south' ? room.y + room.height : p.y - 8; const y2 = door?.side === 'north' ? room.y : door?.side === 'south' ? room.y + room.height : p.y + 8; return <g key={room.node} className={`wf-room ${room.type} ${isDestination ? 'destination' : ''}`}><rect x={room.x} y={room.y} width={room.width} height={room.height} rx="13" fill={colors[room.type] || '#fff'} /><text x={p.x} y={p.y - 2} textAnchor="middle" className="wf-room-name">{label(room, hindi)}</text><text x={p.x} y={p.y + 17} textAnchor="middle" className="wf-room-landmark">{room.landmark}</text>{door && <line x1={x1} y1={y1} x2={x2} y2={y2} className={`wf-map-door ${isDestination && progress > .78 ? 'open' : ''}`} />}{isDestination && <><path d={`M ${p.x} ${room.y - 12} l -9 -15 h 18 z`} className="wf-destination-pin"/><circle cx={p.x} cy={room.y - 30} r="4" fill="#fff"/></>}{isStart && <circle cx={portal(room).x} cy={portal(room).y} r="7" className="wf-start-dot"/>}</g>; })}
          {visiblePosition?.room?.floor === floor && !reducedMotion && <g className={`wf-person ${draggingPerson ? 'is-dragging' : ''}`} transform={`translate(${visiblePosition.point.x} ${visiblePosition.point.y}) rotate(${visiblePosition.angle})`} onPointerDown={beginPersonDrag} style={{ cursor: draggingPerson ? 'grabbing' : 'grab', touchAction: 'none' }} role="button" tabIndex={0} aria-label={hindi ? 'खिलाड़ी को पकड़कर रास्ते पर खींचें' : 'Drag player along the walkable paths'}><circle r="22" className="wf-person-halo"/><circle cy="-6" r="7" className="wf-person-head"/><path d="M0 2v15 M-9 8h18 M0 17l-7 10 M0 17l7 10" className="wf-person-body"/><path d="M0 -34 L-8 -21 H8 Z" className="wf-person-direction"/><text x="0" y="43" textAnchor="middle" className="wf-you-label">{hindi ? 'खिलाड़ी' : 'PLAYER'}</text></g>}
          {visiblePosition?.room?.floor === floor && reducedMotion && <g className="wf-person" transform={`translate(${visiblePosition.point.x} ${visiblePosition.point.y})`} onPointerDown={beginPersonDrag} style={{ cursor: draggingPerson ? 'grabbing' : 'grab', touchAction: 'none' }} role="button" tabIndex={0} aria-label={hindi ? 'खिलाड़ी को पकड़कर रास्ते पर खींचें' : 'Drag player along the walkable paths'}><circle r="20" className="wf-start-dot"/><path d="M-5 4 L0 -7 L5 4 Z" className="wf-static-arrow"/></g>}
        </g>
      </svg>}
      <div className="wf-map-legend"><span><i className="wf-legend-you"/>{hindi ? 'खिलाड़ी की जगह' : 'Player position'}</span><span><i className="wf-legend-dest"/>{hindi ? 'गंतव्य' : 'Destination'}</span><span><i className="wf-legend-route"/>{hindi ? 'सुझाया गया रास्ता' : 'Suggested route'}</span><span className="wf-drag-hint">{hindi ? 'नक्शा खींचें · ज़ूम करें' : 'Drag map · use zoom controls'}</span></div>
      </div>}

    <section className="wf-guidance"><div className="wf-route-summary"><div><span className="wf-summary-icon"><Navigation size={20}/></span><div><b>{hindi ? `शेष ${remainingDistance} मीटर · लगभग ${Math.floor(etaSeconds / 60)} मिनट ${etaSeconds % 60} सेकंड` : `${remainingDistance} m left · about ${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`}</b><small>{hindi ? `${directionSteps.length} निर्देश · ${map.floors[roomsByNode.get(destination)?.floor ?? 0].label}` : `${directionSteps.length} steps · ${map.floors[roomsByNode.get(destination)?.floor ?? 0].label}`}</small></div></div><label className="wf-motion-toggle"><input type="checkbox" checked={reducedMotion} onChange={(event) => { setReducedMotion(event.target.checked); if (event.target.checked) setPlaying(false); }}/>{hindi ? 'कम गति' : 'Reduced motion'}</label></div>
      <div className="wf-next-instruction"><span className={`wf-next-arrow ${currentStep?.icon ?? 'arrive'}`}>{currentStep?.icon === 'left' ? <ArrowLeft size={29}/> : currentStep?.icon === 'right' ? <ArrowRight size={29}/> : currentStep?.icon === 'lift' ? <span>↕</span> : currentStep?.icon === 'arrive' ? <LocateFixed size={27}/> : <ArrowUp size={29}/>}</span><div><small>{hindi ? 'अगला कदम' : 'NEXT STEP'}</small><b>{currentStep?.text ?? (hindi ? 'आप पहुँच गए हैं' : 'You have arrived')}</b><span>{hindi ? 'दिशा तीरों का अनुसरण करें या आवाज़ सुनें' : 'Follow the large arrow or turn on voice guidance'}</span></div></div>
      <div className="wf-route-progress" role="progressbar" aria-label={hindi ? 'रास्ते की प्रगति' : 'Route progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{width:`${Math.round(progress * 100)}%`}}/></div>
      <div className="wf-controls"><button className="wf-play" onClick={playing ? () => setPlaying(false) : play}>{playing ? <Pause size={19}/> : <Play size={19}/>} {playing ? (hindi ? 'रोकें' : 'Pause') : (hindi ? 'चलाएँ' : 'Play route')}</button><button onClick={() => { setPlaying(false); setProgress(0); setFloor(1); }}><RotateCcw size={18}/>{hindi ? 'फिर से' : 'Replay'}</button><label>{hindi ? 'गति' : 'Speed'}<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="0.6">0.6×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button onClick={voice}><Volume2 size={18}/>{hindi ? 'सुनें' : 'Voice guide'}</button></div>
      {directionSteps.length > 0 && <ol className="wf-steps">{directionSteps.map((step, index) => <li key={`${index}-${step.text}`} className={index === currentStepIndex ? 'current' : ''}><span className="wf-step-icon">{step.icon === 'left' ? <ArrowLeft/> : step.icon === 'right' ? <ArrowRight/> : step.icon === 'lift' ? <span>↕</span> : step.icon === 'arrive' ? <LocateFixed/> : <ArrowUp/>}</span><span>{step.text}</span></li>)}</ol>}
    </section>

    <div className="wf-drone-card"><div className="wf-drone-head"><span className="wf-drone-icon">✦</span><div><b>{hindi ? 'अस्पताल तक पहुँचने का दृश्य' : 'Hospital approach preview'}</b><small>{hindi ? 'काल्पनिक परिसर · प्रवेश से गंतव्य तक' : 'Fictional campus · animated overhead approach'}</small></div><span className="wf-sample-badge">{hindi ? 'नमूना' : 'SAMPLE'}</span></div><svg className={`wf-campus ${playing ? 'moving' : ''}`} viewBox="0 0 760 220" role="img" aria-label={hindi ? 'काल्पनिक अस्पताल का ऊपर से दृश्य' : 'Illustrative overhead view of the fictional hospital'}><defs><linearGradient id="wf-grass" x2="0" y2="1"><stop stopColor="#e1f1e5"/><stop offset="1" stopColor="#cbe2d1"/></linearGradient></defs><rect width="760" height="220" rx="18" fill="url(#wf-grass)"/><path d="M-20 183 C140 145 192 223 340 180 S550 150 790 184" fill="none" stroke="#b0b9a4" strokeWidth="34"/><path d="M-20 183 C140 145 192 223 340 180 S550 150 790 184" fill="none" stroke="#fff8dd" strokeWidth="2" strokeDasharray="12 12"/><path d="M238 78l142-52 146 52v104H238z" fill="#fffdf7" stroke="#668e7f" strokeWidth="3"/><path d="M218 80l162-62 165 62h-34L380 35 252 80z" fill="#22796d"/><rect x="350" y="116" width="60" height="66" rx="5" fill="#71a395"/>{[0,1,2].map((r) => [0,1,2,3].map((c) => <rect key={`${r}-${c}`} x={263 + c * 43} y={92 + r * 25} width="21" height="14" rx="3" fill="#8db8aa" stroke="#fff" strokeWidth="2"/>))}<text x="380" y="72" textAnchor="middle" className="wf-campus-title">CITY DISTRICT HOSPITAL</text><circle cx="75" cy="166" r="11" fill="#1c806b" stroke="#fff" strokeWidth="4"/><text x="75" y="204" textAnchor="middle">ENTRANCE</text><circle cx="650" cy="145" r="11" fill="#e15c4e" stroke="#fff" strokeWidth="4"/><text x="650" y="178" textAnchor="middle">DESTINATION</text><path d="M75 166 C180 145 175 177 256 158 C360 134 440 177 520 150 C565 135 602 141 650 145" fill="none" stroke="#fff" strokeWidth="8"/><path d="M75 166 C180 145 175 177 256 158 C360 134 440 177 520 150 C565 135 602 141 650 145" fill="none" stroke="#ed8a45" strokeWidth="3" strokeDasharray="8 10" className="wf-flight-path"/><g className="wf-drone"><circle r="9" fill="#123f3b" stroke="#fff" strokeWidth="3"/><path d="M-14 0h28M0-10v20" stroke="#123f3b" strokeWidth="3"/></g></svg></div>
  </section>;
}

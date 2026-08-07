import * as turf from '@turf/turf';

// London Congestion Charge — £18/day from 2 Jan 2026.
// Charging hours: Mon–Fri 07:00–18:00; Sat/Sun/bank holidays 12:00–18:00.
export const CONGESTION_CHARGE = 18;
export const ULEZ_CHARGE = 12.5;

// Approximate Congestion Charge Zone boundary, traced from the official
// boundary roads (Pentonville Rd, City Rd, Commercial St, Mansell St,
// Tower Bridge Rd, New Kent Rd, Elephant & Castle, Kennington Ln,
// Vauxhall Bridge Rd, Park Lane, Edgware Rd, Marylebone/Euston Rd).
// Coordinates are [lng, lat] for turf. This is close enough to prompt the
// driver — they always confirm before the charge is recorded.
const CCZ_POLYGON = turf.polygon([[
  [-0.1635, 51.5165], // Edgware Rd
  [-0.1430, 51.5250], // Euston Rd (Warren St)
  [-0.1200, 51.5305], // Euston Rd / King's Cross
  [-0.1055, 51.5300], // Pentonville / Angel
  [-0.0880, 51.5255], // City Rd / Old St
  [-0.0790, 51.5210], // Old St / Commercial St
  [-0.0730, 51.5145], // Commercial St / Aldgate / Mansell St
  [-0.0785, 51.5040], // Tower Bridge Rd (north)
  [-0.0870, 51.4960], // Tower Bridge Rd / New Kent Rd
  [-0.1000, 51.4945], // New Kent Rd / Elephant & Castle
  [-0.1120, 51.4900], // Kennington Ln / Elephant
  [-0.1230, 51.4880], // Kennington Ln / Vauxhall
  [-0.1310, 51.4915], // Vauxhall Bridge Rd
  [-0.1420, 51.4955], // Vauxhall Bridge Rd / Victoria
  [-0.1520, 51.5015], // Grosvenor Pl / Hyde Park Corner
  [-0.1590, 51.5130], // Park Lane / Marble Arch
  [-0.1635, 51.5165]  // close ring
]]);

/** True if [lat, lng] falls inside the Congestion Charge Zone. */
export function isInCongestionZone(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  try {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), CCZ_POLYGON);
  } catch (e) {
    return false;
  }
}

/**
 * True if the Congestion Charge applies at the given time, in London time.
 * Mon–Fri 07:00–18:00; Sat/Sun 12:00–18:00. (Bank holidays follow the
 * weekend window but aren't enumerated here — the driver confirms anyway.)
 */
export function isCongestionChargingNow(date = new Date()) {
  // Get London wall-clock hour/day regardless of device timezone
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hour12: false
  }).formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const start = isWeekend ? 12 : 7;
  return hour >= start && hour < 18;
}

/**
 * Returns a suggested Congestion Charge expense if any of the given points
 * is inside the zone during charging hours, else null.
 * points: array of [lat, lng].
 */
export function suggestCongestionCharge(points = [], date = new Date()) {
  const inside = points.some(p => p && isInCongestionZone(p[0], p[1]));
  if (inside && isCongestionChargingNow(date)) {
    return { type: 'Congestion Charge', amount: CONGESTION_CHARGE };
  }
  return null;
}

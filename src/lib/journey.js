/**
 * The ride journey, as a machine that goes both ways.
 *
 * Jobs don't run in a straight line: drivers mis-swipe, and passengers get out
 * at a stop, keep the car waiting, and get back in. Every action here has an
 * inverse, and reverting is recorded as its own event rather than quietly
 * rewriting history.
 *
 * A passenger waiting at a stop is still an in-progress ride, so that sub-state
 * lives in rides.metadata and the ride_status enum is left alone — the status
 * filters in the passenger app, driver app and dashboard keep working as-is.
 *
 * Shape of the metadata this owns:
 *   pax_on_board       bool    — is the passenger physically in the car
 *   current_stop_index int     — how many scheduled waypoints are done
 *   open_stop          object  — the wait currently running: { index, name, off_at }
 *   stop_waits         array   — completed waits: [{ index, name, off_at, on_at, mins }]
 */

const minsBetween = (from, to) =>
  Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));

const short = (name, n = 18) =>
  !name ? 'stop' : (name.length > n ? `${name.slice(0, n)}…` : name);

export function readJourney(ride) {
  const meta = ride?.metadata || {};
  const waypoints = (ride?.waypoints?.length ? ride.waypoints : meta.waypoints) || [];
  return {
    status: ride?.status,
    waypoints,
    stopIndex: meta.current_stop_index || 0,
    // Only meaningful once the passenger has actually boarded
    paxOnBoard: ride?.status === 'in_progress' ? meta.pax_on_board !== false : false,
    openStop: meta.open_stop || null,
    stopWaits: meta.stop_waits || []
  };
}

/** The main "required next step". */
export function forwardAction(ride) {
  const j = readJourney(ride);
  switch (j.status) {
    case 'dispatched':
      return { key: 'start', label: 'Start Journey to Pickup' };
    case 'en_route':
      return { key: 'arrive', label: 'Arrived at Pickup' };
    case 'arrived':
      return { key: 'pob', label: 'Passenger On Board' };
    case 'in_progress': {
      if (!j.paxOnBoard) return { key: 'reboard', label: 'Passenger Back On Board' };
      if (j.stopIndex < j.waypoints.length) {
        return { key: 'stop', label: `Arrived at ${short(j.waypoints[j.stopIndex]?.name)}` };
      }
      return { key: 'complete', label: 'Complete Booking', variant: 'accent' };
    }
    default:
      return null;
  }
}

/**
 * Undo of the single most recent step. Completion is deliberately not
 * reversible from the driver app — reopening a closed, billed job is an
 * Operations decision.
 */
export function backAction(ride) {
  const j = readJourney(ride);
  switch (j.status) {
    case 'en_route':
      return { key: 'undo_start', label: 'Not started yet' };
    case 'arrived':
      return { key: 'undo_arrive', label: 'Not arrived yet' };
    case 'in_progress': {
      if (!j.paxOnBoard) return { key: 'undo_alight', label: 'Passenger never got out' };
      if (j.stopWaits.length) {
        const last = j.stopWaits[j.stopWaits.length - 1];
        return { key: 'undo_reboard', label: `Still waiting at ${short(last.name, 12)}` };
      }
      return { key: 'undo_pob', label: 'Not on board yet' };
    }
    default:
      return null;
  }
}

/**
 * The unscheduled stop — the passenger decides to hop out somewhere that was
 * never on the itinerary. Offered whenever they're aboard with no scheduled
 * stop pending (a pending stop has its own forward action).
 */
export function stepOutAction(ride) {
  const j = readJourney(ride);
  if (j.status !== 'in_progress' || !j.paxOnBoard) return null;
  if (j.stopIndex < j.waypoints.length) return null;
  return { key: 'alight', label: 'Passenger stepped out' };
}

/**
 * Turn an action into the database write plus the event to log.
 * Returns { ridePatch, metadata, event } — the caller owns the actual write.
 */
export function applyAction(ride, key, { now = new Date().toISOString(), coords = null } = {}) {
  const j = readJourney(ride);
  const meta = { ...(ride?.metadata || {}) };
  const patch = {};
  let event = null;

  const at = coords ? { lat: coords.lat, lng: coords.lng } : {};
  const fwd = (type, from, to, extra = {}) => ({ event_type: type, from_state: from, to_state: to, direction: 'forward', ...at, ...extra });
  const back = (from, to, extra = {}) => ({ event_type: 'step_reverted', from_state: from, to_state: to, direction: 'back', ...at, ...extra });

  // Waiting minutes are always recomputed from their parts rather than
  // incremented, so an undo can't leave the billing total drifting.
  const retotal = () => {
    const stopTotal = (meta.stop_waits || []).reduce((sum, w) => sum + (w.mins || 0), 0);
    patch.stop_wait_mins = stopTotal;
    patch.total_waiting_time_mins =
      (patch.wait_time_mins !== undefined ? patch.wait_time_mins : (ride?.wait_time_mins || 0)) + stopTotal;
  };

  switch (key) {
    case 'start': {
      patch.status = 'en_route';
      if (!ride?.acknowledged_at) patch.acknowledged_at = now;
      event = fwd('status_change', 'dispatched', 'en_route');
      break;
    }
    case 'arrive': {
      patch.status = 'arrived';
      patch.arrived_at = now;
      event = fwd('status_change', 'en_route', 'arrived');
      break;
    }
    case 'pob': {
      patch.status = 'in_progress';
      patch.pob_at = now;
      patch.wait_time_mins = minsBetween(ride?.arrived_at || now, now);
      meta.pax_on_board = true;
      retotal();
      event = fwd('status_change', 'arrived', 'in_progress', { wait_mins: patch.wait_time_mins });
      break;
    }

    // Passenger out of the vehicle — scheduled stop or not, the clock starts.
    case 'stop':
    case 'alight': {
      const scheduled = key === 'stop' ? j.waypoints[j.stopIndex] : null;
      meta.pax_on_board = false;
      meta.open_stop = {
        index: scheduled ? j.stopIndex : null,
        name: scheduled?.name || 'Unscheduled stop',
        off_at: now
      };
      event = fwd(scheduled ? 'stop_arrived' : 'pax_alighted', 'on_board', 'waiting', {
        stop_index: meta.open_stop.index,
        stop_name: meta.open_stop.name
      });
      break;
    }

    case 'reboard': {
      const open = j.openStop;
      if (!open) break;
      const mins = minsBetween(open.off_at, now);
      meta.stop_waits = [...(meta.stop_waits || []), { ...open, on_at: now, mins }];
      meta.open_stop = null;
      meta.pax_on_board = true;
      // Only a scheduled stop advances the itinerary
      if (open.index !== null && open.index !== undefined) {
        meta.current_stop_index = open.index + 1;
      }
      retotal();
      event = fwd('pax_reboarded', 'waiting', 'on_board', {
        stop_index: open.index, stop_name: open.name, wait_mins: mins
      });
      break;
    }

    case 'complete': {
      patch.status = 'completed';
      patch.dropoff_at = now;
      event = fwd('status_change', 'in_progress', 'completed');
      break;
    }

    // ---- reversals ---------------------------------------------------------

    case 'undo_start': {
      patch.status = 'dispatched';
      event = back('en_route', 'dispatched');
      break;
    }
    case 'undo_arrive': {
      patch.status = 'en_route';
      patch.arrived_at = null;
      event = back('arrived', 'en_route');
      break;
    }
    case 'undo_pob': {
      patch.status = 'arrived';
      patch.pob_at = null;
      patch.wait_time_mins = 0;
      meta.pax_on_board = false;
      retotal();
      event = back('in_progress', 'arrived');
      break;
    }
    case 'undo_alight': {
      // They never actually got out — drop the open wait entirely so no time
      // is billed for it.
      const open = j.openStop;
      meta.open_stop = null;
      meta.pax_on_board = true;
      event = back('waiting', 'on_board', { stop_index: open?.index ?? null, stop_name: open?.name || null });
      break;
    }
    case 'undo_reboard': {
      // Reopen the wait that was just closed, at its original start time.
      const waits = [...(meta.stop_waits || [])];
      const last = waits.pop();
      if (!last) break;
      meta.stop_waits = waits;
      meta.open_stop = { index: last.index, name: last.name, off_at: last.off_at };
      meta.pax_on_board = false;
      if (last.index !== null && last.index !== undefined) {
        meta.current_stop_index = last.index;
      }
      retotal();
      event = back('on_board', 'waiting', { stop_index: last.index, stop_name: last.name });
      break;
    }

    default:
      return null;
  }

  if (!event) return null;
  patch.metadata = meta;
  return { ridePatch: patch, event };
}

/** Human-readable line for the chat trail and the dashboard timeline. */
export function describeEvent(e) {
  const where = e.stop_name ? ` at ${e.stop_name}` : '';
  switch (e.event_type) {
    case 'status_change':
      return {
        dispatched: 'Job re-opened as dispatched',
        en_route: 'Driver en route to pickup',
        arrived: 'Driver is on location',
        in_progress: 'Passenger On Board (POB)',
        completed: 'Booking completed'
      }[e.to_state] || `Status: ${e.to_state}`;
    case 'stop_arrived':   return `Arrived at stop${where}`;
    case 'pax_alighted':   return `Passenger left the vehicle${where}`;
    case 'pax_reboarded':  return `Passenger back on board${where}${e.wait_mins ? ` — waited ${e.wait_mins} min` : ''}`;
    case 'step_reverted':  return `Corrected: back to ${(e.to_state || 'previous step').replace(/_/g, ' ')}${where}`;
    default:               return e.note || e.event_type;
  }
}

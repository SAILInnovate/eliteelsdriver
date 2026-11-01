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
 *   at_stop            object  — at a scheduled stop, nothing done there yet: { index, name, arrived_at }
 *   stop_log           array   — what happened at each stop that was not a wait:
 *                                [{ index, name, kind: 'drop' | 'pickup', arrived_at, at, mins }]
 *   en_route_at        string  — when the driver set off for the pickup
 *
 * One booking can carry several people: the directors picked up from a hotel,
 * an apartment and a house, dropped at the ground, then home. At each stop the
 * driver says what happened there — someone got out (Clear 1, Clear 2), someone
 * got in (POB 2, POB 3), or the passenger got out and is coming back (a wait).
 * The last drop of a booking with clears is All clear.
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
    stopWaits: meta.stop_waits || [],
    atStop: meta.at_stop || null,
    stopLog: meta.stop_log || []
  };
}

const dropsDone = (j) => j.stopLog.filter(s => s.kind === 'drop').length;
const pickupsDone = (j) => j.stopLog.filter(s => s.kind === 'pickup').length;

/** Did anyone get out along the way? The final step is then All clear. */
export function hasClears(ride) {
  return dropsDone(readJourney(ride)) > 0;
}

/**
 * What can happen at the stop the driver has just arrived at, besides the
 * forward step (Clear n): someone gets in, or the passenger gets out and the
 * car waits. Empty when the driver is not at a stop.
 */
export function stopChoices(ride) {
  const j = readJourney(ride);
  if (j.status !== 'in_progress' || !j.paxOnBoard || !j.atStop) return [];
  return [
    { key: 'board', label: `POB ${pickupsDone(j) + 2} — picked up here` },
    { key: 'stop', label: 'Passenger out — coming back' }
  ];
}

/**
 * Where the job is, for the coloured band across the top of the job screen.
 * Each stage has its own colour and its own clock, so a driver can tell at a
 * glance that the step they swiped took — "Passenger on board, 12 min" in
 * green is not the same screen as "At pickup, waiting 4 min" in blue.
 *
 *   tone: 'gold' | 'blue' | 'green' | 'orange'
 *   since: when this stage began (the band counts up from it)
 *   next: what comes next, when there is something to say
 */
export function journeyStage(ride) {
  const j = readJourney(ride);
  const meta = ride?.metadata || {};
  switch (j.status) {
    case 'en_route':
      return { key: 'en_route', tone: 'gold', label: 'On the way to pickup', since: meta.en_route_at || ride.acknowledged_at || null };
    case 'arrived':
      return { key: 'arrived', tone: 'blue', label: 'At pickup — waiting', since: ride.arrived_at || null };
    case 'in_progress': {
      if (!j.paxOnBoard) {
        return { key: 'waiting', tone: 'orange', label: `Waiting at ${short(j.openStop?.name, 22)}`, since: j.openStop?.off_at || null };
      }
      if (j.atStop) {
        return { key: 'at_stop', tone: 'blue', label: `At ${short(j.atStop.name, 26)}`, since: j.atStop.arrived_at };
      }
      const nextStop = j.waypoints[j.stopIndex];
      return {
        key: 'on_board', tone: 'green',
        label: pickupsDone(j) > 0 ? 'Passengers on board' : 'Passenger on board',
        since: ride.pob_at || null,
        next: nextStop ? `Next: ${short(nextStop.name, 28)}` : (dropsDone(j) > 0 ? 'Next: last drop' : 'Next: drop-off')
      };
    }
    default:
      return null;
  }
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
      if (j.atStop) return { key: 'drop', label: `Clear ${dropsDone(j) + 1} — dropped off here`, variant: 'accent' };
      if (j.stopIndex < j.waypoints.length) {
        return { key: 'stop_arrive', label: `Arrived at ${short(j.waypoints[j.stopIndex]?.name)}` };
      }
      return dropsDone(j) > 0
        ? { key: 'complete', label: 'All Clear', variant: 'accent' }
        : { key: 'complete', label: 'Complete Booking', variant: 'accent' };
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
      if (j.atStop) return { key: 'undo_stop_arrive', label: 'Not at the stop yet' };
      // The most recent of a clear/pickup and a finished wait is the one to undo.
      const lastLog = j.stopLog[j.stopLog.length - 1];
      const lastWait = j.stopWaits[j.stopWaits.length - 1];
      if (lastLog && (!lastWait || new Date(lastLog.at) >= new Date(lastWait.on_at))) {
        return lastLog.kind === 'drop'
          ? { key: 'undo_drop', label: 'Not dropped off yet' }
          : { key: 'undo_board', label: 'Not picked up yet' };
      }
      if (lastWait) {
        return { key: 'undo_reboard', label: `Still waiting at ${short(lastWait.name, 12)}` };
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
  if (j.atStop || j.stopIndex < j.waypoints.length) return null;
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
    // A wait at a stop counts whether the passenger came back to the car or a
    // new one was picked up there (POB 2 at the hotel after ten minutes).
    const stopTotal = [...(meta.stop_waits || []), ...(meta.stop_log || [])]
      .reduce((sum, w) => sum + (w.mins || 0), 0);
    patch.stop_wait_mins = stopTotal;
    patch.total_waiting_time_mins =
      (patch.wait_time_mins !== undefined ? patch.wait_time_mins : (ride?.wait_time_mins || 0)) + stopTotal;
  };

  switch (key) {
    case 'start': {
      patch.status = 'en_route';
      if (!ride?.acknowledged_at) patch.acknowledged_at = now;
      meta.en_route_at = now;
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

    // At a scheduled stop. Nothing has happened there yet; what does is the
    // next step (Clear, POB, or the passenger getting out to come back).
    case 'stop_arrive': {
      const scheduled = j.waypoints[j.stopIndex];
      if (!scheduled) break;
      meta.at_stop = { index: j.stopIndex, name: scheduled.name || `Stop ${j.stopIndex + 1}`, arrived_at: now };
      event = fwd('stop_arrived', 'on_board', 'at_stop', { stop_index: j.stopIndex, stop_name: meta.at_stop.name });
      break;
    }

    // Someone got out here and is not coming back: Clear n.
    case 'drop': {
      const here = j.atStop;
      if (!here) break;
      const n = dropsDone(j) + 1;
      meta.stop_log = [...j.stopLog, { index: here.index, name: here.name, kind: 'drop', arrived_at: here.arrived_at, at: now, mins: 0 }];
      meta.at_stop = null;
      meta.current_stop_index = here.index + 1;
      event = fwd('dropoff', 'at_stop', 'on_board', { stop_index: here.index, stop_name: here.name, note: `Clear ${n}` });
      break;
    }

    // Someone got in here: POB n. The time from arriving to them getting in
    // is that stop's wait.
    case 'board': {
      const here = j.atStop;
      if (!here) break;
      const n = pickupsDone(j) + 2;
      const mins = minsBetween(here.arrived_at, now);
      meta.stop_log = [...j.stopLog, { index: here.index, name: here.name, kind: 'pickup', arrived_at: here.arrived_at, at: now, mins }];
      meta.at_stop = null;
      meta.current_stop_index = here.index + 1;
      retotal();
      event = fwd('pob', 'at_stop', 'on_board', { stop_index: here.index, stop_name: here.name, wait_mins: mins, note: `POB ${n}` });
      break;
    }

    // Passenger out of the vehicle — scheduled stop or not, the clock starts.
    case 'stop':
    case 'alight': {
      const here = key === 'stop' ? j.atStop : null;
      const scheduled = key === 'stop' && !here ? j.waypoints[j.stopIndex] : null;
      meta.pax_on_board = false;
      meta.at_stop = null;
      meta.open_stop = here
        // Out at the stop they have just reached: the wait runs from arriving.
        ? { index: here.index, name: here.name, off_at: here.arrived_at }
        : {
          index: scheduled ? j.stopIndex : null,
          name: scheduled?.name || 'Unscheduled stop',
          off_at: now
        };
      event = fwd(scheduled ? 'stop_arrived' : 'pax_alighted', here ? 'at_stop' : 'on_board', 'waiting', {
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
    case 'undo_stop_arrive': {
      const here = j.atStop;
      meta.at_stop = null;
      event = back('at_stop', 'on_board', { stop_index: here?.index ?? null, stop_name: here?.name || null });
      break;
    }
    case 'undo_drop':
    case 'undo_board': {
      // Back to standing at that stop, arrived when they first arrived.
      const log = [...j.stopLog];
      const last = log.pop();
      if (!last) break;
      meta.stop_log = log;
      meta.at_stop = { index: last.index, name: last.name, arrived_at: last.arrived_at };
      meta.current_stop_index = last.index;
      retotal();
      event = back('on_board', 'at_stop', { stop_index: last.index, stop_name: last.name, note: `${last.kind === 'drop' ? 'Clear' : 'POB'} taken back` });
      break;
    }
    case 'undo_alight': {
      // They never actually got out — drop the open wait entirely so no time
      // is billed for it. Out at a scheduled stop, the driver is back to
      // standing at it.
      const open = j.openStop;
      meta.open_stop = null;
      meta.pax_on_board = true;
      if (open?.index !== null && open?.index !== undefined && open.index === j.stopIndex) {
        meta.at_stop = { index: open.index, name: open.name, arrived_at: open.off_at };
      }
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
        completed: e.note === 'All clear' ? 'All clear — booking completed' : 'Booking completed'
      }[e.to_state] || `Status: ${e.to_state}`;
    case 'stop_arrived':   return e.stop_name ? `Arrived${where}` : 'Arrived at stop';
    case 'dropoff':        return `${e.note || 'Dropped off'}${where}`;
    case 'pob':            return `${e.note || 'Passenger on board'}${where}${e.wait_mins ? ` — waited ${e.wait_mins} min` : ''}`;
    case 'pax_alighted':   return `Passenger left the vehicle${where}`;
    case 'pax_reboarded':  return `Passenger back on board${where}${e.wait_mins ? ` — waited ${e.wait_mins} min` : ''}`;
    case 'step_reverted':  return e.note
      ? `Corrected: ${e.note}${where}`
      : `Corrected: back to ${(e.to_state === 'at_stop' ? 'the stop' : (e.to_state || 'previous step')).replace(/_/g, ' ')}${where}`;
    case 'off_plan':       return e.note ? `Off plan: ${e.note}` : 'Off plan — the office followed the GPS';
    case 'back_on_plan':   return 'Back on plan';
    default:               return e.note || e.event_type;
  }
}

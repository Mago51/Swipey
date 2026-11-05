const SWIPE_CONFIG = {
  minDistance: 0.17,
  minDurationMs: 50,
  maxDurationMs: 1200,
  directionDominance: 1.6,
  fingerSettleMs: 90,
  jitterThreshold: 0.012,
  lateFingerMovement: 0.05,
  maxHistorySamples: 24,
  consistencyDotProduct: 0.62,
  minSupportedFingers: 2,
  maxSupportedFingers: 2,
};

class GestureRecognizer {
  constructor(config = {}) {
    this.config = { ...SWIPE_CONFIG, ...config };
    this.sessions = new Map();
  }

  processEvent(event) {
    if (!event || event.type !== "touchpadFrame") return [];
    if (!event.deviceId) return [];
    const contacts = normalizeContacts(event.contacts);
    const timestamp = Number(event.timestamp || 0);
    const frequency = Number(event.timestampFrequency || event.timestampFrequencyHz || 10000000);
    const session = this.sessions.get(event.deviceId);

    // Hier warten wir, bis alle Finger wieder vom Touchpad weg sind.
    // Erst dann entscheiden wir, ob es wirklich ein Swipe war.
    if (contacts.length === 0) {
      if (!session) return [];
      this.sessions.delete(event.deviceId);
      return [classifySession(session, timestamp, frequency, this.config)];
    }

    if (!session) {
      this.sessions.set(event.deviceId, createSession(event.deviceId, timestamp, frequency, contacts, this.config));
      return [];
    }

    updateSession(session, timestamp, frequency, contacts, this.config);
    return [];
  }

  reset() {
    this.sessions.clear();
  }
}

function normalizeContacts(contacts) {
  if (!Array.isArray(contacts)) return [];
  return contacts
    .filter((contact) => contact && Number.isFinite(Number(contact.x)) && Number.isFinite(Number(contact.y)))
    .map((contact) => ({
      id: Number(contact.id ?? contact.contactId),
      x: clamp01(Number(contact.x)),
      y: clamp01(Number(contact.y)),
      rawX: contact.rawX,
      rawY: contact.rawY,
    }))
    .filter((contact) => Number.isFinite(contact.id));
}

function createSession(deviceId, timestamp, frequency, contacts, config) {
  const session = {
    deviceId,
    startTimestamp: timestamp,
    lastTimestamp: timestamp,
    frequency,
    contacts: new Map(),
    maxFingers: contacts.length,
    unstableFingerCount: false,
    largestSettleMovement: 0,
  };
  updateSession(session, timestamp, frequency, contacts, config);
  return session;
}

function updateSession(session, timestamp, frequency, contacts, config) {
  session.lastTimestamp = timestamp;
  session.frequency = frequency || session.frequency;
  session.maxFingers = Math.max(session.maxFingers, contacts.length);
  const centroid = calculateCentroid(contacts);
  const elapsedMs = ticksToMs(timestamp - session.startTimestamp, session.frequency);
  const movementFromStart = session.startCentroid ? distanceBetween(session.startCentroid, centroid) : 0;
  if (!session.startCentroid) session.startCentroid = centroid;
  session.largestSettleMovement = Math.max(session.largestSettleMovement, movementFromStart);

  for (const contact of contacts) {
    let path = session.contacts.get(contact.id);
    if (!path) {
      // Finger setzen nie exakt gleichzeitig auf. Kommt einer aber erst deutlich später dazu,
      // obwohl sich die anderen schon bewegen, ist die Fingerzahl unklar und wir verwerfen die Geste.
      if (elapsedMs > config.fingerSettleMs && movementFromStart > config.lateFingerMovement) {
        session.unstableFingerCount = true;
      }
      path = {
        id: contact.id,
        firstTimestamp: timestamp,
        lastTimestamp: timestamp,
        start: { x: contact.x, y: contact.y },
        last: { x: contact.x, y: contact.y },
        samples: [],
      };
      session.contacts.set(contact.id, path);
    }
    path.lastTimestamp = timestamp;
    path.last = { x: contact.x, y: contact.y };
    path.samples.push({ timestamp, x: contact.x, y: contact.y });
    if (path.samples.length > config.maxHistorySamples) path.samples.shift();
  }
}

function classifySession(session, endTimestamp, frequency, config) {
  const durationMs = ticksToMs(endTimestamp - session.startTimestamp, frequency || session.frequency);
  const participants = [...session.contacts.values()].filter((path) => path.samples.length > 0);
  const fingers = session.maxFingers;
  const base = {
    provider: "touchpad-gesture-recognizer",
    deviceId: session.deviceId,
    timestamp: endTimestamp,
    durationMs: Math.round(durationMs),
    fingers,
  };

  if (fingers < config.minSupportedFingers || fingers > config.maxSupportedFingers) return reject(base, "unsupported-finger-count");
  if (session.unstableFingerCount) return reject(base, "finger-count-unstable");
  if (participants.length < fingers) return reject(base, "finger-count-unstable");
  if (durationMs < config.minDurationMs) return reject(base, "duration-too-short");
  if (durationMs > config.maxDurationMs) return reject(base, "duration-too-long");

  const displacements = resolveDisplacements(participants.slice(0, fingers), config);
  const average = averageDisplacement(displacements);
  if (fingers > 1 && distanceVector(average.dx, average.dy) < config.jitterThreshold && displacements.some((item) => distanceVector(item.dx, item.dy) >= config.minDistance * 0.45)) {
    return reject(base, "finger-directions-inconsistent");
  }
  const axis = dominantAxis(average, config);
  if (!axis) return reject({ ...base, distance: round(distanceVector(average.dx, average.dy)) }, "direction-ambiguous");

  const distance = axis === "x" ? Math.abs(average.dx) : Math.abs(average.dy);
  if (distance < config.minDistance) return reject({ ...base, distance: round(distance) }, "distance-too-short");
  if (!directionsAreConsistent(displacements, average, config)) {
    return reject({ ...base, distance: round(distance) }, "finger-directions-inconsistent");
  }

  const direction = axis === "x" ? (average.dx < 0 ? "left" : "right") : average.dy < 0 ? "up" : "down";
  return {
    type: "gestureRecognized",
    gesture: "swipe",
    direction,
    distance: round(distance),
    dx: round(average.dx),
    dy: round(average.dy),
    ...base,
  };
}

// Die Bewegung muss klar in eine Richtung gehen. Diagonale Bewegungen zählen nicht.
function dominantAxis(displacement, config) {
  const absX = Math.abs(displacement.dx);
  const absY = Math.abs(displacement.dy);
  if (absX < config.jitterThreshold && absY < config.jitterThreshold) return null;
  if (absX >= absY * config.directionDominance) return "x";
  if (absY >= absX * config.directionDominance) return "y";
  return null;
}

function directionsAreConsistent(displacements, average, config) {
  const averageLength = distanceVector(average.dx, average.dy);
  if (averageLength < config.jitterThreshold) return false;
  return displacements.every((item) => {
    const length = distanceVector(item.dx, item.dy);
    if (length < config.minDistance * 0.45) return false;
    const dot = (item.dx * average.dx + item.dy * average.dy) / (length * averageLength);
    return dot >= config.consistencyDotProduct;
  });
}

// Bei zwei Fingern kommen die Kontakt-IDs manchmal vertauscht an. Passt die normale
// Zuordnung nicht, probieren wir die gekreuzte.
function resolveDisplacements(participants, config) {
  if (participants.length !== 2) return participants.map(displacementForPath);

  const identity = participants.map(displacementForPath);
  if (directionsAreConsistent(identity, averageDisplacement(identity), config)) return identity;

  const reordered = [
    displacementBetween(participants[0].start, participants[1].last, participants[0].id),
    displacementBetween(participants[1].start, participants[0].last, participants[1].id),
  ];
  if (directionsAreConsistent(reordered, averageDisplacement(reordered), config)) return reordered;

  return identity;
}

function displacementForPath(path) {
  return displacementBetween(path.start, path.last, path.id);
}

function displacementBetween(start, last, id) {
  return {
    id,
    dx: last.x - start.x,
    dy: last.y - start.y,
  };
}

function averageDisplacement(displacements) {
  const total = displacements.reduce((sum, item) => ({ dx: sum.dx + item.dx, dy: sum.dy + item.dy }), { dx: 0, dy: 0 });
  return { dx: total.dx / displacements.length, dy: total.dy / displacements.length };
}

function calculateCentroid(contacts) {
  const total = contacts.reduce((sum, contact) => ({ x: sum.x + contact.x, y: sum.y + contact.y }), { x: 0, y: 0 });
  return { x: total.x / contacts.length, y: total.y / contacts.length };
}

function reject(base, reason) {
  return { type: "gestureRejected", reason, ...base };
}

function ticksToMs(ticks, frequency) {
  if (!frequency || !Number.isFinite(frequency)) return ticks;
  return (ticks / frequency) * 1000;
}

function distanceBetween(a, b) {
  return distanceVector(b.x - a.x, b.y - a.y);
}

function distanceVector(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  GestureRecognizer,
  SWIPE_CONFIG,
};

const assert = require("assert");
const { GestureRecognizer } = require("./gestureRecognizer.js");

const frequency = 1000;

function runGesture({ fingers, from, to, duration = 300, stagger = 0, steps = 5 }) {
  const recognizer = new GestureRecognizer();
  const events = [];
  for (let step = 0; step <= steps; step += 1) {
    const timestamp = Math.round((duration / steps) * step);
    const progress = step / steps;
    const contacts = [];
    for (let index = 0; index < fingers; index += 1) {
      if (timestamp < index * stagger) continue;
      contacts.push({
        id: index + 1,
        x: from.x + (to.x - from.x) * progress + index * 0.02,
        y: from.y + (to.y - from.y) * progress + index * 0.02,
      });
    }
    events.push(...recognizer.processEvent(frame(timestamp, contacts)));
  }
  events.push(...recognizer.processEvent(frame(duration + 16, [])));
  return events;
}

function runContactGesture({ contacts, duration = 300, steps = 5 }) {
  const recognizer = new GestureRecognizer();
  const events = [];
  for (let step = 0; step <= steps; step += 1) {
    const timestamp = Math.round((duration / steps) * step);
    const progress = step / steps;
    events.push(...recognizer.processEvent(frame(timestamp, contacts.map((contact) => ({
      id: contact.id,
      x: contact.start.x + (contact.end.x - contact.start.x) * progress,
      y: contact.start.y + (contact.end.y - contact.start.y) * progress,
    })))));
  }
  events.push(...recognizer.processEvent(frame(duration + 16, [])));
  return events;
}

function frame(timestamp, contacts) {
  return { type: "touchpadFrame", deviceId: "test-touchpad", timestamp, timestampFrequency: frequency, contacts };
}

function recognized(events) {
  return events.find((event) => event.type === "gestureRecognized");
}

function rejected(events) {
  return events.find((event) => event.type === "gestureRejected");
}

function assertSwipe(name, options, expected) {
  const event = recognized(runGesture(options));
  assert(event, `${name}: expected recognized swipe`);
  assert.strictEqual(event.gesture, "swipe", name);
  assert.strictEqual(event.direction, expected.direction, name);
  assert.strictEqual(event.fingers, expected.fingers, name);
}

assertSwipe("2-finger left", { fingers: 2, from: { x: 0.75, y: 0.5 }, to: { x: 0.35, y: 0.51 } }, { fingers: 2, direction: "left" });
assertSwipe("2-finger right", { fingers: 2, from: { x: 0.25, y: 0.5 }, to: { x: 0.65, y: 0.49 } }, { fingers: 2, direction: "right" });
assertSwipe("2-finger up", { fingers: 2, from: { x: 0.5, y: 0.75 }, to: { x: 0.51, y: 0.35 } }, { fingers: 2, direction: "up" });
assertSwipe("2-finger down", { fingers: 2, from: { x: 0.5, y: 0.25 }, to: { x: 0.49, y: 0.65 } }, { fingers: 2, direction: "down" });

const twoFingerLayouts = {
  horizontal: {
    right: [
      { id: 1, start: { x: 0.20, y: 0.40 }, end: { x: 0.70, y: 0.40 } },
      { id: 2, start: { x: 0.20, y: 0.60 }, end: { x: 0.70, y: 0.60 } },
    ],
    left: [
      { id: 1, start: { x: 0.70, y: 0.40 }, end: { x: 0.20, y: 0.40 } },
      { id: 2, start: { x: 0.70, y: 0.60 }, end: { x: 0.20, y: 0.60 } },
    ],
    up: [
      { id: 1, start: { x: 0.30, y: 0.80 }, end: { x: 0.30, y: 0.25 } },
      { id: 2, start: { x: 0.70, y: 0.80 }, end: { x: 0.70, y: 0.25 } },
    ],
    down: [
      { id: 1, start: { x: 0.30, y: 0.20 }, end: { x: 0.30, y: 0.75 } },
      { id: 2, start: { x: 0.70, y: 0.20 }, end: { x: 0.70, y: 0.75 } },
    ],
  },
  vertical: {
    right: [
      { id: 1, start: { x: 0.40, y: 0.20 }, end: { x: 0.80, y: 0.20 } },
      { id: 2, start: { x: 0.40, y: 0.70 }, end: { x: 0.80, y: 0.70 } },
    ],
    left: [
      { id: 1, start: { x: 0.80, y: 0.20 }, end: { x: 0.30, y: 0.20 } },
      { id: 2, start: { x: 0.80, y: 0.70 }, end: { x: 0.30, y: 0.70 } },
    ],
    up: [
      { id: 1, start: { x: 0.45, y: 0.80 }, end: { x: 0.45, y: 0.30 } },
      { id: 2, start: { x: 0.45, y: 0.55 }, end: { x: 0.45, y: 0.05 } },
    ],
    down: [
      { id: 1, start: { x: 0.45, y: 0.10 }, end: { x: 0.45, y: 0.60 } },
      { id: 2, start: { x: 0.45, y: 0.35 }, end: { x: 0.45, y: 0.85 } },
    ],
  },
  diagonal: {
    right: [
      { id: 1, start: { x: 0.25, y: 0.25 }, end: { x: 0.72, y: 0.28 } },
      { id: 2, start: { x: 0.45, y: 0.65 }, end: { x: 0.90, y: 0.62 } },
    ],
    left: [
      { id: 1, start: { x: 0.72, y: 0.28 }, end: { x: 0.25, y: 0.25 } },
      { id: 2, start: { x: 0.90, y: 0.62 }, end: { x: 0.45, y: 0.65 } },
    ],
    up: [
      { id: 1, start: { x: 0.25, y: 0.78 }, end: { x: 0.28, y: 0.28 } },
      { id: 2, start: { x: 0.65, y: 0.58 }, end: { x: 0.62, y: 0.10 } },
    ],
    down: [
      { id: 1, start: { x: 0.25, y: 0.18 }, end: { x: 0.28, y: 0.68 } },
      { id: 2, start: { x: 0.65, y: 0.38 }, end: { x: 0.62, y: 0.86 } },
    ],
  },
};

for (const [layoutName, directions] of Object.entries(twoFingerLayouts)) {
  for (const [direction, contacts] of Object.entries(directions)) {
    const event = recognized(runContactGesture({ contacts }));
    assert(event, `2-finger ${direction} with ${layoutName} start: expected recognized swipe`);
    assert.strictEqual(event.fingers, 2, `${layoutName} ${direction}`);
    assert.strictEqual(event.direction, direction, `${layoutName} ${direction}`);
  }
}

assertSwipe("2-finger right with unequal movement", {
  fingers: 2,
  from: { x: 0.2, y: 0.4 },
  to: { x: 0.67, y: 0.405 },
}, { fingers: 2, direction: "right" });

{
  const event = recognized(runContactGesture({
    contacts: [
      { id: 1, start: { x: 0.20, y: 0.40 }, end: { x: 0.72, y: 0.44 } },
      { id: 2, start: { x: 0.20, y: 0.60 }, end: { x: 0.63, y: 0.57 } },
    ],
  }));
  assert(event, "2-finger right with realistic unequal movement: expected recognized swipe");
  assert.strictEqual(event.direction, "right");
  assert.strictEqual(event.fingers, 2);
}

{
  const event = recognized(runContactGesture({
    contacts: [
      { id: 1, start: { x: 0.40, y: 0.20 }, end: { x: 0.70, y: 0.70 } },
      { id: 2, start: { x: 0.40, y: 0.70 }, end: { x: 0.70, y: 0.20 } },
    ],
  }));
  assert(event, "2-finger vertical right with swapped contact order: expected recognized swipe");
  assert.strictEqual(event.direction, "right");
  assert.strictEqual(event.fingers, 2);
}

{
  const events = runGesture({ fingers: 1, from: { x: 0.75, y: 0.5 }, to: { x: 0.25, y: 0.5 } });
  assert(!recognized(events), "1-finger swipe: expected no Swipey trigger");
  assert.strictEqual(rejected(events)?.reason, "unsupported-finger-count");
}

{
  const events = runGesture({ fingers: 3, from: { x: 0.75, y: 0.5 }, to: { x: 0.25, y: 0.5 } });
  assert(!recognized(events), "3-finger swipe: expected no Swipey trigger");
  assert.strictEqual(rejected(events)?.reason, "unsupported-finger-count");
}

{
  const events = runGesture({ fingers: 4, from: { x: 0.75, y: 0.5 }, to: { x: 0.25, y: 0.5 } });
  assert(!recognized(events), "4-finger swipe: expected no Swipey trigger");
  assert.strictEqual(rejected(events)?.reason, "unsupported-finger-count");
}

assert.strictEqual(rejected(runGesture({ fingers: 2, from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 }, duration: 20 }))?.reason, "duration-too-short");
assert.strictEqual(rejected(runGesture({ fingers: 2, from: { x: 0.5, y: 0.5 }, to: { x: 0.57, y: 0.5 } }))?.reason, "distance-too-short");
assert.strictEqual(rejected(runGesture({ fingers: 2, from: { x: 0.3, y: 0.3 }, to: { x: 0.55, y: 0.55 } }))?.reason, "direction-ambiguous");
assert.strictEqual(rejected(runGesture({ fingers: 2, from: { x: 0.3, y: 0.3 }, to: { x: 0.65, y: 0.3 }, duration: 1600 }))?.reason, "duration-too-long");

{
  const recognizer = new GestureRecognizer();
  const events = [];
  events.push(...recognizer.processEvent(frame(0, [{ id: 1, x: 0.3, y: 0.5 }, { id: 2, x: 0.7, y: 0.5 }])));
  events.push(...recognizer.processEvent(frame(300, [{ id: 1, x: 0.65, y: 0.5 }, { id: 2, x: 0.35, y: 0.5 }])));
  events.push(...recognizer.processEvent(frame(316, [])));
  assert.strictEqual(rejected(events)?.reason, "finger-directions-inconsistent");
}

assertSwipe("settled two-finger right", { fingers: 2, from: { x: 0.2, y: 0.4 }, to: { x: 0.58, y: 0.4 }, stagger: 40 }, { fingers: 2, direction: "right" });

{
  const recognizer = new GestureRecognizer();
  const events = [];
  events.push(...recognizer.processEvent(frame(0, [{ id: 1, x: 0.2, y: 0.4 }, { id: 2, x: 0.4, y: 0.4 }])));
  events.push(...recognizer.processEvent(frame(40, [{ id: 1, x: 0.22, y: 0.4 }, { id: 2, x: 0.42, y: 0.4 }, { id: 3, x: 0.62, y: 0.4 }])));
  events.push(...recognizer.processEvent(frame(300, [{ id: 1, x: 0.62, y: 0.4 }, { id: 2, x: 0.82, y: 0.4 }, { id: 3, x: 0.98, y: 0.4 }])));
  events.push(...recognizer.processEvent(frame(316, [])));
  assert(!recognized(events), "3-finger gesture must not trigger Swipey");
  assert.strictEqual(rejected(events)?.reason, "unsupported-finger-count");
}

{
  const recognizer = new GestureRecognizer();
  const events = [];
  events.push(...recognizer.processEvent(frame(0, [{ id: 1, x: 0.2, y: 0.4 }, { id: 2, x: 0.4, y: 0.4 }, { id: 3, x: 0.6, y: 0.4 }])));
  events.push(...recognizer.processEvent(frame(40, [{ id: 1, x: 0.22, y: 0.4 }, { id: 2, x: 0.42, y: 0.4 }, { id: 3, x: 0.62, y: 0.4 }, { id: 4, x: 0.82, y: 0.4 }])));
  events.push(...recognizer.processEvent(frame(300, [{ id: 1, x: 0.58, y: 0.4 }, { id: 2, x: 0.78, y: 0.4 }, { id: 3, x: 0.98, y: 0.4 }, { id: 4, x: 1.0, y: 0.4 }])));
  events.push(...recognizer.processEvent(frame(316, [])));
  assert(!recognized(events), "4-finger gesture must not trigger Swipey");
  assert.strictEqual(rejected(events)?.reason, "unsupported-finger-count");
}

{
  const recognizer = new GestureRecognizer();
  const events = [];
  events.push(...recognizer.processEvent(frame(0, [{ id: 1, x: 0.2, y: 0.4 }, { id: 2, x: 0.4, y: 0.4 }])));
  events.push(...recognizer.processEvent(frame(300, [{ id: 1, x: 0.6, y: 0.4 }, { id: 2, x: 0.8, y: 0.4 }])));
  assert.strictEqual(events.filter((event) => event.type === "gestureRecognized").length, 0, "gesture must not trigger before lift");
  events.push(...recognizer.processEvent(frame(316, [])));
  assert.strictEqual(events.filter((event) => event.type === "gestureRecognized").length, 1, "gesture must trigger once on lift");
}

{
  const recognizer = new GestureRecognizer();
  const events = [];
  events.push(...recognizer.processEvent(frame(0, [{ id: 1, x: 0.2, y: 0.5 }])));
  events.push(...recognizer.processEvent(frame(240, [{ id: 1, x: 0.42, y: 0.5 }, { id: 2, x: 0.5, y: 0.5 }])));
  events.push(...recognizer.processEvent(frame(320, [{ id: 1, x: 0.65, y: 0.5 }, { id: 2, x: 0.72, y: 0.5 }])));
  events.push(...recognizer.processEvent(frame(336, [])));
  assert.strictEqual(rejected(events)?.reason, "finger-count-unstable");
}

console.log("gestureRecognizer tests passed");

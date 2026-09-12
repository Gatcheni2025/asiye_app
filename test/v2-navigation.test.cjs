const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
    const elements = {};
    const location = { latitude: 0, longitude: 0, heading: 90 };
    const map = { on() {}, easeTo() {}, isStyleLoaded: () => true, getBearing: () => 0 };
    const context = {
        console, Date, innerHeight: 800,
        document: { body: { classList: { add() {}, remove() {} } },
            getElementById: id => elements[id] ||= { textContent: '' } },
        ASIYE_DRIVER_CONFIG: { mapboxToken: 'pk.test' },
        ASIYE_DRIVER: { state: { location }, trip: { requestId: 'trip1' },
            map: { instance: map, drawRoute() {}, showTargetMarker() {} } }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/driver-v2/js/navigation.js'), 'utf8'), context);
    return { context, nav: context.ASIYE_DRIVER.navigator, elements, location };
}

test('guidance measures remaining road distance and selects the next maneuver', () => {
    const { nav, elements, location } = setup();
    nav.target = [.002, .001];
    nav.route = {};
    nav.stepIndex = 0;
    nav.steps = [
        { geometry: { coordinates: [[0, 0], [.001, 0]] }, duration: 60, distance: 111 },
        { geometry: { coordinates: [[.001, 0], [.001, .001]] }, duration: 60, distance: 111,
            maneuver: { instruction: 'Turn left onto Palm Boulevard', modifier: 'left' } },
        { geometry: { coordinates: [[.001, .001], [.002, .001]] }, duration: 60, distance: 111,
            maneuver: { instruction: 'Turn right', modifier: 'right' } }
    ];
    location.longitude = .0005;
    nav.update(location);
    assert.equal(elements.navInstruction.textContent, 'Turn left onto Palm Boulevard');
    assert.equal(elements.navTurnDistance.textContent, '60 m');
    assert.equal(elements.navArrow.textContent, '↰');
    location.longitude = .001;
    location.latitude = .0005;
    nav.update(location);
    assert.equal(nav.stepIndex, 1);
    assert.equal(elements.navInstruction.textContent, 'Turn right');
});

test('waiting for GPS does not request a route', () => {
    const { nav, context, location, elements } = setup();
    location.latitude = null;
    let calls = 0;
    context.fetch = () => { calls++; };
    nav.start({ destinationCoords: { lat: 1, lng: 2 } });
    assert.equal(calls, 0);
    assert.equal(elements.navInstruction.textContent, 'Waiting for GPS…');
});

test('stopping navigation discards an in-flight route response', async () => {
    const { nav, context } = setup();
    let resolve;
    context.fetch = () => new Promise(done => { resolve = done; });
    nav.target = [1, 2];
    const pending = nav.fetchRoute();
    nav.stop();
    resolve({ ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[0, 0], [1, 2]] }, legs: [{ steps: [{}] }] }] }) });
    await pending;
    assert.equal(nav.route, null);
    assert.equal(nav.target, null);
});

test('route failures show a retry state without a fabricated ETA', async () => {
    const { nav, context, elements } = setup();
    context.console = { warn() {} };
    context.fetch = async () => ({ ok: false, status: 503 });
    nav.target = [1, 2];
    await nav.fetchRoute();
    assert.equal(elements.navInstruction.textContent, 'Route unavailable. Tap retry.');
    assert.equal(elements.navEta.textContent, '—');
});

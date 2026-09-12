const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function load(role) {
    const namespace = role === 'driver' ? 'ASIYE_DRIVER' : 'ASIYE';
    class Map {
        constructor(options) { this.options = options; this.events = {}; }
        on(name, callback) { this.events[name] = callback; }
        addControl() {}
        resize() {}
        easeTo(options) { this.camera = options; }
    }
    class Marker {
        constructor(options) { this.options = options; }
        setLngLat(value) { this.coordinates = value; return this; }
        addTo(map) { this.map = map; return this; }
        setRotation(value) { this.rotation = value; return this; }
        remove() { this.removed = true; }
    }
    const context = {
        console,
        performance: { now: () => context.time },
        time: 0,
        requestAnimationFrame: callback => { context.frame = callback; return 1; },
        cancelAnimationFrame: () => { context.frame = null; },
        document: { createElement: () => ({ style: {}, setAttribute() {} }) },
        mapboxgl: { Map, Marker, NavigationControl: class {} },
        [namespace]: { state: { location: { latitude: null, longitude: null } } },
        [`${namespace}_CONFIG`]: { mapboxToken: 'pk.test-public-token-for-map' }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/live-car.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../assets/${role}-v2/js/map.js`), 'utf8'), context);
    context[namespace].map.tick = time => { context.time = time; const frame = context.frame; context.frame = null; frame?.(time); };
    return context[namespace].map;
}

test('driver initializes using its own namespace and centers on the first GPS fix', () => {
    const map = load('driver');
    map.init();
    assert.ok(map.instance);
    map.instance.events.load();
    map.showDriverLocation(-29.8, 31.0, 75);
    assert.deepEqual(Array.from(map.driverMarker.coordinates), [31, -29.8]);
    assert.equal(map.driverMarker.rotation, 75);
    assert.deepEqual(Array.from(map.instance.camera.center), [31, -29.8]);
    const marker = map.driverMarker;
    map.showDriverLocation(-29.9, 31.1, 90);
    assert.equal(map.driverMarker, marker);
    assert.deepEqual(Array.from(marker.coordinates), [31.1, -29.9]);
    assert.deepEqual(Array.from(map.instance.camera.center), [31, -29.8]);
});

test('passenger retains early driver updates, moves one car, and cleans it up', () => {
    const map = load('passenger');
    map.showDriverLocation(-29.8, 31, 45);
    map.init();
    assert.deepEqual(Array.from(map.driverMarker.coordinates), [31, -29.8]);
    const marker = map.driverMarker;
    map.showDriverLocation(-29.9, 31.1, 90);
    assert.equal(map.driverMarker, marker);
    assert.equal(marker.rotation, 90);
    assert.deepEqual(Array.from(marker.coordinates), [31.1, -29.9]);
    map.removeDriverMarker();
    assert.equal(marker.removed, true);
    assert.equal(map.driverLocation, null);
    assert.equal(map.driverMarker, null);
});

for (const role of ['driver', 'passenger']) {
    test(`${role} animates GPS updates and takes the short turn across north`, () => {
        const map = load(role);
        map.init();
        map.showDriverLocation(-29.8, 31, 350);
        map.showDriverLocation(-29.799, 31.001, 10);
        assert.deepEqual(Array.from(map.driverMarker.coordinates), [31, -29.8]);
        map.tick(500);
        assert.ok(Math.abs(map.driverMarker.coordinates[0] - 31.0005) < 1e-8);
        assert.equal(map.driverMarker.rotation, 360);
        // A fresh fix continues from the rendered position instead of jumping back.
        map.showDriverLocation(-29.798, 31.002, 20);
        map.tick(1000);
        assert.deepEqual(Array.from(map.driverMarker.coordinates), [31.002, -29.798]);
        map.showDriverLocation(-29.797, 31.003, 25);
        const marker = map.driverMarker;
        map.removeDriverMarker();
        const last = Array.from(marker.coordinates);
        map.tick(2000);
        assert.deepEqual(Array.from(marker.coordinates), last);
    });
    test(`${role} rejects missing and out-of-range driver coordinates`, () => {
        const map = load(role);
        map.init();
        for (const point of [[null, null], ['', ''], [91, 31], [-29, 181], [NaN, 31]]) {
            map.showDriverLocation(...point);
            assert.equal(map.driverMarker, null);
        }
    });
}

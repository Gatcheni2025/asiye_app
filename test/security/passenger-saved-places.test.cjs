const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const home = {name: 'Home street', address: '10 Home street, Durban', latitude: -29.85, longitude: 31.01};
const work = {name: 'Office', address: '20 Office road, Durban', latitude: -29.84, longitude: 31.02};
function setup() {
    const dom = new JSDOM('<div id="sheetContent"></div>', {runScripts: 'outside-only', url: 'https://appassets.androidplatform.net/passenger-v2/index.html'});
    const w = dom.window, messages = [];
    let uid = 'passenger-a';
    w.firebase = {auth: () => ({currentUser: {uid}})};
    w.ASIYE = {state: {userId: uid, user: {name: 'Passenger'}, location: {address: 'Pickup', latitude: -29.86, longitude: 31.03}, destination: {}, booking: {}, ui: {}}, map: {}};
    w.ASIYE.setDestination = place => {w.ASIYE.state.destination = {...place};};
    for (const file of ['saved-places', 'places', 'go-negotiation', 'ride-controller']) w.eval(read(`assets/passenger-v2/js/${file}.js`));
    // Load the real UI controller while leaving signed-in application startup to device tests.
    const app = read('assets/passenger-v2/js/app.js');
    w.eval(app.slice(0, app.indexOf("document.addEventListener(\n    'DOMContentLoaded'")));
    w.ASIYE.ui.toast = text => messages.push(text);
    w.ASIYE.ui.renderRideSelection = () => {w.document.getElementById('sheetContent').textContent = 'Ride selection';};
    w.ASIYE.places.calculateRoute = async () => ({distanceKm: 5});
    return {dom, w, messages, account: value => {uid = value; w.ASIYE.state.userId = value;}};
}
test('Home and Work tap/search/select/save, edit, remove and reuse without changing pickup', async () => {
    const {dom, w} = setup();
    try {
        w.ASIYE.ui.renderDestinationSearch();
        w.document.querySelector('[data-place-shortcut="home"]').click();
        assert.match(w.document.querySelector('h2').textContent, /Set Home/);
        w.ASIYE.places.renderSuggestions([home]);
        w.document.querySelector('[data-place-index="0"]').click();
        assert.equal(w.ASIYE.savedPlaces.read().home.address, home.address);
        assert.equal(w.ASIYE.state.destination.address, undefined);
        assert.equal(w.ASIYE.state.location.address, 'Pickup');
        w.document.querySelector('[data-place-shortcut="work"]').click();
        w.ASIYE.places.renderSuggestions([work]);
        w.document.querySelector('[data-place-index="0"]').click();
        w.document.querySelector('[data-place-shortcut="home"]').click();
        await new Promise(r => setImmediate(r));
        assert.equal(w.ASIYE.state.destination.address, home.address);
        assert.equal(w.ASIYE.savedPlaces.read().recent[0].address, home.address);
        w.ASIYE.ui.renderDestinationSearch();
        w.document.querySelector('[data-edit-place="home"]').click();
        assert.match(w.document.querySelector('h2').textContent, /Edit Home/);
        w.document.getElementById('removeSavedPlace').click();
        assert.equal(w.ASIYE.savedPlaces.read().home, null);
        assert.equal(w.ASIYE.savedPlaces.read().work.address, work.address);
    } finally {dom.window.close();}
});
test('saved addresses survive module reload and never appear in another account', () => {
    const {dom, w, account} = setup();
    try {
        w.ASIYE.savedPlaces.save('home', home);
        w.ASIYE.savedPlaces.remember(work);
        w.eval(read('assets/passenger-v2/js/saved-places.js'));
        assert.equal(w.ASIYE.savedPlaces.read().home.address, home.address);
        account('passenger-b');
        assert.equal(w.ASIYE.savedPlaces.read().home, null);
        assert.equal(w.ASIYE.savedPlaces.read().recent.length, 0);
        account('passenger-a');
        assert.equal(w.ASIYE.savedPlaces.read().recent[0].address, work.address);
    } finally {dom.window.close();}
});
test('recent places deduplicate, stay newest first, cap at ten, support selection/removal', async () => {
    const {dom, w} = setup();
    try {
        for (let i = 0; i < 12; i++) w.ASIYE.savedPlaces.remember({...work, address: `${i} Office road`, name: `Office ${i}`});
        w.ASIYE.savedPlaces.remember({...work, address: '5 Office road', name: 'Office 5'});
        const recent = w.ASIYE.savedPlaces.read().recent;
        assert.equal(recent.length, 10);
        assert.equal(recent[0].address, '5 Office road');
        assert.equal(recent.filter(p => p.address === '5 Office road').length, 1);
        w.ASIYE.savedPlaces.renderRecent();
        w.document.querySelector('[data-remove-recent="0"]').click();
        assert.equal(w.ASIYE.savedPlaces.read().recent.length, 9);
        w.document.querySelector('[data-recent-place="0"]').click();
        await new Promise(r => setImmediate(r));
        assert.equal(w.ASIYE.state.destination.address, '11 Office road');
    } finally {dom.window.close();}
});
test('clearing destination search restores working shortcuts; cancelled Google details cannot save Home', () => {
    const {dom, w} = setup();
    try {
        w.ASIYE.ui.renderDestinationSearch();
        w.ASIYE.places.search('');
        assert.ok(w.document.querySelector('[data-place-shortcut="home"]'));
        w.document.querySelector('[data-place-shortcut="home"]').click();
        let resolve;
        w.ASIYE.places.placesService = {getDetails: (_, callback) => {resolve = callback;}};
        w.google = {maps: {places: {PlacesServiceStatus: {OK: 'OK'}}}};
        w.ASIYE.places.resolvePlaceDetails({placeId: 'some-google-place'});
        w.document.getElementById('savedPlaceBack').click();
        resolve({name: 'Wrong saved place', formatted_address: home.address, geometry: {location: {lat: () => home.latitude, lng: () => home.longitude}}}, 'OK');
        assert.equal(w.ASIYE.savedPlaces.read().home, null);
        assert.equal(w.ASIYE.state.destination.address, undefined);
    } finally {dom.window.close();}
});
test('invalid/corrupt storage and account changes during editing do not leak or overwrite places', () => {
    const {dom, w, account} = setup();
    try {
        w.localStorage.setItem(w.ASIYE.savedPlaces.key(), '{broken');
        assert.equal(w.ASIYE.savedPlaces.read().home, null);
        assert.throws(() => w.ASIYE.savedPlaces.save('home', {...home, latitude: null}), /Select an address/);
        w.ASIYE.savedPlaces.renderEditor('home');
        account('passenger-b');
        w.ASIYE.places.renderSuggestions([home]);
        w.document.querySelector('[data-place-index="0"]').click();
        assert.equal(w.ASIYE.savedPlaces.read().home, null);
    } finally {dom.window.close();}
});
test('Go offers and driver counteroffers expose passenger prices without the internal earnings split', () => {
    const {dom, w} = setup();
    try {
        w.ASIYE.state.booking = {rideType: 'go', goNegotiation: {offer: 118}};
        w.ASIYE.pricing = {clampGoOffer: value => Math.max(112, Math.min(124, value))};
        w.ASIYE.goNegotiation.mount(w.document.getElementById('sheetContent'), {marketReference: 131, goMinimumOffer: 112, goMaximumOffer: 124, goSuggested: 118});
        assert.match(w.document.getElementById('sheetContent').textContent, /You pay/);
        assert.equal(w.document.getElementById('goFarePassengerAmount').textContent, 'R118');
        assert.doesNotMatch(w.document.getElementById('sheetContent').textContent, /Driver receives|Asiye fee|89\.60|22\.40/);
        w.ASIYE.ride.renderGoFareCounter({driverCounterFare: 120, passengerOffer: 118, maximumFareOffer: 124, counterDriverNetFare: 96, counterPlatformCommission: 24});
        assert.doesNotMatch(w.document.getElementById('sheetContent').textContent, /Driver receives|Asiye fee/);
        assert.match(w.document.getElementById('sheetContent').textContent, /Accept R120/);
    } finally {dom.window.close();}
});

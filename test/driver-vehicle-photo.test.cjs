const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const memberPagesSource = fs.readFileSync(
    path.join(__dirname, '../assets/member-pages.js'),
    'utf8'
);
const functionsSource = fs.readFileSync(
    path.join(__dirname, '../functions/index.js'),
    'utf8'
);

function element() {
    return {
        innerHTML: '', textContent: '', children: {}, hidden: false,
        disabled: false, src: '',
        setAttribute() {}, append() {}, close() {}, remove() {}, showModal() {},
        addEventListener() {},
        querySelector(key) { return this.children[key] ||= element(); }
    };
}

function driverScreen() {
    const writes = [], requests = [];
    const driver = { name: 'Test Driver', vehiclePhoto: '' };
    const fields = {
        type: 'sedan', make: 'Toyota', model: 'Corolla', colour: 'White',
        registration: 'ND 123 456', year: '2022', seats: '4'
    };
    const context = {
        document: {
            createElement: () => element(),
            body: element(),
            head: { appendChild() {} },
            getElementById: () => null
        },
        firebase: {
            auth: () => ({ currentUser: { getIdToken: async () => 'test-token' } }),
            database: () => ({
                ref(root) {
                    return {
                        async update(patch) { writes.push({ root, patch }); throw Error('Permission denied'); },
                        async once() { return { val: () => ({}) }; }
                    };
                }
            })
        },
        FormData: class { get(key) { return fields[key]; } },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return {
                ok: true,
                async json() { return { ok: true, vehiclePending: { ...fields, year: 2022, seats: 4 } }; }
            };
        },
        ASIYE_DRIVER: { state: { driverId: 'driver-legacy-id', driver }, ui: { toast() {} } },
        console
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(memberPagesSource, context);
    return { context, writes, requests, driver };
}

test('vehicle photo is saved by proxy without a forbidden client database write', async () => {
    const { context, writes, driver } = driverScreen();
    await context.AsiyePages.open('vehicle');
    const main = context.AsiyePages.dialog.querySelector('main');
    let purpose;
    context.AsiyeFaceCapture.capture = async requestedPurpose => {
        purpose = requestedPurpose;
        return { dataUrl: 'data:image/jpeg;base64,cGhvdG8=' };
    };
    context.AsiyePhpImageUpload.upload = async (_image, options) => {
        assert.equal(options.userId, 'driver-legacy-id');
        assert.equal(options.purpose, 'driver-vehicle');
        return { ok: true, url: 'https://example.org/car.jpg' };
    };
    await main.querySelector('[data-driver-car-camera]').onclick();
    assert.equal(purpose, 'driver-vehicle');
    assert.equal(driver.vehiclePhoto, 'https://example.org/car.jpg');
    assert.equal(main.querySelector('[data-driver-car-preview]').src, 'https://example.org/car.jpg');
    assert.match(main.querySelector('[data-driver-car-status]').textContent, /photo saved/i);
    assert.equal(writes.length, 0, 'server response must be authoritative');
});

test('vehicle details use the authenticated review endpoint rather than client writes', async () => {
    const { context, writes, requests, driver } = driverScreen();
    driver.vehiclePhoto = 'https://example.org/car.jpg';
    await context.AsiyePages.open('vehicle');
    const form = context.AsiyePages.dialog.querySelector('main')
        .querySelector('[data-driver-vehicle-form]');
    await form.onsubmit({ preventDefault() {} });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /submitDriverVehicleForReview$/);
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.driverId, 'driver-legacy-id');
    assert.equal(payload.vehicle.registration, 'ND 123 456');
    assert.equal(driver.vehicleApprovalStatus, 'pending');
    assert.equal(writes.length, 0);
});

test('backend owns vehicle images and verifies driver identity', () => {
    assert.match(functionsSource, /exports\\.uploadProfileImageProxy\\s*=/);
    assert.match(functionsSource, /exports\\.submitDriverVehicleForReview\\s*=/);
    assert.match(functionsSource, /profileOwnedByAuth\\(/);
    assert.match(functionsSource, /vehicleImageStoragePath/);
    assert.match(functionsSource, /vehicleApproved: false/);
    assert.match(memberPagesSource, /preserveAspectRatio: options\\.purpose === 'driver-vehicle'/);
});

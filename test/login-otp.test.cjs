const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createMockContext(scriptPath) {
    const storage = new Map();
    const postedMessages = [];

    const elements = new Map();
    function getElement(id) {
        if (!elements.has(id)) {
            elements.set(id, {
                id,
                value: '',
                textContent: '',
                innerHTML: '',
                disabled: false,
                classList: {
                    add: () => {},
                    remove: () => {},
                    contains: () => false
                },
                addEventListener: () => {},
                focus: () => {}
            });
        }
        return elements.get(id);
    }

    const context = {
        window: {
            location: {
                href: '',
                replace: (url) => { context.window.location.href = url; }
            },
            Asiye: {
                postMessage: (msg) => { postedMessages.push(JSON.parse(msg)); }
            }
        },
        document: {
            getElementById: (id) => getElement(id),
            querySelectorAll: () => [],
            addEventListener: () => {}
        },
        localStorage: {
            getItem: (key) => storage.get(key) || null,
            setItem: (key, val) => storage.set(key, String(val)),
            removeItem: (key) => storage.delete(key),
            clear: () => storage.clear()
        },
        firebase: {
            auth: Object.assign(() => ({
                currentUser: null,
                setPersistence: async () => {},
                onAuthStateChanged: (cb) => { cb(null); return () => {}; },
                signInWithPhoneNumber: async () => ({ confirm: async () => ({ user: { uid: 'u123', phoneNumber: '+27821234567' } }) })
            }), {
                Auth: { Persistence: { LOCAL: 'LOCAL' } },
                RecaptchaVerifier: class {
                    constructor(container, options) {
                        this.container = container;
                        this.options = options;
                    }
                    async render() { return 1; }
                    clear() {}
                }
            }),
            database: Object.assign(() => ({
                ref: () => ({
                    once: async () => ({ exists: () => false, val: () => null }),
                    orderByChild: () => ({
                        equalTo: () => ({
                            once: async () => ({ exists: () => false, forEach: () => {} })
                        })
                    }),
                    update: async () => {},
                    set: async () => {}
                })
            }), {
                ServerValue: { TIMESTAMP: 1234567890 }
            }),
            apps: [{ name: '[DEFAULT]' }]
        },
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        queueMicrotask: (fn) => { fn(); }
    };

    context.window.localStorage = context.localStorage;
    context.window.document = context.document;
    context.window.firebase = context.firebase;
    context.AsiyeEnrollment = {
        getStatus: async () => ({ state: 'approved' })
    };
    context.window.AsiyeEnrollment = context.AsiyeEnrollment;

    vm.createContext(context);
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context);

    return {
        context,
        storage,
        postedMessages,
        getElement
    };
}

test('Passenger phone normalization handles valid and invalid formats', () => {
    const { context } = createMockContext('assets/passenger-v2/js/login.js');
    const login = context.window.ASIYE_PASSENGER_LOGIN;

    assert.equal(login.normalizePhone('0821234567'), '+27821234567');
    assert.equal(login.normalizePhone('082 123 4567'), '+27821234567');
    assert.equal(login.normalizePhone('+27 82 123 4567'), '+27821234567');
    assert.equal(login.normalizePhone('27821234567'), '+27821234567');
    assert.equal(login.normalizePhone('+27821234567'), '+27821234567');

    assert.equal(login.normalizePhone('123'), null);
    assert.equal(login.normalizePhone('abcdefghij'), null);
    assert.equal(login.normalizePhone(''), null);
    assert.equal(login.normalizePhone(null), null);
});

test('Passenger phone variants include spaced and international formats', () => {
    const { context } = createMockContext('assets/passenger-v2/js/login.js');
    const login = context.window.ASIYE_PASSENGER_LOGIN;

    const variants = login.buildPhoneVariants('0821234567');
    assert.ok(variants.includes('+27821234567'));
    assert.ok(variants.includes('27821234567'));
    assert.ok(variants.includes('0821234567'));
    assert.ok(variants.includes('821234567'));
    assert.ok(variants.includes('082 123 4567'));
    assert.ok(variants.includes('+27 82 123 4567'));
});

test('Passenger completeLogin stores session, notifies Flutter and redirects to index.html', async () => {
    const { context, storage, postedMessages } = createMockContext('assets/passenger-v2/js/login.js');
    const login = context.window.ASIYE_PASSENGER_LOGIN;

    await login.completeLogin('commuter_42', { name: 'Thabo', profileImageUrl: 'https://example.test/face.jpg' }, { uid: 'auth_uid_42', phoneNumber: '+27821234567' });

    assert.equal(storage.get('userId'), 'commuter_42');
    assert.equal(storage.get('commuterId'), 'commuter_42');
    assert.equal(storage.get('authUid'), 'auth_uid_42');
    assert.equal(storage.get('userType'), 'commuter');
    assert.equal(storage.get('userName'), 'Thabo');

    assert.equal(postedMessages.length, 1);
    assert.deepEqual(postedMessages[0], {
        action: 'onUserLoggedIn',
        uid: 'commuter_42',
        type: 'commuter'
    });

    assert.equal(context.window.location.href, './index.html');
});

test('Passenger prepareRecaptcha configures auto-renewing expired-callback and clears container', () => {
    const { context, getElement } = createMockContext('assets/passenger-v2/js/login.js');
    delete context.window.Asiye;
    delete context.window.Android;
    const login = context.window.ASIYE_PASSENGER_LOGIN;

    const container = getElement('recaptcha-container');
    container.innerHTML = '<iframe src="old"></iframe>';

    login.prepareRecaptcha();

    assert.equal(container.innerHTML, '');
    assert.ok(login.recaptchaVerifier);
    assert.ok(typeof login.recaptchaVerifier.options['expired-callback'] === 'function');
});

test('Driver phone normalization handles valid and invalid formats', () => {
    const { context } = createMockContext('assets/driver-v2/js/login.js');
    const login = context.window.ASIYE_DRIVER_LOGIN;

    assert.equal(login.normalizePhone('0821234567'), '+27821234567');
    assert.equal(login.normalizePhone('082 123 4567'), '+27821234567');
    assert.equal(login.normalizePhone('+27 82 123 4567'), '+27821234567');
    assert.equal(login.normalizePhone('27821234567'), '+27821234567');
    assert.equal(login.normalizePhone('+27821234567'), '+27821234567');

    assert.equal(login.normalizePhone('123'), null);
    assert.equal(login.normalizePhone('abcdefghij'), null);
    assert.equal(login.normalizePhone(''), null);
});

test('Driver completeDriverLogin stores session, notifies Flutter and redirects to index.html', async () => {
    const { context, storage, postedMessages } = createMockContext('assets/driver-v2/js/login.js');
    const login = context.window.ASIYE_DRIVER_LOGIN;

    await login.completeDriverLogin('taxi_99', { name: 'Sipho' }, { uid: 'auth_uid_99', phoneNumber: '+27839876543' });

    assert.equal(storage.get('driverId'), 'taxi_99');
    assert.equal(storage.get('userId'), 'taxi_99');
    assert.equal(storage.get('authUid'), 'auth_uid_99');
    assert.equal(storage.get('userType'), 'driver');
    assert.equal(storage.get('driverName'), 'Sipho');

    assert.equal(postedMessages.length, 1);
    assert.deepEqual(postedMessages[0], {
        action: 'onUserLoggedIn',
        uid: 'taxi_99',
        type: 'driver'
    });

    assert.equal(context.window.location.href, './index.html');
});

test('Driver prepareRecaptcha configures auto-renewing expired-callback and clears container', () => {
    const { context, getElement } = createMockContext('assets/driver-v2/js/login.js');
    delete context.window.Asiye;
    delete context.window.Android;
    const login = context.window.ASIYE_DRIVER_LOGIN;

    const container = getElement('recaptcha-container');
    container.innerHTML = '<iframe src="old"></iframe>';

    login.prepareRecaptcha();

    assert.equal(container.innerHTML, '');
    assert.ok(login.recaptchaVerifier);
    assert.ok(typeof login.recaptchaVerifier.options['expired-callback'] === 'function');
});

test('Pending driver remains on enrollment status and does not create a dashboard session', async () => {
    const { context, storage, postedMessages } = createMockContext('assets/driver-v2/js/login.js');
    context.AsiyeEnrollment.getStatus = async () => ({ state: 'pending' });
    const login = context.window.ASIYE_DRIVER_LOGIN;

    await login.completeDriverLogin(
        'taxi_pending', { name: 'Pending Driver' },
        { uid: 'pending-auth', phoneNumber: '+27821234567' }
    );

    assert.equal(context.window.location.href, './enrollment.html');
    assert.equal(storage.has('driverId'), false);
    assert.equal(postedMessages.length, 0);
});

test('OTP passenger missing face photo cannot enter main app', async () => {
    const { context, storage, postedMessages } = createMockContext('assets/passenger-v2/js/login.js');
    const login = context.window.ASIYE_PASSENGER_LOGIN;
    await login.completeLogin('new-passenger', { name: 'New Rider' },
        { uid: 'passenger-auth', phoneNumber: '+27821234567' });
    assert.equal(context.window.location.href, '');
    assert.equal(storage.has('commuterId'), false);
    assert.equal(postedMessages.length, 0);
    assert.equal(getElementStatus(context, 'newPassengerStep'), true);
});

function getElementStatus(context, name) {
    // The onboarding gate calls showStep only after refusing the session.
    return context.window.ASIYE_PASSENGER_LOGIN.pendingProfileId === 'new-passenger';
}

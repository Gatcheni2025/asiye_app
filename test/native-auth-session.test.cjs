const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeStorage(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        values
    };
}

function createContext(role = 'passenger', options = {}) {
    const storage = makeStorage({
        asiyePendingPhoneAuthNumber: '+27821234567',
        asiyePendingPhoneAuthVerificationId: 'verification-1'
    });

    const calls = {
        customToken: null,
        passengerUser: null,
        driverUser: null,
        signOut: 0,
        persistence: null,
        toast: []
    };

    const firebaseUser = {
        uid: options.userUid || 'auth-uid-1',
        phoneNumber: '+27821234567'
    };

    const authInstance = {
        setPersistence: async value => {
            calls.persistence = value;
        },
        signInWithCustomToken: async token => {
            calls.customToken = token;
            return { user: firebaseUser };
        },
        signOut: async () => {
            calls.signOut += 1;
        }
    };

    const baseLogin = {
        nativeVerificationId: 'verification-1',
        confirmationResult: {},
        toast: message => calls.toast.push(message)
    };

    const context = {
        window: {},
        localStorage: storage,
        document: {
            getElementById: () => null
        },
        firebase: {
            apps: [{ name: '[DEFAULT]' }],
            auth: Object.assign(
                () => authInstance,
                {
                    Auth: {
                        Persistence: {
                            LOCAL: 'LOCAL'
                        }
                    }
                }
            )
        },
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        }
    };

    if (role === 'driver') {
        context.window.ASIYE_DRIVER_LOGIN = {
            ...baseLogin,
            verifyDriverProfile: async user => {
                calls.driverUser = user;
            }
        };
    } else {
        context.window.ASIYE_PASSENGER_LOGIN = {
            ...baseLogin,
            afterAuthentication: async user => {
                calls.passengerUser = user;
            }
        };
    }

    context.window.localStorage = storage;
    context.window.document = context.document;
    context.window.firebase = context.firebase;

    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(
            'assets/native-auth-session.js',
            'utf8'
        ),
        context
    );

    return {
        context,
        storage,
        calls,
        firebaseUser
    };
}

test('native phone custom token completes passenger login and clears pending OTP state', async () => {
    const { context, storage, calls, firebaseUser } =
        createContext('passenger');

    await context.window.onNativeAuthSession({
        provider: 'phone',
        customToken: 'custom-token-1',
        uid: firebaseUser.uid
    });

    assert.equal(calls.customToken, 'custom-token-1');
    assert.equal(calls.passengerUser, firebaseUser);
    assert.equal(calls.driverUser, null);
    assert.equal(calls.persistence, 'LOCAL');
    assert.equal(
        storage.getItem('asiyePendingPhoneAuthNumber'),
        null
    );
    assert.equal(
        storage.getItem('asiyePendingPhoneAuthVerificationId'),
        null
    );
});

test('native custom token completes driver profile resolution', async () => {
    const { context, calls, firebaseUser } =
        createContext('driver');

    await context.window.onNativeAuthSession({
        provider: 'google',
        customToken: 'custom-token-driver',
        uid: firebaseUser.uid
    });

    assert.equal(
        calls.customToken,
        'custom-token-driver'
    );
    assert.equal(
        calls.driverUser,
        firebaseUser
    );
    assert.equal(
        calls.passengerUser,
        null
    );
});

test('native auth rejects a mismatched Firebase UID and signs out the WebView session', async () => {
    const { context, calls } =
        createContext('passenger', {
            userUid: 'actual-user'
        });

    await assert.rejects(
        () => context.window.onNativeAuthSession({
            provider: 'apple',
            customToken: 'custom-token-2',
            uid: 'different-user'
        }),
        /session mismatch/i
    );

    assert.equal(calls.signOut, 1);
    assert.equal(calls.passengerUser, null);
});

test('native auth requires a custom token', async () => {
    const { context } =
        createContext('passenger');

    await assert.rejects(
        () => context.window.onNativeAuthSession({
            provider: 'phone',
            uid: 'auth-uid-1'
        }),
        /secure Asiye session/i
    );
});

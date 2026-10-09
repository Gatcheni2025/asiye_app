const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const booking = fs.readFileSync(
    'assets/passenger-v2/js/booking.js',
    'utf8'
);
const wallet = fs.readFileSync(
    'assets/passenger-v2/js/wallet.js',
    'utf8'
);
const app = fs.readFileSync(
    'assets/passenger-v2/js/app.js',
    'utf8'
);

test('Go card booking defers PIN and live-share until after Paystack', () => {
    const createStart =
        booking.indexOf('async createGoRide()');
    const finalizerStart =
        booking.indexOf('async finalizePaidCardBooking');

    assert.ok(createStart >= 0);
    assert.ok(finalizerStart > createStart);

    const createBlock =
        booking.slice(
            createStart,
            finalizerStart
        );

    assert.match(
        createBlock,
        /const\s+isCardPayment\s*=\s*paymentMethod\s*===\s*['"]card['"]/
    );

    assert.match(
        createBlock,
        /const\s+pickupPin\s*=\s*isCardPayment\s*\?\s*null\s*:\s*await\s+this\.requirePassengerPin\(\)/
    );

    const cardGate =
        createBlock.indexOf(
            'if (isCardPayment)'
        );
    const firstLiveShare =
        createBlock.indexOf(
            'await this.createLiveShareUrl'
        );

    assert.ok(
        cardGate >= 0,
        'Card gate is required.'
    );
    assert.ok(
        firstLiveShare > cardGate,
        'Non-card live-share code must appear after the card-first return path.'
    );

    assert.match(
        createBlock,
        /await\s+ASIYE\.payments\s*\.prepare\s*\(\s*requestId\s*\)/
    );

    assert.match(
        createBlock,
        /paymentPending\s*:\s*true/
    );
});

test('Verified Go card return generates PIN, shares trip, then dispatches', () => {
    const finalizerStart =
        booking.indexOf(
            'async finalizePaidCardBooking'
        );
    const finalizerEnd =
        booking.indexOf(
            'FIND + NOTIFY GO DRIVERS',
            finalizerStart
        );

    assert.ok(finalizerStart >= 0);
    assert.ok(finalizerEnd > finalizerStart);

    const block =
        booking.slice(
            finalizerStart,
            finalizerEnd
        );

    const pin =
        block.indexOf(
            'this.generatePin()'
        );
    const live =
        block.indexOf(
            'await this.createLiveShareUrl'
        );
    const share =
        block.indexOf(
            'await this.requireTripShare'
        );
    const pending =
        block.indexOf(
            "status:\n                'pending'"
        );
    const dispatch =
        block.indexOf(
            'await this.notifyGoDrivers'
        );

    assert.ok(pin >= 0);
    assert.ok(live > pin);
    assert.ok(share > live);
    assert.ok(pending > share);
    assert.ok(dispatch > pending);

    assert.match(
        block,
        /paymentStatus[\s\S]*held[\s\S]*captured/
    );
});

test('Paystack return finalizes Go safety before clearing pending payment', () => {
    const start =
        wallet.indexOf(
            'async handleCardReturn(reference)'
        );
    const end =
        wallet.indexOf(
            'async handleTripState',
            start
        );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const block =
        wallet.slice(start, end);

    const goFinalizer =
        block.indexOf(
            '.finalizePaidCardBooking'
        );
    const markerClear =
        block.indexOf(
            "localStorage.removeItem(\n                'pendingTripCardPayment'",
            goFinalizer
        );

    assert.ok(
        goFinalizer >= 0,
        'Verified Go payment must call the safety finalizer.'
    );
    assert.ok(
        markerClear > goFinalizer,
        'Pending payment must remain available until safety finalization succeeds.'
    );
});

test('Passenger UI explains payment-first card booking sequence', () => {
    assert.match(
        app,
        /After payment, Asiye will create your trip PIN/
    );
    assert.match(
        app,
        /share the live trip with a loved one/
    );
});

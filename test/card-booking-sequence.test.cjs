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
const ride = fs.readFileSync(
    'assets/passenger-v2/js/ride-controller.js',
    'utf8'
);

test('Go card booking negotiates before Paystack, PIN and live-share', () => {
    const createStart =
        booking.indexOf('async createGoRide()');
    const legacyStart =
        booking.indexOf(
            'Legacy fixed-fare payment flow',
            createStart
        );

    assert.ok(createStart >= 0);
    assert.ok(legacyStart > createStart);

    const protectedBlock =
        booking.slice(
            createStart,
            legacyStart
        );

    assert.match(
        protectedBlock,
        /const\s+isCardPayment\s*=\s*paymentMethod\s*===\s*['"]card['"]/
    );

    assert.match(
        protectedBlock,
        /const\s+pickupPin\s*=\s*null/
    );

    assert.match(
        protectedBlock,
        /fareStatus:\s*['"]passenger_offer['"]/
    );

    assert.match(
        protectedBlock,
        /paymentStatus:\s*['"]negotiation_pending['"]/
    );

    const offer =
        protectedBlock.indexOf(
            '.submitOffer('
        );
    const dispatch =
        protectedBlock.indexOf(
            'await this.notifyGoDrivers'
        );
    const result =
        protectedBlock.indexOf(
            'return requestId'
        );

    assert.ok(offer >= 0);
    assert.ok(dispatch > offer);
    assert.ok(result > dispatch);

    assert.equal(
        protectedBlock.includes(
            'ASIYE.payments\n                        .prepare'
        ),
        false,
        'Card must not open Paystack before fare agreement.'
    );

    assert.equal(
        protectedBlock.includes(
            'requireTripShare({'
        ),
        false,
        'Safety sharing must wait until fare/payment agreement.'
    );
});

test('Negotiated card finalizer creates PIN/share then server activates reserved driver', () => {
    const start =
        booking.indexOf(
            'async finalizeNegotiatedGoBooking'
        );
    const end =
        booking.indexOf(
            'Final card-booking gate',
            start
        );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const block =
        booking.slice(
            start,
            end
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
    const finalize =
        block.indexOf(
            "'finalizeNegotiatedGoBooking'"
        );
    const rideStart =
        block.indexOf(
            'await ASIYE.ride'
        );

    assert.ok(pin >= 0);
    assert.ok(live > pin);
    assert.ok(share > live);
    assert.ok(finalize > share);
    assert.ok(rideStart > finalize);

    assert.equal(
        block.includes(
            'notifyGoDrivers'
        ),
        false,
        'The agreed driver is already reserved; payment finalization must not broadcast again.'
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

test('Passenger UI explains agreed-fare card payment and reserved driver state', () => {
    assert.match(
        ride,
        /Fare agreed/
    );

    assert.match(
        ride,
        /Driver reserved/
    );

    assert.match(
        ride,
        /Complete Paystack payment/
    );

    assert.match(
        ride,
        /pickup PIN and live-share link/
    );
});

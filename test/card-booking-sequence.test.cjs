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

test('Negotiated card finalizer asks the server to unlock pickup without pre-arrival sharing', () => {
    const start = booking.indexOf('async finalizeNegotiatedGoBooking');
    const end = booking.indexOf('async completeGoSafetyShare', start);
    const block = booking.slice(start, end);
    const finalize = block.indexOf("'finalizeNegotiatedGoBooking'");
    assert.ok(finalize >= 0);
    assert.ok(block.indexOf('await ASIYE.ride', finalize) > finalize);
    assert.equal(block.includes('this.generatePin()'), false);
    assert.equal(block.includes('requireTripShare'), false);
    assert.equal(block.includes('notifyGoDrivers'), false);
});

test('Paystack return serializes safety finalization before clearing pending payment', () => {
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

    const cardSection =
        block.indexOf(
            'ASIYE GO CARD:'
        );

    const lock =
        block.indexOf(
            'this._cardSafetyFinalizeActive =',
            cardSection
        );

    const goFinalizer =
        block.indexOf(
            'await ASIYE.booking',
            lock
        );

    const markerClear =
        block.indexOf(
            "'pendingTripCardPayment'",
            goFinalizer
        );

    const unlock =
        block.indexOf(
            'this._cardSafetyFinalizeActive =',
            markerClear
        );

    assert.ok(cardSection >= 0);
    assert.ok(lock > cardSection);
    assert.ok(
        goFinalizer > lock,
        'Safety finalization must run only after the single-flight lock is acquired.'
    );
    assert.ok(
        markerClear > goFinalizer,
        'Pending payment must remain available until safety finalization succeeds.'
    );
    assert.ok(
        unlock > markerClear,
        'Safety lock must be released after finalization and marker cleanup.'
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
        /Share the trip after arrival/
    );
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  WAIT_MS,
  expire,
  offer,
  acceptFare,
  driverAction,
} = require("../functions/club-lifecycle");
const { canIssueTripShare } = require("../functions/trip-share-security");
function pool(count = 2) {
  return {
    requestId: "club-test",
    clubSecurityVersion: 2,
    type: "club",
    status: "driver_waiting",
    createdAt: 1000,
    workWaitStartedAt: 1000,
    workWaitExpiresAt: 1000 + WAIT_MS,
    requiredPassengers: 3,
    minimumPassengers: 3,
    capacity: 4,
    passengerCount: count,
    taxiId: "d",
    driverAuthUid: "driver",
    driverAcceptedAt: 2000,
    totalPoolFare: 345,
    pricePerPassenger: 115,
    passengers: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        "p" + i,
        {
          name: "Passenger " + i,
          authUid: "user" + i,
          status: "waiting_pool",
          price: 115,
          paymentMethod: "cash",
          pickupAddress: "Pickup " + i,
          destination: "Destination " + i,
        },
      ]),
    ),
  };
}
const evidence = (p) => ({
  ledgers: Object.fromEntries(
    Object.entries(p.passengers).map(([id, v]) => [
      id,
      {
        method: v.paymentMethod,
        amount: v.price,
        status: v.paymentMethod === "cash" ? "cash_due" : "held",
      },
    ]),
  ),
  nearPickup: true,
  pinValid: true,
});
test("one immutable 30 minute deadline survives updates and enters negotiation at the boundary", () => {
  const p = pool();
  expire(p, p.workWaitExpiresAt - 1);
  assert.equal(p.status, "driver_waiting");
  expire(p, p.workWaitExpiresAt);
  assert.equal(p.status, "work_negotiation");
  assert.equal(p.workWaitStartedAt, 1000);
  assert.equal(p.workWaitExpiresAt, 1000 + WAIT_MS);
});
test("full group can collect early but expiry never rewinds collection or transit", () => {
  const p = pool(3);
  p.paymentsReady = true;
  expire(p, 2000);
  assert.equal(p.status, "pool_ready");
  driverAction(p, "driver", { action: "collect" }, evidence(p), 2001);
  expire(p, p.workWaitExpiresAt);
  assert.equal(p.status, "collecting_passengers");
});
test("only active passengers negotiate, after expiry and within the protected fare range", () => {
  const p = pool();
  assert.throws(() => offer(p, "p0", 330, 2000));
  assert.throws(() => offer(p, "outsider", 330, p.workWaitExpiresAt));
  assert.throws(() => offer(p, "p0", 100, p.workWaitExpiresAt));
  assert.throws(() => offer(p, "p0", 400, p.workWaitExpiresAt));
});
test("passengers approve exact amount; changed amount clears previous approvals", () => {
  const p = pool();
  offer(p, "p0", 330, p.workWaitExpiresAt);
  offer(p, "p1", 335, p.workWaitExpiresAt);
  assert.equal(p.workNegotiation.approvedCount, 1);
  assert.equal(p.workNegotiation.passengerApprovals.p0, undefined);
  offer(p, "p0", 335, p.workWaitExpiresAt);
  assert.equal(p.workNegotiation.status, "driver_offer");
});
test("assigned driver accepts latest revision only and preserves exact cents with 80/20 split", () => {
  const p = pool();
  offer(p, "p0", 330.01, p.workWaitExpiresAt);
  offer(p, "p1", 330.01, p.workWaitExpiresAt);
  const rev = p.workNegotiation.revision;
  assert.throws(() => acceptFare(p, "other", rev, 3));
  assert.throws(() => acceptFare(p, "driver", rev - 1, 3));
  acceptFare(p, "driver", rev, 3);
  assert.equal(p.passengers.p0.price + p.passengers.p1.price, 330.01);
  assert.equal(p.platformCommission + p.driverNetFare, 330.01);
  assert.equal(p.requiredPassengers, 2);
  assert.equal(p.workNegotiation.status, "driver_accepted");
});
test("driver counteroffer resets every passenger approval and invalidates stale accept taps", () => {
  const p = pool();
  offer(p, "p0", 330, p.workWaitExpiresAt);
  offer(p, "p1", 330, p.workWaitExpiresAt);
  const rev = p.workNegotiation.revision;
  driverAction(
    p,
    "driver",
    { action: "counterFare", revision: rev, amount: 340 },
    {},
    4,
  );
  assert.equal(p.workNegotiation.approvedCount, 0);
  assert.throws(() => acceptFare(p, "driver", rev, 5));
  offer(p, "p0", 340, p.workWaitExpiresAt);
  offer(p, "p1", 340, p.workWaitExpiresAt);
  acceptFare(p, "driver", p.workNegotiation.revision, 6);
  assert.equal(p.totalPoolFare, 340);
});
test("fare acceptance is rejected after pool membership changes", () => {
  const p = pool();
  offer(p, "p0", 330, p.workWaitExpiresAt);
  offer(p, "p1", 330, p.workWaitExpiresAt);
  p.passengers.p1.status = "cancelled_by_commuter";
  assert.throws(() => acceptFare(p, "driver", p.workNegotiation.revision, 4));
});
test("collection needs driver acceptance plus private ledger method/amount/status", () => {
  for (const tweak of [
    (p) => (p.driverAcceptedAt = null),
    (p) => (p.poolReady = false),
  ]) {
    const p = pool(3);
    p.poolReady = true;
    p.paymentsReady = true;
    tweak(p);
    assert.throws(() =>
      driverAction(p, "driver", { action: "collect" }, evidence(p), 2),
    );
  }
  const p = pool(3);
  p.poolReady = true;
  p.status = "pool_ready";
  const e = evidence(p);
  e.ledgers.p0.amount = 1;
  assert.throws(() => driverAction(p, "driver", { action: "collect" }, e, 2));
});
test("non-cash collection requires held/captured payment at accepted amount", () => {
  const p = pool(3);
  p.poolReady = true;
  p.status = "pool_ready";
  p.passengers.p0.paymentMethod = "card";
  const e = evidence(p);
  e.ledgers.p0.status = "payment_required";
  assert.throws(() => driverAction(p, "driver", { action: "collect" }, e, 2));
  e.ledgers.p0.status = "held";
  driverAction(p, "driver", { action: "collect" }, e, 2);
  assert.equal(p.status, "collecting_passengers");
});
test("arrival requires assigned driver and fresh proximity evidence", () => {
  const p = pool(3);
  p.poolReady = true;
  p.status = "collecting_passengers";
  assert.throws(() =>
    driverAction(
      p,
      "intruder",
      { action: "arrive", passengerId: "p0" },
      evidence(p),
      3,
    ),
  );
  assert.throws(() =>
    driverAction(
      p,
      "driver",
      { action: "arrive", passengerId: "p0" },
      { ...evidence(p), nearPickup: false },
      3,
    ),
  );
  driverAction(
    p,
    "driver",
    { action: "arrive", passengerId: "p0" },
    evidence(p),
    3,
  );
  assert.equal(p.passengers.p0.arrivedAt, 3);
});
test("PIN is blocked before arrival; incorrect attempts persist and lock at five", () => {
  const p = pool(3);
  p.poolReady = true;
  p.status = "collecting_passengers";
  assert.throws(() =>
    driverAction(
      p,
      "driver",
      { action: "verifyPin", passengerId: "p0" },
      evidence(p),
      3,
    ),
  );
  driverAction(
    p,
    "driver",
    { action: "arrive", passengerId: "p0" },
    evidence(p),
    3,
  );
  for (let i = 0; i < 5; i++)
    driverAction(
      p,
      "driver",
      { action: "verifyPin", passengerId: "p0" },
      { ...evidence(p), pinValid: false },
      4,
    );
  assert.equal(p.passengers.p0.pinAttempts, 5);
  assert.equal(p.passengers.p0.pinVerifiedAt, undefined);
  assert.throws(() =>
    driverAction(
      p,
      "driver",
      { action: "verifyPin", passengerId: "p0" },
      evidence(p),
      5,
    ),
  );
});
test("departure waits for every arrival and server PIN verification; repeated start is harmless", () => {
  const p = pool(3);
  p.poolReady = true;
  p.status = "collecting_passengers";
  assert.throws(() =>
    driverAction(p, "driver", { action: "start" }, evidence(p), 4),
  );
  for (const id of Object.keys(p.passengers)) {
    driverAction(
      p,
      "driver",
      { action: "arrive", passengerId: id },
      evidence(p),
      4,
    );
    driverAction(
      p,
      "driver",
      { action: "verifyPin", passengerId: id },
      evidence(p),
      5,
    );
  }
  driverAction(p, "driver", { action: "start" }, evidence(p), 6);
  driverAction(p, "driver", { action: "start" }, evidence(p), 7);
  assert.equal(p.tripStartedAt, 6);
  assert.equal(p.status, "in_transit");
});
test("secure share token cannot be issued before own arrival or to another passenger/driver", () => {
  const p = pool();
  assert.equal(canIssueTripShare(p, "p0", "user0"), false);
  p.passengers.p0.arrivedAt = 4;
  assert.equal(canIssueTripShare(p, "p0", "user0"), true);
  assert.equal(canIssueTripShare(p, "p0", "driver"), false);
  assert.equal(canIssueTripShare(p, "p1", "user1"), false);
});
test("secure PINs are absent from the shared booking state", () => {
  const p = pool();
  assert.equal(JSON.stringify(p).includes("pickupPin"), false);
});

test('driver cancellation stops at first Club pickup arrival, including a concurrent arrival', () => {
  const waiting = pool();
  driverAction(waiting, 'driver', {action:'cancelDriver'}, {}, 100);
  assert.equal(waiting.status, 'cancelled_by_driver');
  const arrived = pool();
  arrived.status = 'collecting_passengers';
  arrived.passengers.p0.status = 'arrived';
  arrived.passengers.p0.arrivedAt = 99;
  assert.throws(() => driverAction(arrived, 'driver', {action:'cancelDriver'}, {}, 100), /arrived/);
});

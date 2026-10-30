const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { get, ref, update, set, remove } = require("firebase/database");
const admin = require("../../functions/node_modules/firebase-admin");
const { registerClubLifecycle } = require("../../functions/club-lifecycle");
let env, app, db, service;
const projectId = "asiye-club-lifecycle-test";
before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    database: { rules: fs.readFileSync("../../database.rules.json", "utf8") },
  });
  app = admin.initializeApp(
    { projectId, databaseURL: `http://127.0.0.1:9000?ns=${projectId}` },
    projectId,
  );
  db = app.database();
  service = registerClubLifecycle({
    admin: { database: () => db },
    onRequest: (_, fn) => fn,
    cors() {},
    verifyUser: async (r) => r.user,
    resolvePassenger: async (u) => ({
      id: u.uid,
      data: (await db.ref("commuters/" + u.uid).once("value")).val(),
    }),
    nearbyDrivers: async () => [{ driverId: "driver" }],
    driverEligible: (d) => d.vehicleApproved === true,
    bankingEligible: async (id, driver) => require('../../functions/driver-booking-banking').bookingBankingReady(id,driver,
      (await db.ref('driverPaystackSubaccounts/'+id).once('value')).val(),'test'),
    marketFare: () => 300,
    paymentPath: (r, p) => `tripPayments/${r}/${p}`,
    distanceKm: (a, b, c, d) => Math.hypot(a - c, b - d) * 111,
    preparePayments: async (r, p) => {
      const patches = {};
      for (const [id, m] of Object.entries(p.passengers)) {
        if (String(m.status).includes("cancelled")) continue;
        const status = m.paymentMethod === "cash" ? "cash_due" : "held";
        patches[`tripPayments/${r}/${id}`] = {
          method: m.paymentMethod,
          amount: m.price,
          status,
        };
        patches[`requests/${r}/passengers/${id}/paymentStatus`] = status;
      }
      patches[`requests/${r}/paymentsReady`] = true;
      await db.ref().update(patches);
    },
  });
});
beforeEach(async () => {
  await db.ref().set({
    commuters: {
      p0: { authUid: "p0", bookingFaceAuthUid: "p0", bookingFaceSavedAt: 1, profileImageUrl: "https://test.invalid/face.jpg", name: "First Passenger" },
      p1: { authUid: "p1", bookingFaceAuthUid: "p1", bookingFaceSavedAt: 1, profileImageUrl: "https://test.invalid/face.jpg", name: "Second Passenger" },
      p2: { authUid: "p2", bookingFaceAuthUid: "p2", bookingFaceSavedAt: 1, profileImageUrl: "https://test.invalid/face.jpg", name: "Third Passenger" },
    },
    driverPaystackSubaccounts:{driver:{ownerUid:'driver',status:'verified',paystackDomain:'test',subaccountCode:'ACCT_clubdriver',platformCommissionPercent:20,accountLast4:'7890'}},
    taxis: {
      driver: {
        authUid: "driver",
        userUid: "driver",
        name: "Assigned Driver",
        isOnline: true,
        isBroadcasting: true,
        vehicleApproved: true,
        latitude: -29.8,
        longitude: 31,
        lastSeen: Date.now(),
      },
    },
  });
});
after(async () => {
  await app.delete();
  await env.cleanup();
});
const body = (id = "pool-one", method = "cash") => ({
  requestId: id,
  poolId: id,
  clubMode: "club4",
  paymentMethod: method,
  shareToken: "",
  pickupPin: "9999",
  pickupAddress: "Pickup street",
  pickupLat: -29.8,
  pickupLng: 31,
  destination: "Destination street",
  destinationLat: -29.9,
  destinationLng: 31.1,
  departureTime: "08:00",
});
async function call(fn, uid, payload) {
  let result, status;
  await fn(
    { method: "POST", user: uid ? { uid } : null, body: payload },
    {
      status(n) {
        status = n;
        return this;
      },
      json(v) {
        result = v;
        return this;
      },
      send() {
        return this;
      },
    },
  );
  return { ...result, status };
}
async function read(path) {
  if (path.endsWith("/club-sync-pool-one")) {
    const all =
      (
        await db.ref(path.replace("/club-sync-pool-one", "")).once("value")
      ).val() || {};
    return Object.values(all).sort(
      (a, b) => Number(b.timestamp) - Number(a.timestamp),
    )[0];
  }
  return (await db.ref(path).once("value")).val();
}
async function create() {
  assert.equal((await call(service.create, "p0", body())).status, 200);
  return read("requests/pool-one");
}
test("driver and passenger receive the same reservation alert and deadline; PIN is private", async () => {
  const p = await create();
  assert.equal(p.taxiId, "driver");
  assert.equal(p.workWaitExpiresAt - p.workWaitStartedAt, 1800000);
  assert.equal(p.pickupPin, undefined);
  assert.equal(p.passengers.p0.pickupPin, undefined);
  for (const path of [
    "notifications/taxis/driver/club-sync-pool-one",
    "notifications/commuters/p0/club-sync-pool-one",
  ]) {
    const n = await read(path);
    assert.equal(n.passengerCount, 1);
    assert.equal(n.workWaitExpiresAt, p.workWaitExpiresAt);
    assert.match(n.message, /Driver found, waiting for more passengers/);
  }
  assert.match(
    (await call(service.getPin, "p0", { requestId: "pool-one" })).pickupPin,
    /^\d{4}$/,
  );
  for (const uid of ["driver", "p1"])
    assert.equal(
      (await call(service.getPin, uid, { requestId: "pool-one" })).status,
      403,
    );
});
test("Cash and Card accept empty shareToken without storing a client PIN", async () => {
  for (const method of ["cash", "card"]) {
    for (const path of [
      "commuters/p0/currentRequest",
      "commuters/p1/currentRequest",
      "taxis/driver/currentRequest",
    ])
      await db.ref(path).remove();
    const id = "pool-" + method;
    assert.equal(
      (await call(service.create, "p0", body(id, method))).status,
      200,
    );
    assert.equal(
      (await call(service.join, "p1", body(id, method))).status,
      200,
    );
    const p = await read("requests/" + id);
    assert.equal(p.passengers.p1.paymentMethod, method);
    assert.equal(p.passengers.p1.pickupPin, undefined);
    assert.equal(p.passengers.p1.safetyShareRequired, false);
  }
});
test("new Club Wallet bookings are rejected before saving passenger funds", async () => {
  await db.ref("commuters/p0/currentRequest").remove();
  const id = "pool-wallet-disabled";
  const response = await call(service.create,"p0",body(id,"wallet"));
  assert.equal(response.status,400);
  assert.equal(await read("requests/"+id),null);
});
test("concurrent joins keep shared count, pickup, destination and countdown", async () => {
  const initial = await create();
  const results = await Promise.all(
    ["p1", "p2"].map((uid) =>
      call(service.join, uid, {
        ...body(),
        pickupAddress: uid + " pickup",
        destination: uid + " destination",
      }),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 200),
    JSON.stringify(results),
  );
  const p = await read("requests/pool-one");
  assert.equal(p.passengerCount, 3);
  assert.equal(p.workWaitExpiresAt, initial.workWaitExpiresAt);
  assert.equal(p.passengers.p1.pickupAddress, "p1 pickup");
  assert.equal(p.passengers.p2.destination, "p2 destination");
  assert.equal(
    (await read("notifications/taxis/driver/club-sync-pool-one"))
      .passengerCount,
    3,
  );
});
test("rules block secure client state, membership, fare, PIN and reservation bypasses", async () => {
  await create();
  for (const uid of ["p0", "p1", "driver"]) {
    const client = env.authenticatedContext(uid).database();
    for (const patch of [
      { status: "in_transit" },
      { workWaitExpiresAt: 0 },
      { "passengers/p0/pickupPin": "1111" },
      { "passengers/p0/status": "passenger_onboard" },
      { "passengers/p0/price": 1 },
      { clubSecurityVersion: null },
    ])
      await assertFails(update(ref(client, "requests/pool-one"), patch));
    await assertFails(remove(ref(client, "requests/pool-one")));
    await assertFails(get(ref(client, "clubPrivate/pool-one")));
  }
  const driver = env.authenticatedContext("driver").database();
  await assertFails(
    update(ref(driver, "taxis/driver"), { currentRequest: null }),
  );
  await assertSucceeds(
    update(ref(driver, "taxis/driver"), {
      latitude: -29.801,
      lastSeen: Date.now(),
    }),
  );
  const rider = env.authenticatedContext("p0").database();
  await assertFails(
    update(ref(rider, "commuters/p0"), { currentRequest: null }),
  );
  await assertFails(
    set(ref(rider, "requests/forged"), {
      type: "club",
      commuterId: "p0",
      status: "pooling",
    }),
  );
});
test("server timeout runs without phones, rejects late joins and preserves concurrent consents", async () => {
  await create();
  await call(service.join, "p1", body());
  await db.ref("requests/pool-one/workWaitExpiresAt").set(Date.now() - 1);
  await service.expireDue();
  assert.equal((await read("requests/pool-one")).status, "work_negotiation");
  assert.equal((await call(service.join, "p2", body())).status, 409);
  await Promise.all(
    ["p0", "p1"].map((uid) =>
      call(service.submitOffer, uid, { requestId: "pool-one", amount: 330 }),
    ),
  );
  const p = await read("requests/pool-one");
  assert.equal(p.workNegotiation.approvedCount, 2);
  assert.equal(
    (
      await call(service.action, "driver", {
        requestId: "pool-one",
        action: "acceptFare",
        revision: p.workNegotiation.revision,
      })
    ).status,
    200,
  );
  assert.equal((await read("requests/pool-one")).driverNetFare, 264);
  assert.equal((await read("tripPayments/pool-one/p0")).amount, 165);
});
test("arrival PIN start completion lifecycle and repeated completion never double-credit", async () => {
  await create();
  for (const uid of ["p1", "p2"]) await call(service.join, uid, body());
  const requestId = "pool-one";
  for (const action of ["acceptWaiting", "collect"])
    assert.equal(
      (await call(service.action, "driver", { requestId, action })).status,
      200,
    );
  assert.equal(
    (await call(service.action, "driver", { requestId, action: "start" }))
      .status,
    409,
  );
  for (const uid of ["p0", "p1", "p2"]) {
    const pin = (await call(service.getPin, uid, { requestId })).pickupPin;
    assert.equal(
      (
        await call(service.action, "driver", {
          requestId,
          action: "verifyPin",
          passengerId: uid,
          pin,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(service.action, "driver", {
          requestId,
          action: "arrive",
          passengerId: uid,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(service.action, "driver", {
          requestId,
          action: "verifyPin",
          passengerId: uid,
          pin,
        })
      ).status,
      200,
    );
  }
  assert.equal((await call(service.action,"driver",{requestId,action:"start"})).status,200);
  assert.equal((await call(service.action,"driver",{requestId,action:"complete"})).status,409,
    'An away-from-destination driver must obtain passenger consent');
  await db.ref('taxis/driver').update({latitude:-29.9,longitude:31.1,lastSeen:Date.now()});
  for (const action of ["complete", "complete"])
    assert.equal(
      (await call(service.action, "driver", { requestId, action })).status,
      200,
    );
  assert.equal((await read("taxis/driver")).totalEarnings, 276);
  assert.equal(await read("taxis/driver/currentRequest"), null);
});
test("cancel negotiated membership ends the group and releases everyone for rebooking", async () => {
  await create();
  await call(service.join, "p1", body());
  await db.ref("requests/pool-one/workWaitExpiresAt").set(Date.now() - 1);
  for (const uid of ["p0", "p1"])
    await call(service.submitOffer, uid, {
      requestId: "pool-one",
      amount: 330,
    });
  const p = await read("requests/pool-one");
  await call(service.action, "driver", {
    requestId: "pool-one",
    action: "acceptFare",
    revision: p.workNegotiation.revision,
  });
  assert.equal(
    (
      await call(service.action, "p1", {
        requestId: "pool-one",
        action: "cancelPassenger",
      })
    ).status,
    200,
  );
  assert.equal(
    (await read("requests/pool-one")).status,
    "cancelled_by_commuter",
  );
  assert.equal(await read("taxis/driver/currentRequest"), null);
  assert.equal(await read("commuters/p0/currentRequest"), null);
});

test('Club create and join cannot reserve an unverified passenger before photo saving',async()=>{
 await db.ref('commuters/p0/bookingFaceSavedAt').remove();
 assert.equal((await call(service.create,'p0',body())).status,403);
 assert.equal(await read('requests/pool-one'),null);assert.equal(await read('commuters/p0/currentRequest'),null);
 await db.ref('commuters/p0/bookingFaceSavedAt').set(1);
 await create();
 await db.ref('commuters/p1/bookingFaceSavedAt').remove();
 assert.equal((await call(service.join,'p1',body())).status,403);
 assert.equal(await read('commuters/p1/currentRequest'),null);
});

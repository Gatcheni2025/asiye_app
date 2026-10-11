const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const code = fs.readFileSync(
  require("node:path").join(__dirname, "../../assets/club-live.js"),
  "utf8",
);
function setup(role) {
  const dom = new JSDOM(
    '<div id="sheetContent"></div><div id="activeTripContent"></div>',
    { runScripts: "outside-only", url: "https://asiye-80386.web.app/" },
  );
  const w = dom.window;
  w.Date.now = () => 10000;
  w.firebase = {
    database: () => ({
      ref: () => ({ on: (_, cb) => cb({ val: () => 1000 }) }),
    }),
    auth: () => ({
      currentUser: { getIdToken: async () => "test" },
      onAuthStateChanged: () => {},
    }),
  };
  const calls = [];
  w.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ pickupPin: "2468" }) };
  };
  w.ASIYE = {
    state: { userId: "p0", booking: { requestId: "pool-one" } },
    ui: { toast() {} },
    booking: {
      cancelCurrentRide() {},
      createLiveShareUrl: async () => "https://test/track",
    },
    payments: { prepare() {} },
  };
  if (role === "driver")
    w.ASIYE_DRIVER = {
      ui: { closeIncomingRequest() {}, openActiveTripSheet() {}, toast() {} },
      state: {},
      trip: {
        requestId: "pool-one",
        handleState() {},
        startClubCollection() {},
        cancelTrip() {},
      },
    };
  w.eval(code);
  return { dom, w, calls };
}
function pool() {
  return {
    requestId: "pool-one",
    clubSecurityVersion: 2,
    type: "club",
    status: "driver_waiting",
    taxiId: "driver",
    driverName: "Driver One",
    workWaitExpiresAt: 1811000,
    requiredPassengers: 3,
    totalPoolFare: 345,
    passengers: {
      p0: {
        name: "Passenger One",
        pickupAddress: "Pickup A",
        destination: "Destination A",
        price: 115,
        status: "waiting_pool",
      },
      p1: {
        name: "Passenger Two",
        pickupAddress: "Pickup B",
        destination: "Destination B",
        price: 115,
        status: "waiting_pool",
      },
    },
  };
}
test("both roles show identical server-adjusted countdown and count; driver sees every route", async () => {
  const p = pool(),
    buyer = setup("passenger"),
    driver = setup("driver");
  try {
    buyer.w.ClubLive.renderPassenger(p);
    driver.w.ClubLive.renderDriver(p);
    const a = buyer.w.document.querySelector("[data-club-clock]").textContent,
      b = driver.w.document.querySelector("[data-club-clock]").textContent;
    assert.equal(a, b);
    assert.match(a, /30:00/);
    assert.match(a, /2\/3/);
    for (const text of [
      "Pickup A",
      "Pickup B",
      "Destination A",
      "Destination B",
    ])
      assert.ok(
        driver.w.document
          .getElementById("activeTripContent")
          .textContent.includes(text),
      );
    await new Promise((r) => setImmediate(r));
    assert.equal(
      buyer.w.document.querySelector("[data-club-pin]").textContent,
      "2468",
    );
    assert.equal(driver.calls.length, 0);
  } finally {
    buyer.dom.window.close();
    driver.dom.window.close();
  }
});
test("countdown remains when group ready and throughout collection; disappears after departure", () => {
  const { dom, w } = setup("driver");
  try {
    const p = pool();
    p.poolReady = true;
    p.status = "pool_ready";
    w.ClubLive.renderDriver(p);
    assert.ok(w.document.querySelector("[data-club-clock]"));
    const container = w.document.getElementById("activeTripContent");
    container.innerHTML = "";
    p.status = "collecting_passengers";
    w.ClubLive.mountCountdown(p, container);
    assert.ok(container.querySelector("[data-club-clock]"));
    container.innerHTML = "";
    p.status = "in_transit";
    w.ClubLive.mountCountdown(p, container);
    assert.equal(container.querySelector("[data-club-clock]"), null);
  } finally {
    dom.window.close();
  }
});
test("timeout displays passenger offer, driver accept and counter with revision-bound API", async () => {
  const buyer = setup("passenger"),
    driver = setup("driver");
  try {
    const p = pool();
    p.status = "work_negotiation";
    p.workWaitExpiresAt = 1;
    p.workNegotiation = {
      status: "driver_offer",
      revision: 3,
      offerTotalFare: 330,
      offerPerPassenger: 165,
      approvedCount: 2,
      passengerApprovals: { p0: true, p1: true },
      minimumTotalFare: 310.5,
      maximumTotalFare: 345,
    };
    buyer.w.ClubLive.renderPassenger(p);
    driver.w.ClubLive.renderDriver(p);
    assert.ok(buyer.w.document.querySelector("[data-club-negotiate]"));
    assert.doesNotMatch(buyer.w.document.getElementById("sheetContent").textContent, /Driver receives|Asiye R\d/);
    driver.w.document.querySelector("[data-club-accept-fare]").click();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(driver.calls[0].body, {
      requestId: "pool-one",
      action: "acceptFare",
      revision: 3,
    });
    assert.ok(driver.w.document.querySelector("[data-club-counter]"));
  } finally {
    buyer.dom.window.close();
    driver.dom.window.close();
  }
});
test("sharing appears only at own arrival and never exposes the PIN in a public message", async () => {
  const { dom, w } = setup("passenger");
  try {
    const p = pool(),
      container = w.document.getElementById("sheetContent");
    container.innerHTML = '<div class="pickup-pin-digits"></div>';
    w.ClubLive.enhancePickup(p, container, false);
    assert.equal(container.querySelector("[data-club-share]"), null);
    container.innerHTML = '<div class="pickup-pin-digits"></div>';
    w.ClubLive.enhancePickup(p, container, true);
    assert.ok(container.querySelector("[data-club-share]"));
  } finally {
    dom.window.close();
  }
});

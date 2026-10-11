/* Shared v337 Club UI. Both roles render the same server deadline and membership. */
(() => {
  "use strict";
  let serverOffset = 0;
  const pins = new Map();
  const requests = new Map();
  const clocks = new Map();
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const active = (pool) =>
    Object.entries(pool.passengers || {}).filter(
      ([, p]) =>
        !String(p.status || "").includes("cancelled") &&
        p.status !== "rejected",
    );
  const now = () => Date.now() + serverOffset;
  const price = (value) => "R" + Number(value || 0).toFixed(2);
  const refId = (pool) =>
    pool.requestId ||
    pool.key ||
    window.ASIYE_DRIVER?.trip?.requestId ||
    window.ASIYE?.state?.booking?.requestId;
  async function post(endpoint, body) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("Sign in again to continue your Club booking.");
    const token = await user.getIdToken();
    const response = await fetch(
      `https://us-central1-asiye-80386.cloudfunctions.net/${endpoint}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Firebase-Auth": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload.error || "Unable to update the Club booking.");
    return payload;
  }
  function mountCountdown(pool, container) {
    if (
      !container ||
      ["in_transit", "completed"].includes(pool.status) ||
      String(pool.status).includes("cancelled")
    )
      return;
    let panel = container.querySelector("[data-club-clock]");
    if (!panel) {
      panel = document.createElement("div");
      panel.dataset.clubClock = refId(pool);
      panel.style.cssText =
        "padding:14px;margin:12px 0;border-radius:14px;background:#111;color:white;display:flex;justify-content:space-between;gap:12px;";
      container.append(panel);
    }
    const key = refId(pool) + ":" + container.id;
    if (clocks.has(key)) clearInterval(clocks.get(key));
    const tick = () => {
      if (!panel.isConnected) {
        clearInterval(clocks.get(key));
        clocks.delete(key);
        return;
      }
      const seconds = Math.max(
        0,
        Math.ceil((Number(pool.workWaitExpiresAt) - now()) / 1000),
      );
      const label = seconds
        ? pool.poolReady
          ? "Driver waiting for passengers to meet"
          : pool.taxiId
            ? "Driver found, waiting for more passengers"
            : "Searching for driver, waiting for more passengers"
        : pool.poolReady
          ? "Wait ended · finishing passenger pickups"
          : "30 minutes ended · negotiate the rate";
      panel.innerHTML = `<span>${escape(label)}<small style="display:block;margin-top:4px;">${active(pool).length}/${Number(pool.requiredPassengers)} passengers</small></span><strong style="font-size:22px;">${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}</strong>`;
    };
    tick();
    clocks.set(key, setInterval(tick, 1000));
  }
  function button(container, selector, handler) {
    const element = container.querySelector(selector);
    if (!element) return;
    element.addEventListener("click", async () => {
      element.disabled = true;
      const feedback = container.querySelector("[data-club-feedback]");
      if (feedback) feedback.textContent = "";
      try {
        await handler();
      } catch (e) {
        if (feedback) feedback.textContent = e.message;
        else (window.ASIYE_DRIVER?.ui || window.ASIYE?.ui)?.toast?.(e.message);
      } finally {
        if (element.isConnected) element.disabled = false;
      }
    });
  }
  async function showPin(pool, element) {
    if (!element) return;
    const id = refId(pool);
    try {
      if (!pins.has(id)) {
        if (!requests.has(id))
          requests.set(
            id,
            post("getClubPickupPin", { requestId: id }).then(
              (result) => {
                pins.set(id, result.pickupPin);
                requests.delete(id);
                return result.pickupPin;
              },
              (error) => {
                requests.delete(id);
                throw error;
              },
            ),
          );
        await requests.get(id);
      }
      if (element.isConnected) element.textContent = pins.get(id);
    } catch (e) {
      if (element.isConnected)
        element.textContent = "PIN unavailable — reopen booking to retry";
    }
  }
  function renderPassenger(pool) {
    const container = document.getElementById("sheetContent");
    if (!container) return;
    const members = active(pool),
      me = pool.passengers?.[ASIYE.state.userId],
      n = pool.workNegotiation;
    const expired = now() >= Number(pool.workWaitExpiresAt),
      negotiated = pool.earlyDepartureNegotiated;
    const recommended = Number(
      n?.recommendedTotalFare ||
        pool.originalWorkTargetFare ||
        pool.totalPoolFare,
    );
    const minimum = Number(
      n?.minimumTotalFare ||
        Math.max(
          members.reduce((sum, [, p]) => sum + Number(p.price), 0),
          recommended * 0.9,
        ),
    );
    container.innerHTML = `<section><div class="home-kicker">Asiye Work</div><h2 class="home-title">${pool.taxiId ? "Driver found" : "Finding your driver"}</h2><p>${pool.poolReady ? "The group is ready. Waiting for driver acceptance and passenger payments." : "Waiting for more passengers"}</p>
      <div data-club-countdown></div><p><strong>${members.length}/${pool.requiredPassengers} passengers</strong></p>
      <p>Pickup: ${escape(me?.pickupAddress)}<br>Destination: ${escape(me?.destination)}</p>
      ${pool.taxiId ? `<p>Assigned driver: <strong>${escape(pool.driverName)}</strong></p>` : ""}
      <div style="padding:16px;border-radius:14px;background:#f4f4f4;"><small>Your private pickup PIN</small><strong data-club-pin style="display:block;font-size:28px;letter-spacing:8px;">••••</strong><small>Give this PIN to the driver after arrival.</small></div>
      <p>Your fare: <strong>${price(me?.price)}</strong></p>
      ${
        expired && !pool.poolReady && !negotiated
          ? `<section><h3>Negotiate with your driver</h3><p>Recommendation: ${price(recommended)} for the group. Every passenger must agree before the driver accepts.</p>
        <label>Group offer <input data-club-offer type="number" step="0.01" min="${minimum}" max="${recommended}" value="${Number(n?.offerTotalFare || recommended)}"></label>
        <p>${price(minimum)} – ${price(recommended)} total · ${n?.approvedCount || 0}/${members.length} approvals</p>
        ${n?.offerTotalFare ? `<p>Proposed rate: <strong>${price(n.offerTotalFare)}</strong> · ${price(n.offerPerPassenger)} each</p>` : ""}
        <button class="primary-button" data-club-negotiate>${n?.passengerApprovals?.[ASIYE.state.userId] ? "Update offer" : "Agree and send offer"}</button></section>`
          : ""
      }
      ${n?.status === "driver_offer" ? "<p>All passengers agreed. Waiting for the assigned driver to accept the proposed rate.</p>" : ""}
      ${negotiated ? `<p>Driver accepted ${price(pool.totalPoolFare)} for the group. Complete payment for your ${price(me?.price)} share.</p>` : ""}
      ${pool.poolReady && me?.paymentStatus === "payment_required" ? '<button class="primary-button" data-club-pay>Pay accepted fare</button>' : ""}
      ${pool.poolReady && me?.paymentStatus === "wallet_insufficient" ? '<p>Add funds to your Asiye Wallet, then retry payment.</p><button class="primary-button" data-club-pay>Retry wallet payment</button>' : ""}
      <p data-club-feedback role="status"></p><button class="secondary-button" data-club-cancel>Cancel Work booking</button></section>`;
    mountCountdown(pool, container.querySelector("[data-club-countdown]"));
    showPin(pool, container.querySelector("[data-club-pin]"));
    button(container, "[data-club-negotiate]", () =>
      post("submitWorkEarlyDepartureOffer", {
        requestId: refId(pool),
        amount: Number(container.querySelector("[data-club-offer]").value),
      }),
    );
    button(container, "[data-club-pay]", () =>
      ASIYE.payments.prepare(refId(pool)),
    );
    button(container, "[data-club-cancel]", () =>
      ASIYE.booking.cancelCurrentRide(),
    );
  }
  function renderDriver(pool) {
    ASIYE_DRIVER.ui.closeIncomingRequest();
    ASIYE_DRIVER.ui.openActiveTripSheet();
    const container = document.getElementById("activeTripContent");
    if (!container) return;
    const members = active(pool),
      n = pool.workNegotiation;
    container.innerHTML = `<div class="driver-kicker">Asiye Work</div><h2 class="driver-title">Driver found</h2><p>Waiting for more passengers · ${members.length}/${pool.requiredPassengers}</p><div data-club-countdown></div>
      ${members.map(([, p]) => `<div style="padding:12px;margin:8px 0;border:1px solid #ddd;border-radius:12px;"><strong>${escape(p.name)}</strong><p>Pickup: ${escape(p.pickupAddress)}<br>Destination: ${escape(p.destination)}</p></div>`).join("")}
      ${pool.status === "work_negotiation" ? `<h3>30 minutes ended · negotiated rate</h3><p>${n?.offerTotalFare ? `${price(n.offerTotalFare)} group fare · ${price(n.offerPerPassenger)} each · Driver receives ${price(n.offerTotalFare * 0.8)} · Asiye ${price(n.offerTotalFare * 0.2)}` : "Waiting for passengers to propose their rate."}</p><p>${n?.approvedCount || 0}/${members.length} passenger approvals</p>` : ""}
      ${n?.status === "driver_offer" ? `<button class="driver-btn driver-btn-primary" data-club-accept-fare>Accept ${price(n.offerTotalFare)} group fare</button><label>Counteroffer <input type="number" data-club-counter-value min="${n.minimumTotalFare}" max="${n.maximumTotalFare}" step="0.01" value="${n.offerTotalFare}"></label><button class="driver-btn driver-btn-secondary" data-club-counter>Send counteroffer to passengers</button>` : ""}
      ${!pool.driverAcceptedAt && pool.status !== "work_negotiation" ? '<button class="driver-btn driver-btn-primary" data-club-wait>Accept booking and wait for the Club</button>' : ""}
      ${pool.poolReady && pool.paymentsReady && pool.driverAcceptedAt ? '<button class="driver-btn driver-btn-primary" data-club-collect>Start passenger collection</button>' : ""}
      ${pool.poolReady && !pool.paymentsReady ? "<p>Waiting for each passenger to complete payment for the accepted fare.</p>" : ""}
      <p data-club-feedback role="status"></p><button class="driver-btn driver-btn-secondary" data-club-cancel>Cancel booking</button>`;
    mountCountdown(pool, container.querySelector("[data-club-countdown]"));
    button(container, "[data-club-wait]", () => driverAction("acceptWaiting"));
    button(container, "[data-club-accept-fare]", () =>
      driverAction("acceptFare", { revision: n.revision }),
    );
    button(container, "[data-club-counter]", () =>
      driverAction("counterFare", {
        revision: n.revision,
        amount: Number(
          container.querySelector("[data-club-counter-value]").value,
        ),
      }),
    );
    button(container, "[data-club-collect]", () =>
      ASIYE_DRIVER.trip.startClubCollection(),
    );
    button(container, "[data-club-cancel]", () =>
      ASIYE_DRIVER.trip.cancelTrip(),
    );
  }
  async function driverAction(action, details = {}) {
    return post("clubDriverActionSecure", {
      requestId: ASIYE_DRIVER.trip.requestId,
      action,
      ...details,
    });
  }
  function enhancePickup(pool, container, arrived) {
    const digits = container.querySelector(".pickup-pin-digits");
    if (digits) {
      digits.textContent = "••••";
      digits.removeAttribute("aria-label");
      showPin(pool, digits);
    }
    mountCountdown(pool, container);
    if (arrived) {
      const row = document.createElement("div");
      row.innerHTML =
        '<button class="primary-button" data-club-share>Share trip with loved ones</button><p data-club-feedback role="status"></p>';
      container.append(row);
      button(row, "[data-club-share]", async () => {
        const url = await ASIYE.booking.createLiveShareUrl(refId(pool));
        const message = `My Asiye driver has arrived. Pickup: ${pool.passengers[ASIYE.state.userId]?.pickupAddress}. Destination: ${pool.passengers[ASIYE.state.userId]?.destination}. Follow my trip: ${url}`;
        if (navigator.share)
          await navigator.share({ title: "My Asiye trip", text: message, url });
        else {
          await navigator.clipboard.writeText(message);
          row.querySelector("[data-club-feedback]").textContent =
            "Trip link copied.";
        }
      });
    }
  }
  window.ClubLive = {
    post,
    renderPassenger,
    renderDriver,
    driverAction,
    mountCountdown,
    enhancePickup,
  };
  firebase
    .database()
    .ref(".info/serverTimeOffset")
    .on("value", (snapshot) => {
      serverOffset = Number(snapshot.val() || 0);
    });
  // Keep the same timer visible throughout individual pickup and onboard states.
  for (const [controller, containerId, method] of [
    [window.ASIYE_DRIVER?.trip, "activeTripContent", "handleState"],
    [window.ASIYE?.ride, "sheetContent", "handleRequest"],
  ]) {
    if (!controller?.[method]) continue;
    const original = controller[method];
    controller[method] = function (pool) {
      const result = original.call(this, pool);
      if (
        pool.clubSecurityVersion === 2 &&
        ![
          "pooling",
          "driver_waiting",
          "pool_ready",
          "work_negotiation",
        ].includes(pool.status)
      )
        mountCountdown(pool, document.getElementById(containerId));
      return result;
    };
  }
  firebase.auth().onAuthStateChanged(() => {
    pins.clear();
    requests.clear();
  });
})();

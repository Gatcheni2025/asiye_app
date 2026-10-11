"use strict";
const crypto = require("node:crypto");
const WAIT_MS = 30 * 60 * 1000;
const TERMINAL = new Set([
  "completed",
  "cancelled_by_driver",
  "cancelled_by_admin",
  "cancelled_by_commuter",
]);
const active = (pool) =>
  Object.entries(pool.passengers || {}).filter(
    ([, p]) =>
      !String(p.status || "").includes("cancelled") && p.status !== "rejected",
  );
const money = (n) => Math.round(Number(n) * 100) / 100;
function fail(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function secure(pool) {
  if (!pool || pool.type !== "club" || pool.clubSecurityVersion !== 2)
    fail("This Club booking requires the updated server booking flow.", 409);
}
function expire(pool, now) {
  secure(pool);
  if (
    TERMINAL.has(pool.status) ||
    ["collecting_passengers", "in_transit"].includes(pool.status)
  )
    return pool;
  const members = active(pool);
  pool.passengerCount = members.length;
  pool.remainingSeats = Math.max(0, pool.requiredPassengers - members.length);
  if (!members.length) {
    pool.status = "cancelled_by_commuter";
    return pool;
  }
  if (
    members.length < pool.requiredPassengers &&
    now >= pool.workWaitExpiresAt &&
    !pool.earlyDepartureNegotiated
  ) {
    pool.poolReady = false;
    pool.status = "work_negotiation";
    pool.workNegotiation = pool.workNegotiation || {
      status: "collecting_passenger_approvals",
      passengerApprovals: {},
      revision: 0,
    };
    pool.driverSearchStatus = pool.taxiId
      ? "driver_found_negotiation"
      : "searching_for_driver";
  } else {
    pool.poolReady = members.length >= pool.requiredPassengers;
    pool.status =
      pool.poolReady && pool.paymentsReady
        ? "pool_ready"
        : pool.taxiId
          ? "driver_waiting"
          : "pooling";
    pool.driverSearchStatus = pool.taxiId
      ? pool.poolReady
        ? "driver_found_waiting_acceptance"
        : "driver_found_waiting_passengers"
      : "searching_for_driver";
  }
  return pool;
}
function offer(pool, passengerId, amount, now) {
  expire(pool, now);
  if (
    pool.status !== "work_negotiation" ||
    !active(pool).some(([id]) => id === passengerId)
  )
    fail(
      "Only current passengers can negotiate after the 30-minute countdown.",
    );
  const members = active(pool).sort(([a], [b]) => a.localeCompare(b));
  const recommended = money(pool.originalWorkTargetFare || pool.totalPoolFare);
  const minimum = money(
    Math.max(
      members.reduce((sum, [, p]) => sum + p.price, 0),
      recommended * 0.9,
    ),
  );
  amount = money(amount == null || amount === "" ? recommended : amount);
  if (!Number.isFinite(amount) || amount < minimum || amount > recommended)
    fail(
      `Choose an offer between R${minimum.toFixed(2)} and R${recommended.toFixed(2)}.`,
      422,
    );
  const old = pool.workNegotiation || {};
  // A changed amount invalidates every previous consent, including the driver's.
  const changed = old.offerTotalFare !== amount;
  const approvals = changed ? {} : { ...(old.passengerApprovals || {}) };
  approvals[passengerId] = true;
  const allApproved = members.every(([id]) => approvals[id] === true);
  pool.workNegotiation = {
    status: allApproved ? "driver_offer" : "collecting_passenger_approvals",
    revision: Number(old.revision || 0) + (changed ? 1 : 0),
    offerTotalFare: amount,
    offerPerPassenger: money(amount / members.length),
    minimumTotalFare: minimum,
    maximumTotalFare: recommended,
    recommendedTotalFare: recommended,
    passengerCount: members.length,
    approvalsNeeded: members.length,
    approvedCount: members.filter(([id]) => approvals[id]).length,
    passengerApprovals: approvals,
    proposedAt: changed ? now : old.proposedAt || now,
  };
  return pool;
}
function acceptFare(pool, uid, revision, now) {
  secure(pool);
  if (pool.driverAuthUid !== uid)
    fail("Only the assigned driver can accept this fare.", 403);
  const n = pool.workNegotiation;
  if (n?.status === "driver_accepted" && n.revision === revision) return pool;
  if (
    pool.status !== "work_negotiation" ||
    n?.status !== "driver_offer" ||
    n.revision !== revision
  )
    fail("The offer changed. Review the latest passenger-approved amount.");
  const members = active(pool).sort(([a], [b]) => a.localeCompare(b));
  if (
    !members.length ||
    members.length !== n.passengerCount ||
    !members.every(([id]) => n.passengerApprovals[id] === true)
  )
    fail("Every current passenger must approve this fare.");
  const totalCents = Math.round(n.offerTotalFare * 100);
  let remaining = totalCents;
  members.forEach(([id], i) => {
    const cents =
      i === members.length - 1
        ? remaining
        : Math.floor(totalCents / members.length);
    remaining -= cents;
    pool.passengers[id].price = cents / 100;
    pool.passengers[id].paymentStatus = "waiting_pool";
  });
  pool.originalRequiredPassengers = pool.requiredPassengers;
  pool.requiredPassengers =
    pool.minimumPassengers =
    pool.effectiveRequiredPassengers =
      members.length;
  pool.earlyDepartureNegotiated = true;
  pool.originalWorkTargetFare = pool.totalPoolFare;
  pool.totalPoolFare = pool.driverGrossFare = n.offerTotalFare;
  pool.platformCommission = money(n.offerTotalFare * 0.2);
  pool.driverNetFare = money(n.offerTotalFare - pool.platformCommission);
  pool.paymentsReady = false;
  pool.driverAcceptedAt = now;
  pool.workNegotiation = {
    ...n,
    status: "driver_accepted",
    driverAcceptedAt: now,
    driverAuthUid: uid,
  };
  return expire(pool, now);
}
function paymentGate(pool, ledgers) {
  if (!pool.poolReady || !pool.driverAcceptedAt)
    fail("The passenger group and driver acceptance must be ready.");
  if (
    pool.earlyDepartureNegotiated &&
    pool.workNegotiation?.status !== "driver_accepted"
  )
    fail("The negotiated fare has not been accepted.");
  for (const [id, p] of active(pool)) {
    const ledger = ledgers[id];
    if (
      !ledger ||
      ledger.method !== p.paymentMethod ||
      money(ledger.amount) !== money(p.price) ||
      !(p.paymentMethod === "cash"
        ? ledger.status === "cash_due"
        : ["held", "captured"].includes(ledger.status))
    )
      fail("Each passenger must have payment prepared for the accepted fare.");
  }
}
function driverAction(pool, uid, body, evidence, now) {
  secure(pool);
  if (pool.driverAuthUid !== uid)
    fail("Only the assigned driver can change this booking.", 403);
  if (TERMINAL.has(pool.status)) {
    if (body.action === "complete" && pool.status === "completed") return pool;
    fail("This booking has ended.");
  }
  const passenger = pool.passengers?.[body.passengerId];
  switch (body.action) {
    case "acceptWaiting":
      if (!["driver_waiting", "pool_ready", "pooling"].includes(pool.status))
        fail("Review the negotiated fare before accepting.");
      pool.driverAcceptedAt = pool.driverAcceptedAt || now;
      return pool;
    case "counterFare": {
      const n = pool.workNegotiation;
      const amount = money(body.amount);
      if (
        pool.status !== "work_negotiation" ||
        n?.status !== "driver_offer" ||
        n.revision !== Number(body.revision)
      )
        fail("The offer changed. Review it again.");
      if (
        !Number.isFinite(amount) ||
        amount < n.minimumTotalFare ||
        amount > n.maximumTotalFare
      )
        fail("Counteroffer must remain within the protected fare range.", 422);
      pool.workNegotiation = {
        ...n,
        status: "collecting_passenger_approvals",
        revision: n.revision + 1,
        offerTotalFare: amount,
        offerPerPassenger: money(amount / n.passengerCount),
        passengerApprovals: {},
        approvedCount: 0,
        driverCounterAt: now,
      };
      return pool;
    }
    case "acceptFare":
      return acceptFare(pool, uid, Number(body.revision), now);
    case "cancelDriver":
      if (
        ["collecting_passengers", "in_transit"].includes(pool.status) &&
        active(pool).some(([, p]) => p.pinVerifiedAt)
      )
        fail("A passenger is already onboard; contact support.");
      pool.status = "cancelled_by_driver";
      pool.cancelledAt = now;
      return pool;
    case "collect":
      paymentGate(pool, evidence.ledgers);
      if (pool.status === "collecting_passengers") return pool;
      if (pool.status !== "pool_ready")
        fail("The Club is not ready for collection.");
      pool.status = "collecting_passengers";
      pool.collectionStartedAt = now;
      return pool;
    case "onWay":
    case "arrive":
    case "verifyPin":
      paymentGate(pool, evidence.ledgers);
      if (
        pool.status !== "collecting_passengers" ||
        !passenger ||
        !active(pool).some(([id]) => id === body.passengerId)
      )
        fail("This passenger is not awaiting collection.");
      if (body.action === "onWay") {
        if (
          passenger.pinVerifiedAt ||
          passenger.arrivedAt ||
          passenger.status === "driver_on_way"
        )
          return pool;
        passenger.status = "driver_on_way";
        passenger.driverOnWayAt = now;
        return pool;
      }
      if (body.action === "arrive") {
        if (passenger.arrivedAt) return pool;
        if (!evidence.nearPickup)
          fail(
            "Update your live location at the passenger pickup before marking arrival.",
          );
        passenger.status = "arrived";
        passenger.arrivedAt = now;
        return pool;
      }
      if (passenger.pinVerifiedAt) return pool;
      if (!passenger.arrivedAt || passenger.status !== "arrived")
        fail("Arrival must be confirmed before PIN verification.");
      if (Number(passenger.pinAttempts || 0) >= 5)
        fail("PIN attempts are locked. Contact support.", 429);
      passenger.pinAttempts = Number(passenger.pinAttempts || 0) + 1;
      if (!evidence.pinValid) return pool;
      passenger.pinVerifiedAt = now;
      passenger.passengerOnboardAt = now;
      passenger.status = "passenger_onboard";
      return pool;
    case "start":
      paymentGate(pool, evidence.ledgers);
      if (pool.status === "in_transit") return pool;
      if (
        pool.status !== "collecting_passengers" ||
        !active(pool).every(
          ([, p]) =>
            p.arrivedAt && p.pinVerifiedAt && p.status === "passenger_onboard",
        )
      )
        fail(
          "Every passenger must arrive and pass server PIN verification before departure.",
        );
      pool.status = "in_transit";
      pool.tripStartedAt = now;
      active(pool).forEach(([, p]) => {
        p.status = "in_transit";
      });
      return pool;
    case "complete":
      if (pool.status !== "in_transit")
        fail("Only a started trip can be completed.");
      for (const [id, p] of active(pool)) {
        if (
          p.paymentMethod !== "cash" &&
          evidence.ledgers[id]?.status !== "captured"
        )
          fail("Settle all passenger payments before completing.");
      }
      pool.status = "completed";
      pool.completedAt = now;
      active(pool).forEach(([, p]) => {
        p.status = "completed";
        p.completedAt = now;
      });
      return pool;
    default:
      fail("Unknown Club action.", 400);
  }
}
function registerClubLifecycle(deps) {
  const {
    admin,
    onRequest,
    cors,
    verifyUser,
    resolvePassenger,
    nearbyDrivers,
    driverEligible,
    marketFare,
    preparePayments,
    paymentPath,
    distanceKm,
  } = deps;
  const db = admin.database();
  const read = async (path) => (await db.ref(path).once("value")).val();
  const transact = async (path, transform) => {
    const ref = db.ref(path);
    await ref.once("value");
    let error;
    const result = await ref.transaction(
      (current) => {
        error = null;
        if (current === null) return current;
        try {
          return transform(current);
        } catch (e) {
          error = e;
          return;
        }
      },
      undefined,
      false,
    );
    if (error) throw error;
    if (!result.committed || !result.snapshot.val())
      fail("The booking changed. Retry the action.");
    return result.snapshot.val();
  };
  const release = async (pool) => {
    if (pool.taxiId)
      await db
        .ref(`taxis/${pool.taxiId}/currentRequest`)
        .transaction((value) =>
          value == null || value === pool.requestId ? null : undefined,
        );
    for (const [id] of Object.entries(pool.passengers || {}))
      await db
        .ref(`commuters/${id}/currentRequest`)
        .transaction((value) =>
          value == null || value === pool.requestId ? null : undefined,
        );
  };
  const credentials = async (pool, id) => {
    const ref = db.ref(`clubPrivate/${pool.requestId}/pins/${id}`);
    const created = {
      pin: String(crypto.randomInt(1000, 10000)),
      expiresAt: pool.createdAt + 24 * 60 * 60 * 1000,
    };
    const tx = await ref.transaction(
      (current) => current || created,
      undefined,
      false,
    );
    return tx.snapshot.val();
  };
  const sync = async (requestId) => {
    let pool = await read(`requests/${requestId}`);
    if (pool?.clubSecurityVersion !== 2) return;
    if (TERMINAL.has(pool.status)) {
      const payload = {
        type: "club_waiting_sync",
        requestId,
        title: "Asiye Work",
        message:
          pool.status === "completed"
            ? "Your Club trip is complete."
            : "Your Club booking ended. Any reserved payment will follow the cancellation release process.",
        timestamp: Date.now(),
      };
      const updates = {};
      for (const [id] of Object.entries(pool.passengers || {}))
        updates[`notifications/commuters/${id}/club-ended-${requestId}`] =
          payload;
      if (pool.taxiId)
        updates[`notifications/taxis/${pool.taxiId}/club-ended-${requestId}`] =
          payload;
      if (
        (await read(`clubPrivate/${requestId}/endedNotified`)) !== pool.status
      ) {
        await db.ref().update(updates);
        await db.ref(`clubPrivate/${requestId}/endedNotified`).set(pool.status);
      }
      await release(pool);
      return;
    }
    pool = await transact(`requests/${requestId}`, (current) =>
      expire(current, Date.now()),
    );
    if (
      !pool.taxiId &&
      !["collecting_passengers", "in_transit"].includes(pool.status)
    ) {
      for (const candidate of await nearbyDrivers(pool, 8)) {
        const taxiRef = db.ref(`taxis/${candidate.driverId}`);
        await taxiRef.once("value");
        const claim = await taxiRef.transaction(
          (taxi) => {
            if (!taxi) return taxi;
            if (taxi.currentRequest && taxi.currentRequest !== requestId)
              return;
            if (
              taxi.isOnline !== true ||
              taxi.isBroadcasting !== true ||
              !driverEligible(taxi, { requiredSeats: pool.capacity })
            )
              return;
            return { ...taxi, currentRequest: requestId };
          },
          undefined,
          false,
        );
        if (
          !claim.committed ||
          claim.snapshot.val()?.currentRequest !== requestId
        )
          continue;
        const taxi = claim.snapshot.val();
        try {
          pool = await transact(`requests/${requestId}`, (current) => {
            secure(current);
            if (current.taxiId === candidate.driverId) return current;
            if (TERMINAL.has(current.status) || current.taxiId)
              fail("This Club already has a driver.");
            Object.assign(current, {
              taxiId: candidate.driverId,
              driverAuthUid: taxi.authUid || taxi.userUid || candidate.driverId,
              driverName: taxi.name || taxi.fullName || "Driver",
              driverPhone: taxi.phone || "",
              driverProfileImageUrl:
                taxi.profile_picture_url || taxi.profileImageUrl || "",
              vehicleMake: taxi.vehicleMake || taxi.vehicle?.make || "",
              vehicleModel: taxi.vehicleModel || taxi.vehicle?.model || "",
              vehicleColor: taxi.vehicleColor || taxi.vehicle?.color || "",
              vehicleReg:
                taxi.taxiRegistrationNumber || taxi.vehicle?.registration || "",
              driverAssignedAt: Date.now(),
            });
            return expire(current, Date.now());
          });
          break;
        } catch (e) {
          await taxiRef
            .child("currentRequest")
            .transaction((value) =>
              value == null || value === requestId ? null : undefined,
            );
          pool = await read(`requests/${requestId}`);
          if (pool?.taxiId || TERMINAL.has(pool?.status)) break;
        }
      }
    }
    if (TERMINAL.has(pool.status)) {
      await release(pool);
      return;
    }
    const signature = JSON.stringify([
      pool.taxiId || "",
      pool.status,
      pool.passengerCount,
      pool.workNegotiation?.revision || 0,
      pool.workNegotiation?.status || "",
      pool.workNegotiation?.approvedCount || 0,
      pool.paymentsReady === true,
      active(pool).map(([id, p]) => [
        id,
        p.status,
        p.arrivedAt || 0,
        p.pinVerifiedAt || 0,
      ]),
    ]);
    const marker = db.ref(`clubPrivate/${requestId}/notificationSignature`);
    // Emit first; write marker only after delivery so trigger retries repair partial fan-out.
    if (
      (await read(`clubPrivate/${requestId}/notificationSignature`)) ===
      signature
    )
      return;
    const waiting = pool.poolReady
      ? "The group is ready. Confirm the fare and passenger payments before collection."
      : "Driver found, waiting for more passengers";
    const message =
      pool.status === "work_negotiation"
        ? "The 30-minute wait has ended. Review the negotiated rate."
        : pool.taxiId
          ? waiting
          : "Searching for a driver, waiting for more passengers";
    const notificationKey = `club-sync-${requestId}-${crypto.createHash("sha256").update(signature).digest("hex").slice(0, 16)}`;
    const payload = {
      type: "club_waiting_sync",
      requestId,
      title: "Asiye Work",
      message,
      passengerCount: pool.passengerCount,
      requiredPassengers: pool.requiredPassengers,
      workWaitExpiresAt: pool.workWaitExpiresAt,
      timestamp: Date.now(),
    };
    if (pool.taxiId)
      await db
        .ref(`notifications/taxis/${pool.taxiId}/${notificationKey}`)
        .set(payload);
    for (const [id, p] of active(pool))
      await db.ref(`notifications/commuters/${id}/${notificationKey}`).set({
        ...payload,
        message:
          p.status === "arrived"
            ? "Your driver has arrived. Give them your pickup PIN when ready."
            : p.status === "passenger_onboard"
              ? "Your pickup is confirmed. Waiting for the other passengers."
              : message,
      });
    await marker.set(signature);
  };
  const endpoint = (handler) =>
    onRequest(
      { region: "us-central1", invoker: "public" },
      async (req, res) => {
        cors(req, res);
        res.set?.("Cache-Control", "no-store");
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST")
          return res.status(405).json({ error: "POST required." });
        try {
          const user = await verifyUser(req);
          if (!user) fail("Sign in again to continue.", 401);
          const result = await handler(user, req.body || {});
          return res
            .status(200)
            .json({ ok: true, serverNow: Date.now(), ...result });
        } catch (e) {
          console.error("Secure Club action failed", e.message);
          return res
            .status(e.status || 500)
            .json({ error: e.message || "Unable to update Club booking." });
        }
      },
    );
  const idOf = (body) => {
    const id = String(body.requestId || body.poolId || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
      fail("Invalid booking reference.", 400);
    return id;
  };
  const memberDetails = (user, profile, body) => {
    const coordinates = [
      "pickupLat",
      "pickupLng",
      "destinationLat",
      "destinationLng",
    ];
    for (const key of coordinates) {
      if (
        body[key] === null ||
        body[key] === "" ||
        !Number.isFinite(Number(body[key])) ||
        Math.abs(Number(body[key])) > (key.endsWith("Lat") ? 90 : 180)
      )
        fail("Choose valid pickup and destination locations.", 400);
    }
    if (!["cash", "wallet", "card"].includes(body.paymentMethod || "cash"))
      fail("Invalid payment method.", 400);
    return {
      commuterId: profile.id,
      authUid: user.uid,
      name: String(profile.data?.name || user.name || "Passenger").slice(
        0,
        120,
      ),
      phone: String(profile.data?.phone || user.phone_number || "").slice(
        0,
        40,
      ),
      profileImageUrl: String(
        profile.data?.profileImageUrl ||
          profile.data?.profile_picture_url ||
          "",
      ).slice(0, 2048),
      pickupAddress: String(body.pickupAddress || "Current location").slice(
        0,
        300,
      ),
      destination: String(body.destination || "").slice(0, 300),
      ...Object.fromEntries(coordinates.map((key) => [key, Number(body[key])])),
      departureTime: String(body.departureTime || "").slice(0, 80),
      paymentMethod: body.paymentMethod || "cash",
      requirePin: true,
      safetyShareRequired: false,
      safetyShareCompleted: false,
      paymentStatus: "waiting_pool",
      status: "waiting_pool",
      joinedAt: Date.now(),
    };
  };
  const reservePassenger = async (id, requestId) => {
    const ref = db.ref(`commuters/${id}`);
    const profile = (await ref.once("value")).val();
    if (profile?.currentRequest && profile.currentRequest !== requestId) {
      const old = await read(`requests/${profile.currentRequest}`);
      const released =
        old &&
        (TERMINAL.has(old.status) ||
          String(old.passengers?.[id]?.status || "").includes("cancelled"));
      const abandoned =
        !old &&
        (!profile.clubBookingReservedAt ||
          Date.now() - profile.clubBookingReservedAt > 120000);
      if (released || abandoned)
        await ref
          .child("currentRequest")
          .transaction((value) =>
            value == null || value === profile.currentRequest
              ? null
              : undefined,
          );
    }
    const tx = await ref.transaction(
      (p) => {
        if (!p) return p;
        if (p.currentRequest && p.currentRequest !== requestId) return;
        return {
          ...p,
          currentRequest: requestId,
          clubBookingReservedAt: Date.now(),
        };
      },
      undefined,
      false,
    );
    if (!tx.committed || tx.snapshot.val()?.currentRequest !== requestId)
      fail("You already have an active trip. Reopen it before booking again.");
  };
  const create = endpoint(async (user, body) => {
    const requestId = idOf(body);
    const profile = await resolvePassenger(user);
    profile.id = profile.id || user.uid;
    const p = memberDetails(user, profile, body);
    for (const key of ["routeDistanceKm", "routeDurationMinutes"])
      if (
        body[key] != null &&
        (!Number.isFinite(Number(body[key])) ||
          Number(body[key]) < 0 ||
          Number(body[key]) > 10000)
      )
        fail("Invalid route estimate.", 400);
    const mode = body.clubMode === "club7" ? "club7" : "club4";
    const count = mode === "club7" ? 4 : 3;
    const fare = marketFare({
      commuterLocation: { latitude: p.pickupLat, longitude: p.pickupLng },
      destinationCoords: {
        latitude: p.destinationLat,
        longitude: p.destinationLng,
      },
      routeDistanceKm: body.routeDistanceKm,
      routeDurationMinutes: body.routeDurationMinutes,
    });
    const seat = Math.ceil((fare / count) * 1.15);
    p.price = seat;
    const now = Date.now();
    const pool = {
      requestId,
      type: "club",
      clubSecurityVersion: 2,
      clubMode: mode,
      commuterId: profile.id,
      commuterName: p.name,
      commuterLocation: { latitude: p.pickupLat, longitude: p.pickupLng },
      pickupAddress: p.pickupAddress,
      poolCenterLat: p.pickupLat,
      poolCenterLng: p.pickupLng,
      destination: p.destination,
      destinationCoords: {
        latitude: p.destinationLat,
        longitude: p.destinationLng,
      },
      departureTime: p.departureTime,
      capacity: mode === "club7" ? 7 : 4,
      minimumPassengers: count,
      requiredPassengers: count,
      passengerCount: 1,
      remainingSeats: count - 1,
      marketReferenceFare: fare,
      totalPoolFare: seat * count,
      driverGrossFare: seat * count,
      pricePerPassenger: seat,
      commissionRate: 0.2,
      workWaitMinutes: 30,
      workWaitStartedAt: now,
      workWaitExpiresAt: now + WAIT_MS,
      createdAt: now,
      status: "pooling",
      poolReady: false,
      paymentsReady: false,
      paymentStatus: "waiting_pool",
      paymentMethod: p.paymentMethod,
      passengers: { [profile.id]: p },
    };
    await reservePassenger(profile.id, requestId);
    try {
      const ref = db.ref(`requests/${requestId}`);
      const tx = await ref.transaction(
        (current) => current || pool,
        undefined,
        false,
      );
      if (
        tx.snapshot.val()?.commuterId !== profile.id ||
        tx.snapshot.val()?.clubSecurityVersion !== 2
      )
        fail("Booking reference is already used.");
    } catch (e) {
      await db
        .ref(`commuters/${profile.id}/currentRequest`)
        .transaction((v) => (v == null || v === requestId ? null : undefined));
      throw e;
    }
    const stored = await read(`requests/${requestId}`);
    await credentials(stored, profile.id);
    await sync(requestId);
    return { requestId, poolId: requestId };
  });
  const join = endpoint(async (user, body) => {
    const requestId = idOf(body);
    const profile = await resolvePassenger(user);
    profile.id = profile.id || user.uid;
    const p = memberDetails(user, profile, body);
    await reservePassenger(profile.id, requestId);
    try {
      await transact(`requests/${requestId}`, (pool) => {
        expire(pool, Date.now());
        if (
          pool.passengers?.[profile.id] &&
          active(pool).some(([id]) => id === profile.id)
        ) {
          if (pool.passengers[profile.id].authUid !== user.uid)
            fail("Passenger identity mismatch.", 403);
          return pool;
        }
        if (
          pool.status === "work_negotiation" ||
          pool.poolReady ||
          TERMINAL.has(pool.status) ||
          Date.now() >= pool.workWaitExpiresAt
        )
          fail("The group is closed or the 30-minute countdown has ended.");
        if (
          distanceKm(
            p.pickupLat,
            p.pickupLng,
            pool.poolCenterLat,
            pool.poolCenterLng,
          ) > 5 ||
          distanceKm(
            p.destinationLat,
            p.destinationLng,
            pool.destinationCoords.latitude,
            pool.destinationCoords.longitude,
          ) > 5 ||
          p.departureTime !== pool.departureTime ||
          (body.clubMode && body.clubMode !== pool.clubMode)
        )
          fail("Pickup, destination or departure does not match this Club.");
        p.price = pool.pricePerPassenger;
        pool.passengers[profile.id] = p;
        return expire(pool, Date.now());
      });
    } catch (e) {
      const existing = await read(
        `requests/${requestId}/passengers/${profile.id}`,
      );
      if (!existing || String(existing.status).includes("cancelled"))
        await db
          .ref(`commuters/${profile.id}/currentRequest`)
          .transaction((v) =>
            v == null || v === requestId ? null : undefined,
          );
      throw e;
    }
    const pool = await read(`requests/${requestId}`);
    await credentials(pool, profile.id);
    if (pool.poolReady) await preparePayments(requestId, pool);
    await sync(requestId);
    const latest = await read(`requests/${requestId}`);
    return {
      poolId: requestId,
      passengerId: profile.id,
      passengerPaymentStatus: latest.passengers[profile.id].paymentStatus,
    };
  });
  const getPin = endpoint(async (user, body) => {
    const requestId = idOf(body);
    const pool = await read(`requests/${requestId}`);
    secure(pool);
    const profile = await resolvePassenger(user);
    const id = profile.id || user.uid;
    if (
      !active(pool).some(([key, p]) => key === id && p.authUid === user.uid) ||
      TERMINAL.has(pool.status)
    )
      fail("Only this passenger can view their pickup PIN.", 403);
    const pin = await credentials(pool, id);
    if (pin.expiresAt < Date.now())
      fail("This pickup PIN has expired. Contact support.");
    return { requestId, pickupPin: pin.pin, expiresAt: pin.expiresAt };
  });
  const submitOffer = endpoint(async (user, body) => {
    const requestId = idOf(body);
    const profile = await resolvePassenger(user);
    const pool = await transact(`requests/${requestId}`, (current) =>
      offer(current, profile.id || user.uid, body.amount, Date.now()),
    );
    await sync(requestId);
    return {
      negotiation: pool.workNegotiation,
      status: pool.workNegotiation.status,
    };
  });
  const action = endpoint(async (user, body) => {
    const requestId = idOf(body);
    let pool = await read(`requests/${requestId}`);
    secure(pool);
    if (body.action === "cancelPassenger") {
      const profile = await resolvePassenger(user);
      const id = profile.id || user.uid;
      pool = await transact(`requests/${requestId}`, (current) => {
        secure(current);
        const p = current.passengers?.[id];
        if (!p || p.authUid !== user.uid)
          fail("Only this passenger can cancel.", 403);
        if (
          active(current).some(([, member]) => member.pinVerifiedAt) ||
          current.status === "in_transit" ||
          current.status === "completed"
        )
          fail("The trip has started. Contact support.");
        p.status = "cancelled_by_commuter";
        p.cancelledAt = Date.now();
        current.paymentsReady = false;
        if (current.earlyDepartureNegotiated) {
          // A passenger leaving changes the agreed split. End the group and release
          // every hold through the existing cancellation triggers, rather than
          // charging remaining passengers a fare they never consented to.
          active(current).forEach(([, member]) => {
            member.status = "cancelled_by_commuter";
            member.cancelledAt = Date.now();
          });
          current.status = "cancelled_by_commuter";
          current.cancellationReason =
            "Negotiated group membership changed; rebook with a new fare.";
          return current;
        }
        delete current.workNegotiation;
        return expire(current, Date.now());
      });
      await db
        .ref(`commuters/${id}/currentRequest`)
        .transaction((v) => (v == null || v === requestId ? null : undefined));
    } else {
      const ledgers = {};
      for (const [id] of active(pool))
        ledgers[id] = await read(paymentPath(requestId, id));
      const taxi = await read(`taxis/${pool.taxiId}`);
      if (
        !taxi ||
        taxi.currentRequest !== requestId ||
        (taxi.authUid || taxi.userUid || pool.taxiId) !== user.uid
      ) {
        if (!(
          body.action === "complete" &&
          pool.status === "completed" &&
          pool.driverAuthUid === user.uid
        ))
          fail("The driver reservation is no longer valid.", 403);
      }
      const p = pool.passengers?.[body.passengerId];
      const nearPickup = !!(
        p &&
        taxi &&
        Number(taxi.lastSeen) > Date.now() - 120000 &&
        distanceKm(
          Number(taxi.latitude),
          Number(taxi.longitude),
          p.pickupLat,
          p.pickupLng,
        ) <= 0.3
      );
      const secret =
        body.action === "verifyPin"
          ? await read(`clubPrivate/${requestId}/pins/${body.passengerId}`)
          : null;
      const entered = String(body.pin || "");
      const pinValid = !!(
        secret &&
        secret.expiresAt >= Date.now() &&
        /^\d{4}$/.test(entered) &&
        crypto.timingSafeEqual(Buffer.from(entered), Buffer.from(secret.pin))
      );
      pool = await transact(`requests/${requestId}`, (current) =>
        driverAction(
          current,
          user.uid,
          body,
          { ledgers, nearPickup, pinValid },
          Date.now(),
        ),
      );
      if (
        body.action === "verifyPin" &&
        !pool.passengers[body.passengerId]?.pinVerifiedAt
      )
        fail(
          "Incorrect PIN. Ask the passenger for their current pickup PIN.",
          422,
        );
      if (body.action === "acceptFare") await preparePayments(requestId, pool);
      if (body.action === "complete") {
        const gross = money(
          active(pool).reduce((sum, [, p]) => sum + Number(p.price), 0),
        );
        const commission = money(gross * 0.2);
        const debt = money(
          active(pool)
            .filter(([, p]) => p.paymentMethod !== "card")
            .reduce((sum, [, p]) => sum + Number(p.price) * 0.2, 0),
        );
        await transact(`taxis/${pool.taxiId}`, (driver) => {
          if (driver.clubTripCredits?.[requestId]) return driver;
          return {
            ...driver,
            clubTripCredits: {
              ...(driver.clubTripCredits || {}),
              [requestId]: true,
            },
            totalEarnings: money(
              Number(driver.totalEarnings || 0) + gross - commission,
            ),
            commissionDebt: money(Number(driver.commissionDebt || 0) + debt),
          };
        });
      }
    }
    await sync(requestId);
    return {
      requestId,
      status: pool.status,
      verified: body.action === "verifyPin" ? true : undefined,
    };
  });
  return {
    create,
    join,
    getPin,
    submitOffer,
    action,
    sync,
    expireDue: async () => {
      const snapshots = await Promise.all(
        ["pooling", "driver_waiting", "work_negotiation", "pool_ready"].map(
          (status) =>
            db
              .ref("requests")
              .orderByChild("status")
              .equalTo(status)
              .once("value"),
        ),
      );
      for (const snapshot of snapshots) {
        for (const [id, pool] of Object.entries(snapshot.val() || {})) {
          if (pool.clubSecurityVersion === 2) await sync(id);
        }
      }
    },
  };
}
module.exports = {
  WAIT_MS,
  active,
  expire,
  offer,
  acceptFare,
  paymentGate,
  driverAction,
  registerClubLifecycle,
};

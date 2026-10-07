'use strict';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function applyClubJoin(pool, passengerId, details = {}, joinedAt = Date.now()) {
  if (!pool || pool.type !== 'club') {
    const error = new Error('Club pool was not found.');
    error.code = 'club/not-found';
    throw error;
  }

  const id = String(passengerId || '').trim();
  if (!id) {
    const error = new Error('Passenger identity is required.');
    error.code = 'club/invalid-passenger';
    throw error;
  }

  pool.passengers = pool.passengers || {};

  const existing = pool.passengers[id];
  if (existing && existing.status !== 'cancelled_by_commuter') {
    return { pool, joined: false };
  }

  const capacity = Math.max(
    1,
    Number(pool.capacity || pool.maxCapacity || 3) || 3
  );

  const activeIds = Object.entries(pool.passengers)
    .filter(([, passenger]) => passenger?.status !== 'cancelled_by_commuter')
    .map(([key]) => key);

  if (activeIds.length >= capacity) {
    const error = new Error('This Club ride is already full.');
    error.code = 'club/full';
    throw error;
  }

  const pickupLat = finiteNumber(details.pickupLat);
  const pickupLng = finiteNumber(details.pickupLng);
  const destinationLat = finiteNumber(details.destinationLat);
  const destinationLng = finiteNumber(details.destinationLng);

  pool.passengers[id] = {
    commuterId: id,
    name: String(details.name || 'Passenger').slice(0, 120),
    phone: String(details.phone || '').slice(0, 40),
    profileImageUrl: String(details.profileImageUrl || '').slice(0, 2048),
    profile_picture_url: String(details.profileImageUrl || '').slice(0, 2048),
    pickupPin: String(details.pickupPin || '').slice(0, 10),
    requirePin: true,
    safetyShareRequired: true,
    safetyShareCompleted: true,
    pickupAddress: String(details.pickupAddress || 'Current location').slice(0, 300),
    pickupLat,
    pickupLng,
    destination: String(details.destination || '').slice(0, 300),
    destinationLat,
    destinationLng,
    departureTime: String(details.departureTime || '').slice(0, 80),
    paymentMethod: String(details.paymentMethod || 'cash').slice(0, 40),
    status: 'waiting_pool',
    joinedAt
  };

  const activeAfterJoin = Object.entries(pool.passengers)
    .filter(([, passenger]) => passenger?.status !== 'cancelled_by_commuter')
    .map(([key]) => key);

  const newCount = activeAfterJoin.length;
  pool.passengerCount = newCount;
  pool.remainingSeats = Math.max(0, capacity - newCount);

  const marketReference = Number(
    pool.marketReferenceFare ||
    pool.totalPoolFare ||
    pool.calculatedPrice ||
    0
  ) || 0;

  const seatPrice = Math.ceil((marketReference / capacity) * 1.15);
  pool.pricePerPassenger = seatPrice;

  for (const activeId of activeAfterJoin) {
    pool.passengers[activeId].price = seatPrice;
  }

  if (newCount >= capacity) {
    pool.status = 'pool_ready';
    pool.poolReady = true;
    pool.poolReadyAt = joinedAt;
  } else {
    pool.poolReady = false;
    pool.status = pool.taxiId ? 'driver_waiting' : 'pooling';
  }

  return { pool, joined: true };
}

module.exports = {
  applyClubJoin
};

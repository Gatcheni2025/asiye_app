'use strict';

const JOINABLE_CLUB_STATUSES = new Set([
  'pooling',
  'waiting_members',
  'driver_waiting'
]);

const ENDED_STATUSES = new Set([
  'completed',
  'cancelled_by_driver',
  'cancelled_by_commuter',
  'cancelled_by_admin',
  'rejected'
]);

function text(value, max = 300) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function point(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const latitude = number(value.latitude);
  const longitude = number(value.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function activeClubPassengerCount(request) {
  return Object.values(request?.passengers || {})
    .filter(passenger => ![
      'cancelled',
      'cancelled_by_commuter',
      'cancelled_by_driver',
      'cancelled_by_admin',
      'rejected'
    ].includes(String(passenger?.status || '').toLowerCase()))
    .length;
}

function isTripShareParticipant(request, passengerId, authUid) {
  const commuterId = String(request?.commuterId || '');
  const passenger = String(passengerId || '');
  const uid = String(authUid || '');

  if (
    commuterId &&
    (
      commuterId === passenger ||
      commuterId === uid
    )
  ) {
    return true;
  }

  const passengers = request?.passengers || {};

  if (
    passenger &&
    Object.prototype.hasOwnProperty.call(passengers, passenger)
  ) {
    return true;
  }

  if (
    uid &&
    Object.prototype.hasOwnProperty.call(passengers, uid)
  ) {
    return true;
  }

  return Object.values(passengers).some(member => {
    const memberId = String(member?.commuterId || '');
    return (
      (passenger && memberId === passenger) ||
      (uid && memberId === uid)
    );
  });
}

function isJoinableClubRequest(request) {
  if (
    String(request?.type || '').toLowerCase() !== 'club' ||
    !JOINABLE_CLUB_STATUSES.has(String(request?.status || '').toLowerCase())
  ) {
    return false;
  }

  const capacity = Math.max(
    1,
    Number(request?.capacity || request?.maxCapacity || 4) || 4
  );

  return activeClubPassengerCount(request) < capacity;
}

function canIssueTripShare(request, passengerId, authUid) {
  return (
    isTripShareParticipant(request, passengerId, authUid) ||
    isJoinableClubRequest(request)
  );
}

function sanitizeRequest(request, requestId) {
  const pickup =
    point(request?.commuterLocation) ||
    (
      number(request?.pickupLat) !== null &&
      number(request?.pickupLng) !== null
        ? {
            latitude: number(request.pickupLat),
            longitude: number(request.pickupLng)
          }
        : null
    );

  const destination =
    point(request?.destinationCoords) ||
    (
      number(request?.destinationLat) !== null &&
      number(request?.destinationLng) !== null
        ? {
            latitude: number(request.destinationLat),
            longitude: number(request.destinationLng)
          }
        : null
    );

  return {
    requestId: text(requestId, 128),
    type: text(request?.type, 40),
    rideType: text(request?.rideType, 40),
    status: text(request?.status, 60),
    pickupAddress: text(request?.pickupAddress, 300),
    commuterLocation: pickup,
    destination: text(
      request?.destination ||
      request?.destinationName,
      300
    ),
    destinationName: text(
      request?.destinationName ||
      request?.destination,
      300
    ),
    destinationCoords: destination,
    taxiId: text(request?.taxiId, 160),
    driverName: text(request?.driverName, 120),
    driverRating: number(request?.driverRating),
    driverProfileImageUrl: text(
      request?.driverProfileImageUrl,
      2048
    ),
    vehicleInfo: text(request?.vehicleInfo, 240),
    vehicleMake: text(request?.vehicleMake, 80),
    vehicleModel: text(request?.vehicleModel, 80),
    vehicleColor: text(request?.vehicleColor, 60),
    vehicleYear: text(request?.vehicleYear, 20),
    vehicleReg: text(
      request?.vehicleReg ||
      request?.taxiRegistrationNumber,
      40
    ),
    ended: ENDED_STATUSES.has(
      String(request?.status || '').toLowerCase()
    )
  };
}

function sanitizeTaxi(taxi, request = {}) {
  if (!taxi || typeof taxi !== 'object') {
    return null;
  }

  return {
    latitude: number(taxi.latitude),
    longitude: number(taxi.longitude),
    name: text(taxi.name, 80),
    surname: text(taxi.surname, 80),
    vehicleColor: text(
      taxi.vehicleColor ||
      request.vehicleColor,
      60
    ),
    vehicleMake: text(
      taxi.vehicleMake ||
      request.vehicleMake,
      80
    ),
    vehicleModel: text(
      taxi.vehicleModel ||
      request.vehicleModel,
      80
    ),
    taxiRegistrationNumber: text(
      taxi.taxiRegistrationNumber ||
      taxi.vehicleReg ||
      taxi.registration ||
      request.vehicleReg,
      40
    ),
    profileImageUrl: text(
      taxi.profile_picture_url ||
      taxi.profileImageUrl ||
      request.driverProfileImageUrl,
      2048
    )
  };
}

function legacyShareAllowed(request, requestId, now = Date.now()) {
  if (!request || request.safetyShareCompleted !== true) {
    return false;
  }

  const createdAt = number(request.createdAt || request.timestamp);

  if (
    createdAt !== null &&
    now - createdAt > 7 * 24 * 60 * 60 * 1000
  ) {
    return false;
  }

  const legacyUrl = String(request.liveTrackingUrl || '');

  return (
    legacyUrl.includes(
      'trip=' + encodeURIComponent(String(requestId || ''))
    ) ||
    legacyUrl.includes(
      'requestId=' + encodeURIComponent(String(requestId || ''))
    )
  );
}

module.exports = {
  activeClubPassengerCount,
  canIssueTripShare,
  isJoinableClubRequest,
  isTripShareParticipant,
  legacyShareAllowed,
  sanitizeRequest,
  sanitizeTaxi
};

'use strict';
// Written only by the authenticated image-upload endpoint, after Storage readback.
// This confirms a saved profile picture; it does not assert biometric identity.
function assertPassengerBookingProfile(profile, user) {
  const data = profile?.data || profile || {};
  if (data.bookingFaceAuthUid !== user?.uid || !Number.isFinite(data.bookingFaceSavedAt) ||
      data.bookingFaceSavedAt <= 0 || String(data.name || '').trim().length < 2 ||
      !/^https:\/\//.test(String(data.profileImageUrl || ''))) {
    const error = new Error('Take and save your face picture before your first booking.');
    error.status = 403;
    error.code = 'passenger-face-required';
    throw error;
  }
}
module.exports = {assertPassengerBookingProfile};

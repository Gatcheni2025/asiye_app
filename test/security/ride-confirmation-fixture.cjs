exports.request = {
  requestId: 'go-confirmation-343', type: 'ehailing', rideType: 'go',
  status: 'accepted', driverName: 'Alex Dlamini', driverRating: 4.9,
  driverPhone: '+27310000000', vehicleColor: 'White', vehicleMake: 'Toyota',
  vehicleModel: 'Corolla', vehicleYear: 2022, vehicleReg: 'ND 123 456',
  driverProfileImageUrl: 'https://fixture.test/profile.png',
  driverVehiclePhoto: 'https://fixture.test/car.png', paymentMethod: 'cash',
  pickupAddress: 'Pickup Road, Durban, KwaZulu-Natal, South Africa',
  destination: 'Destination Avenue, Umhlanga, KwaZulu-Natal, South Africa'
};

exports.bootstrap = function () {
  window.__actions = [];
  window.ASIYE = {
    state: { userId: 'passenger', booking: { fare: 113, paymentMethod: 'cash' } },
    ui: {
      escape: value => String(value).replace(/[&<>"']/g,
        char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
      toast: message => window.__actions.push(['toast', message])
    },
    booking: { cancelCurrentRide: async () => window.__actions.push(['cancel']) }
  };
  window.AsiyeTripChat = {
    open: async (request, id) => window.__actions.push(['message', id])
  };
};

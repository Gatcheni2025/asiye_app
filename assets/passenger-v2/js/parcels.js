/* ============================================================
   ASIYE PASSENGER V2
   PARCEL DELIVERY
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.parcels = {

    renderBooking() {
        const container =
            document.getElementById('sheetContent');

        if (!container) return;

        const destination =
            ASIYE.state.destination;

        const route =
            ASIYE.state.route;

        const fare =
            Number(
                ASIYE.pricing.calculate().go || 0
            );

        container.innerHTML = `
            <div class="sheet-page-header">
                <button id="parcelBack" class="sheet-back-button">
                    <i class="fas fa-arrow-left"></i>
                </button>

                <div>
                    <h2 class="sheet-page-title">Send a parcel</h2>
                    <div style="color:#888;font-size:10px;margin-top:2px;">
                        ${Number(route.distanceKm || 0).toFixed(1)} km ·
                        ${Number(route.durationMinutes || 0)} min
                    </div>
                </div>
            </div>

            <div class="asiye-route-summary">
                <div style="font-size:10px;color:#888;font-weight:800;">DELIVER TO</div>
                <strong style="display:block;margin-top:4px;">
                    ${ASIYE.ui.escape(destination.name || destination.address || '')}
                </strong>
            </div>

            <div class="member-info" style="margin-top:12px;">
                <strong>Asiye Parcel · R${fare.toFixed(0)}</strong>
                <p style="margin-bottom:0;">
                    Door-to-door delivery with a verified Asiye driver.
                    A safety PIN is created for every parcel handover.
                </p>
            </div>

            <form id="parcelBookingForm" style="display:grid;gap:12px;margin-top:14px;">
                <label>
                    Recipient name
                    <input
                        name="recipientName"
                        type="text"
                        maxlength="100"
                        autocomplete="name"
                        required
                        style="width:100%;box-sizing:border-box;margin-top:5px;"
                    >
                </label>

                <label>
                    Recipient phone
                    <input
                        name="recipientPhone"
                        type="tel"
                        maxlength="20"
                        autocomplete="tel"
                        required
                        placeholder="082 123 4567"
                        style="width:100%;box-sizing:border-box;margin-top:5px;"
                    >
                </label>

                <label>
                    What are you sending?
                    <input
                        name="parcelDescription"
                        type="text"
                        maxlength="160"
                        required
                        placeholder="e.g. Documents, clothing"
                        style="width:100%;box-sizing:border-box;margin-top:5px;"
                    >
                </label>

                <label>
                    Parcel size
                    <select
                        name="parcelSize"
                        required
                        style="width:100%;box-sizing:border-box;margin-top:5px;"
                    >
                        <option value="small">Small · fits on a seat</option>
                        <option value="medium">Medium · boot space</option>
                        <option value="large">Large · confirm with driver</option>
                    </select>
                </label>

                <label style="display:flex;gap:9px;align-items:center;">
                    <input name="fragile" type="checkbox">
                    Fragile / handle with care
                </label>

                <button class="primary-button" type="submit">
                    Book parcel delivery · R${fare.toFixed(0)}
                </button>
            </form>
        `;

        document
            .getElementById('parcelBack')
            ?.addEventListener(
                'click',
                () => ASIYE.ui.renderDestinationSearch()
            );

        const form =
            document.getElementById('parcelBookingForm');

        form?.addEventListener(
            'submit',
            async event => {
                event.preventDefault();

                const button =
                    form.querySelector('[type="submit"]');

                button.disabled = true;
                button.innerHTML =
                    '<i class="fas fa-circle-notch fa-spin"></i> Preparing delivery';

                try {
                    const data =
                        new FormData(form);

                    const requestId =
                        await this.create({
                            recipientName:
                                String(data.get('recipientName') || '').trim(),
                            recipientPhone:
                                String(data.get('recipientPhone') || '').trim(),
                            parcelDescription:
                                String(data.get('parcelDescription') || '').trim(),
                            parcelSize:
                                String(data.get('parcelSize') || 'small'),
                            fragile:
                                data.get('fragile') === 'on'
                        });

                    await ASIYE.ride.start(
                        requestId
                    );
                } catch (error) {
                    console.error('Parcel booking failed:', error);
                    ASIYE.ui.toast(
                        error?.message ||
                        'Could not create the parcel delivery.'
                    );
                    button.disabled = false;
                    button.textContent =
                        `Book parcel delivery · R${fare.toFixed(0)}`;
                }
            }
        );
    },

    async create(details = {}) {
        const uid =
            ASIYE.state.userId;

        if (!uid) {
            throw new Error('Passenger is not logged in.');
        }

        if (
            !details.recipientName ||
            !details.recipientPhone ||
            !details.parcelDescription
        ) {
            throw new Error('Add the recipient and parcel details.');
        }

        const profileImageUrl =
            await ASIYE.profile.ensureRequired();

        const user =
            ASIYE.state.user || {};

        const pickup =
            ASIYE.state.location;

        const destination =
            ASIYE.state.destination;

        const route =
            ASIYE.state.route;

        const fare =
            Number(
                ASIYE.pricing.calculate().go || 0
            );

        const pickupPin =
            await ASIYE.booking
                .requirePassengerPin();

        await ASIYE.booking.requireTripShare({
            pickupPin,
            pickupAddress:
                pickup.address ||
                'Current location',
            destination:
                destination.address ||
                destination.name,
            service:
                'Asiye Parcel'
        });

        const requestRef =
            firebase.database()
                .ref('requests')
                .push();

        const requestId =
            requestRef.key;

        const requestData = {
            requestId,
            type:
                'delivery',
            rideType:
                'delivery',
            carCategory:
                'go',
            status:
                'pending',

            commuterId:
                uid,
            commuterName:
                user.name ||
                user.firstName ||
                'Passenger',
            commuterPhone:
                user.phone ||
                user.phoneNumber ||
                '',
            commuterProfileImageUrl:
                profileImageUrl,
            passengerProfileImageUrl:
                profileImageUrl,

            recipientName:
                details.recipientName,
            recipientPhone:
                details.recipientPhone,
            parcelDescription:
                details.parcelDescription,
            parcelSize:
                details.parcelSize ||
                'small',
            fragile:
                details.fragile === true,

            pickupAddress:
                pickup.address ||
                'Current location',
            commuterLocation: {
                latitude:
                    pickup.latitude,
                longitude:
                    pickup.longitude
            },

            destination:
                destination.address ||
                destination.name,
            destinationName:
                destination.name ||
                destination.address,
            destinationCoords: {
                latitude:
                    destination.latitude,
                longitude:
                    destination.longitude
            },

            routeDistanceKm:
                Number(route.distanceKm || 0),
            routeDurationMinutes:
                Number(route.durationMinutes || 0),

            calculatedPrice:
                fare,
            finalAmount:
                fare,
            paymentMethod:
                ASIYE.state.booking.paymentMethod ||
                'cash',

            requirePin:
                true,
            pickupPin,
            safetyShareRequired:
                true,
            safetyShareCompleted:
                true,
            safetyShareAt:
                firebase.database.ServerValue.TIMESTAMP,

            commissionRate:
                0.20,

            taxiId:
                null,
            driverName:
                null,
            driverPhone:
                null,
            driverRating:
                null,

            createdAt:
                firebase.database.ServerValue.TIMESTAMP
        };

        await requestRef.set(
            requestData
        );

        await firebase.database()
            .ref(`delivery_requests/${requestId}`)
            .set(requestData);

        await firebase.database()
            .ref(`commuters/${uid}`)
            .update({
                currentRequest:
                    requestId
            });

        ASIYE.state.booking.requestId =
            requestId;

        ASIYE.state.booking.request =
            requestData;

        localStorage.setItem(
            'currentRequestId',
            requestId
        );

        await ASIYE.booking.notifyGoDrivers(
            requestId,
            requestData
        );

        return requestId;
    }
};

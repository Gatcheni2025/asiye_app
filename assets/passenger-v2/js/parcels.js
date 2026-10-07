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
                    A 4-digit handover PIN is created after confirmed card payment,
                    or before dispatch for Cash/Wallet.
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

                ${ASIYE.ui.renderPaymentMethodChooser()}

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

        ASIYE.ui
            .bindPaymentMethodChooser(
                container
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

                    const result =
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

                    if (
                        result &&
                        typeof result ===
                            'object' &&
                        result.paymentPending ===
                            true
                    ) {
                        ASIYE.ui.toast(
                            'Complete the Paystack card payment. Your parcel PIN will be created automatically after payment.'
                        );

                        button.disabled = false;
                        button.textContent =
                            'Card payment opened';

                        return;
                    }

                    const requestId =
                        typeof result ===
                            'string'
                            ? result
                            : result?.requestId;

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
            throw new Error(
                'Passenger is not logged in.'
            );
        }

        if (
            !details.recipientName ||
            !details.recipientPhone ||
            !details.parcelDescription
        ) {
            throw new Error(
                'Add the recipient and parcel details.'
            );
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

        const paymentMethod =
            String(
                ASIYE.state.booking
                    .paymentMethod ||
                'cash'
            )
            .toLowerCase();

        if (
            paymentMethod ===
                'wallet'
        ) {
            if (
                !ASIYE.wallet ||
                typeof ASIYE.wallet.requireFare !==
                    'function'
            ) {
                throw new Error(
                    'Asiye Wallet is unavailable. Reopen the app and try again.'
                );
            }

            await ASIYE.wallet.requireFare(
                fare,
                'Asiye Parcel'
            );
        }

        const requestRef =
            firebase.database()
                .ref('requests')
                .push();

        const requestId =
            requestRef.key;

        const liveTrackingUrl =
            ASIYE.booking
                .liveTrackingUrl(
                    requestId
                );

        let pickupPin =
            null;

        let safetyShareCompleted =
            false;

        if (
            paymentMethod !==
                'card'
        ) {
            pickupPin =
                await ASIYE.booking
                    .requirePassengerPin();

            await ASIYE.booking.requireTripShare({
                requestId,
                liveTrackingUrl,
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

            safetyShareCompleted =
                true;
        }

        const requestData = {
            requestId,
            type:
                'delivery',
            rideType:
                'delivery',
            carCategory:
                'go',
            status:
                paymentMethod ===
                    'card'
                    ? 'share_required'
                    : 'pending',

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
                details.fragile ===
                true,

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
            paymentMethod,
            paymentStatus:
                paymentMethod ===
                    'card'
                    ? 'payment_required'
                    : 'preparing',
            paymentsReady:
                false,

            requirePin:
                true,
            pickupPin,
            pinAutoGenerated:
                false,
            safetyShareRequired:
                true,
            safetyShareCompleted,
            safetyShareAt:
                safetyShareCompleted
                    ? firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
                    : null,
            liveTrackingUrl,

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
                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };

        await requestRef.set(
            requestData
        );

        await firebase.database()
            .ref(
                `delivery_requests/${requestId}`
            )
            .set(
                requestData
            );

        await firebase.database()
            .ref(
                `commuters/${uid}`
            )
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

        let paymentResult;

        try {
            if (
                !ASIYE.payments ||
                typeof ASIYE.payments.prepare !==
                    'function'
            ) {
                throw new Error(
                    'Asiye payments are unavailable. Reopen the app and try again.'
                );
            }

            paymentResult =
                await ASIYE.payments
                    .prepare(
                        requestId
                    );

        } catch (error) {
            await Promise.all([
                requestRef
                    .remove()
                    .catch(
                        () => {}
                    ),
                firebase
                    .database()
                    .ref(
                        `delivery_requests/${requestId}`
                    )
                    .remove()
                    .catch(
                        () => {}
                    ),
                firebase
                    .database()
                    .ref(
                        `commuters/${uid}`
                    )
                    .update({
                        currentRequest:
                            null
                    })
                    .catch(
                        () => {}
                    )
            ]);

            ASIYE.booking
                .clearLocalRide();

            throw error;
        }

        if (
            paymentResult
                ?.paymentPending ===
                true
        ) {
            return {
                requestId,
                paymentPending:
                    true
            };
        }

        const paymentStatus =
            paymentResult?.status ||
            (
                paymentMethod ===
                    'cash'
                    ? 'cash_due'
                    : 'held'
            );

        const readyPatch = {
            status:
                'pending',
            paymentStatus,
            paymentsReady:
                true
        };

        await firebase.database()
            .ref()
            .update({
                [`requests/${requestId}/status`]:
                    readyPatch.status,
                [`requests/${requestId}/paymentStatus`]:
                    readyPatch.paymentStatus,
                [`requests/${requestId}/paymentsReady`]:
                    true,
                [`delivery_requests/${requestId}/status`]:
                    readyPatch.status,
                [`delivery_requests/${requestId}/paymentStatus`]:
                    readyPatch.paymentStatus,
                [`delivery_requests/${requestId}/paymentsReady`]:
                    true
            });

        Object.assign(
            requestData,
            readyPatch
        );

        await ASIYE.booking.notifyGoDrivers(
            requestId,
            requestData
        );

        return requestId;
    },


    async finalizePaidRequest(
        requestId
    ) {
        const requestRef =
            firebase.database()
                .ref(
                    `requests/${requestId}`
                );

        let snapshot =
            await requestRef.once(
                'value'
            );

        let request =
            snapshot.val();

        if (!request) {
            throw new Error(
                'Paid parcel delivery could not be found.'
            );
        }

        if (
            String(
                request.paymentMethod ||
                ''
            )
            .toLowerCase() !==
                'card'
        ) {
            throw new Error(
                'This parcel is not awaiting a card payment.'
            );
        }

        if (
            ![
                'held',
                'captured'
            ].includes(
                String(
                    request.paymentStatus ||
                    ''
                )
            )
        ) {
            throw new Error(
                'Paystack payment has not been confirmed yet.'
            );
        }

        let pickupPin =
            String(
                request.pickupPin ||
                ''
            );

        if (
            !/^\d{4}$/.test(
                pickupPin
            )
        ) {
            pickupPin =
                ASIYE.booking
                    .generatePin();
        }

        if (
            request.safetyShareCompleted !==
                true
        ) {
            await ASIYE.booking
                .requireTripShare({
                    requestId,
                    liveTrackingUrl:
                        request.liveTrackingUrl ||
                        ASIYE.booking
                            .liveTrackingUrl(
                                requestId
                            ),
                    pickupPin,
                    pickupAddress:
                        request.pickupAddress ||
                        'Current location',
                    destination:
                        request.destination ||
                        request.destinationName,
                    service:
                        'Asiye Parcel'
                });
        }

        const timestamp =
            firebase
                .database
                .ServerValue
                .TIMESTAMP;

        const patch = {
            pickupPin,
            requirePin:
                true,
            pinAutoGenerated:
                true,
            pinGeneratedAfterPayment:
                true,
            pinGeneratedAt:
                timestamp,
            safetyShareCompleted:
                true,
            safetyShareAt:
                timestamp,
            paymentsReady:
                true,
            status:
                'pending'
        };

        await firebase.database()
            .ref()
            .update({
                [`requests/${requestId}/pickupPin`]:
                    pickupPin,
                [`requests/${requestId}/requirePin`]:
                    true,
                [`requests/${requestId}/pinAutoGenerated`]:
                    true,
                [`requests/${requestId}/pinGeneratedAfterPayment`]:
                    true,
                [`requests/${requestId}/pinGeneratedAt`]:
                    timestamp,
                [`requests/${requestId}/safetyShareCompleted`]:
                    true,
                [`requests/${requestId}/safetyShareAt`]:
                    timestamp,
                [`requests/${requestId}/paymentsReady`]:
                    true,
                [`requests/${requestId}/status`]:
                    'pending',

                [`delivery_requests/${requestId}/pickupPin`]:
                    pickupPin,
                [`delivery_requests/${requestId}/requirePin`]:
                    true,
                [`delivery_requests/${requestId}/pinAutoGenerated`]:
                    true,
                [`delivery_requests/${requestId}/pinGeneratedAfterPayment`]:
                    true,
                [`delivery_requests/${requestId}/pinGeneratedAt`]:
                    timestamp,
                [`delivery_requests/${requestId}/safetyShareCompleted`]:
                    true,
                [`delivery_requests/${requestId}/safetyShareAt`]:
                    timestamp,
                [`delivery_requests/${requestId}/paymentsReady`]:
                    true,
                [`delivery_requests/${requestId}/status`]:
                    'pending'
            });

        snapshot =
            await requestRef.once(
                'value'
            );

        request =
            snapshot.val() ||
            {
                ...request,
                ...patch
            };

        const alreadyDispatched =
            Boolean(
                request.driverDispatchAt ||
                request.driverDispatchCount ||
                request.taxiId ||
                request.queuedTaxiId
            ) ||
            [
                'searching',
                'driver_busy',
                'accepted',
                'driver_on_way',
                'arrived',
                'in_transit',
                'completed'
            ].includes(
                String(
                    request.status ||
                    ''
                )
            );

        if (!alreadyDispatched) {
            await ASIYE.booking
                .notifyGoDrivers(
                    requestId,
                    request
                );
        }

        await firebase.database()
            .ref()
            .update({
                [`requests/${requestId}/cardFinalizedAt`]:
                    timestamp,
                [`delivery_requests/${requestId}/cardFinalizedAt`]:
                    timestamp
            });

        ASIYE.state.booking.requestId =
            requestId;

        ASIYE.state.booking.request = {
            ...request,
            pickupPin
        };

        localStorage.setItem(
            'currentRequestId',
            requestId
        );

        await ASIYE.ride
            ?.start?.(
                requestId
            );

        ASIYE.ui?.toast?.(
            'Card payment confirmed. Your parcel handover PIN is ready.'
        );

        return {
            requestId,
            pickupPin
        };
    }
};

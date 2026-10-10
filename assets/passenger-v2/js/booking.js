/* ============================================================
   ASIYE PASSENGER V2
   BOOKING SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.booking = {

    async create() {

        const type =
            ASIYE.state.booking.rideType;

        if (!type) {

            throw new Error(
                'No ride type selected.'
            );
        }


        if (type === 'go') {

            return await this.createGoRide();
        }


        if (
            type === 'club4' ||
            type === 'club7'
        ) {

            const time =
                ASIYE.state.booking
                    .club
                    .departureTime;


            return await ASIYE.club.book(
                type,
                time
            );
        }


        throw new Error(
            `Unsupported ride type: ${type}`
        );
    },


    /* ========================================================
       ASIYE GO
       ======================================================== */

    async createGoRide() {

        const uid =
            ASIYE.state.userId;


        if (!uid) {

            throw new Error(
                'Passenger is not logged in.'
            );
        }


        const user =
            ASIYE.state.user || {};


        const pickup =
            ASIYE.state.location;


        const destination =
            ASIYE.state.destination;


        const route =
            ASIYE.state.route;


        const quote =
            ASIYE.pricing.calculate();


        const fare =
            Number(
                ASIYE.goNegotiation
                    ?.currentOffer?.() ??
                quote.goSuggested ??
                quote.go ??
                0
            );


        const paymentMethod =
            String(
                ASIYE.state.booking
                    .paymentMethod ||
                'cash'
            )
            .toLowerCase();


        /*
         * Wallet affordability is checked only after a driver accepts the
         * passenger offer (or the passenger accepts a protected counter).
         * The agreed fare may differ from the initial offer.
         */

        const profileImageUrl =
            await ASIYE.profile
                .ensureRequired();


        if (
            !Number.isFinite(
                pickup.latitude
            ) ||
            !Number.isFinite(
                pickup.longitude
            )
        ) {

            throw new Error(
                'Pickup location is unavailable.'
            );
        }


        if (
            !Number.isFinite(
                destination.latitude
            ) ||
            !Number.isFinite(
                destination.longitude
            )
        ) {

            throw new Error(
                'Destination is unavailable.'
            );
        }


        const requestRef =

            firebase
                .database()
                .ref('requests')
                .push();


        const requestId =
            requestRef.key;


        /*
         * Card bookings are paid BEFORE a safety PIN or live-share link is
         * created. This prevents Paystack checkout and the loved-one share
         * sheet from competing for control of the app.
         *
         * Cash/Wallet keep the existing pre-dispatch safety flow.
         */
        const isCardPayment =
            paymentMethod ===
            'card';


        const pickupPin =
            null;


        const requestData = {

            requestId:
                requestId,

            type:
                'ehailing',

            rideType:
                'go',

            carCategory:
                'go',

            status:
                'pending',


            /* Passenger */

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


            /* Pickup */

            pickupAddress:
                pickup.address ||
                'Current location',

            commuterLocation: {

                latitude:
                    pickup.latitude,

                longitude:
                    pickup.longitude
            },


            /* Destination */

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


            /* Route */

            routeDistanceKm:
                Number(
                    route.distanceKm || 0
                ),

            routeDurationMinutes:
                Number(
                    route.durationMinutes || 0
                ),


            /* Fare */

            calculatedPrice:
                fare,

            finalAmount:
                fare,

            marketReferenceFare:
                Number(
                    quote.marketReference ||
                    0
                ),

            suggestedFare:
                Number(
                    quote.goSuggested ||
                    quote.go ||
                    fare
                ),

            minimumFareOffer:
                Number(
                    quote.goMinimumOffer ||
                    fare
                ),

            maximumFareOffer:
                Number(
                    quote.goMaximumOffer ||
                    fare
                ),

            passengerOffer:
                fare,

            agreedFare:
                null,

            driverCounterFare:
                null,

            fareStatus:
                'passenger_offer',

            negotiationEnabled:
                true,

            negotiationRound:
                1,

            commissionRate:
                Number(
                    quote.goCommissionRate ||
                    0.20
                ),

            platformCommission:
                ASIYE.pricing
                    .money(
                        fare *
                        Number(
                            quote.goCommissionRate ||
                            0.20
                        )
                    ),

            driverNetFare:
                ASIYE.pricing
                    .money(
                        fare *
                        (
                            1 -
                            Number(
                                quote.goCommissionRate ||
                                0.20
                            )
                        )
                    ),

            paymentMethod:
                paymentMethod,

            paymentStatus:
                'negotiation_pending',

            paymentsReady:
                false,


            /* Safety */

            requirePin:
                true,

            pickupPin:
                pickupPin,

            safetyShareRequired:
                true,

            safetyShareCompleted:
                false,


            /* Driver */

            taxiId:
                null,

            driverName:
                null,

            driverPhone:
                null,

            driverRating:
                null,


            /* Timestamps */

            createdAt:
                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };


        await requestRef.set(
            requestData
        );


        /*
         * PROTECTED GO NEGOTIATION:
         * The server recomputes the permitted corridor and overwrites all
         * commercial fields before any driver sees the request.
         *
         * Payment, PIN generation and loved-one sharing happen only after
         * the fare is agreed with a driver.
         */
        try {

            const validated =
                await ASIYE.goNegotiation
                    .submitOffer(
                        requestId,
                        fare
                    );


            if (
                validated?.pricing
            ) {
                Object.assign(
                    requestData,
                    validated.pricing
                );
            }


            await firebase
                .database()
                .ref(
                    `commuters/${uid}`
                )
                .update({
                    currentRequest:
                        requestId
                });


            ASIYE.state.booking
                .requestId =
                requestId;


            ASIYE.state.booking
                .request =
                requestData;


            localStorage.setItem(
                'currentRequestId',
                requestId
            );


            await this.notifyGoDrivers(
                requestId,
                requestData
            );


            return requestId;

        } catch (error) {

            await requestRef
                .remove()
                .catch(
                    () => {}
                );


            await firebase
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
                );


            this.clearLocalRide();


            throw error;
        }


        /*
         * Legacy fixed-fare payment flow retained below for compatibility
         * with older cached WebViews. Build 331 returns above.
         */

        /*
         * CARD FIRST:
         * 1. Save a non-dispatched draft request.
         * 2. Open Paystack.
         * 3. Do not generate/share a PIN yet.
         * 4. The verified Paystack return calls finalizePaidCardBooking().
         */
        if (isCardPayment) {
            await firebase
                .database()
                .ref(
                    `commuters/${uid}`
                )
                .update({
                    currentRequest:
                        requestId
                });


            ASIYE.state.booking
                .requestId =
                requestId;


            ASIYE.state.booking
                .request =
                requestData;


            localStorage.setItem(
                'currentRequestId',
                requestId
            );


            try {
                if (
                    !ASIYE.payments ||
                    typeof ASIYE.payments.prepare !==
                        'function'
                ) {
                    throw new Error(
                        'Secure card payment is unavailable. Reopen Asiye and try again.'
                    );
                }


                const cardPayment =
                    await ASIYE.payments
                        .prepare(
                            requestId
                        );


                if (
                    cardPayment
                        ?.paymentPending ===
                        true
                ) {
                    requestData.status =
                        'payment_required';

                    requestData.paymentStatus =
                        'payment_required';

                    ASIYE.state.booking
                        .request =
                        requestData;

                    return {
                        requestId,
                        paymentPending:
                            true
                    };
                }


                if (
                    cardPayment?.ready ===
                        true &&
                    [
                        'held',
                        'captured'
                    ].includes(
                        String(
                            cardPayment.status ||
                            ''
                        )
                    )
                ) {
                    await this
                        .finalizePaidCardBooking(
                            requestId
                        );

                    return requestId;
                }


                throw new Error(
                    'Card payment could not be confirmed.'
                );

            } catch (error) {
                /*
                 * If Paystack was never initialized, remove the empty draft.
                 * Once a payment reference exists, keep the request so a
                 * successful payment can always be reconciled safely.
                 */
                const pendingCard =
                    ASIYE.payments
                        ?.pendingCard?.();

                if (
                    !pendingCard ||
                    pendingCard.requestId !==
                        requestId
                ) {
                    await requestRef
                        .remove()
                        .catch(
                            () => {}
                        );

                    await firebase
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
                        );

                    this.clearLocalRide();
                }

                throw error;
            }
        }


        let liveTrackingUrl;


        try {

            liveTrackingUrl =
                await this.createLiveShareUrl(
                    requestId
                );


            await this.requireTripShare({
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
                    'Asiye Go'
            });


            await requestRef.update({
                safetyShareCompleted:
                    true,

                safetyShareAt:
                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


            requestData.safetyShareCompleted =
                true;

        } catch (error) {

            await requestRef
                .remove()
                .catch(
                    () => {}
                );

            throw error;
        }


        await firebase
            .database()
            .ref(
                `commuters/${uid}`
            )
            .update({
                currentRequest:
                    requestId
            });


        ASIYE.state.booking
            .requestId =
            requestId;


        ASIYE.state.booking
            .request =
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
            await requestRef
                .remove()
                .catch(
                    () => {}
                );

            await firebase
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
                );

            this.clearLocalRide();

            throw error;
        }


        if (
            paymentResult
                ?.paymentPending ===
                true
        ) {
            requestData.status =
                'payment_required';

            requestData.paymentStatus =
                'payment_required';

            ASIYE.state.booking
                .request =
                requestData;

            return {
                requestId,
                paymentPending:
                    true
            };
        }


        await requestRef.update({
            status:
                'pending',

            paymentStatus:
                paymentResult?.status ||
                (
                    paymentMethod ===
                        'cash'
                        ? 'cash_due'
                        : 'held'
                ),

            paymentsReady:
                true
        });


        requestData.status =
            'pending';

        requestData.paymentStatus =
            paymentResult?.status ||
            (
                paymentMethod ===
                    'cash'
                    ? 'cash_due'
                    : 'held'
            );

        requestData.paymentsReady =
            true;


        /*
         * Notify eligible drivers only after the selected payment
         * method is ready. Card payments return here only after
         * verification; Wallet funds are already reserved.
         */

        await this.notifyGoDrivers(
            requestId,
            requestData
        );


        return requestId;
    },


    /*
     * Final negotiated Go gate.
     *
     * The driver is already reserved and the fare is immutable. This method
     * creates the pickup PIN and live-share link only after the selected
     * payment method is ready, then asks the server to activate the trip.
     */
    async finalizeNegotiatedGoBooking(
        requestId,
        paymentResult = null,
        restoredRequest = null
    ) {

        if (!requestId) {
            throw new Error(
                'Negotiated ride reference is missing.'
            );
        }


        const requestRef =
            firebase
                .database()
                .ref(
                    `requests/${requestId}`
                );


        let request =
            restoredRequest;


        if (!request) {
            const snapshot =
                await requestRef
                    .once(
                        'value'
                    );

            request =
                snapshot.val();
        }


        if (
            !request ||
            request.negotiationEnabled !==
                true ||
            request.fareStatus !==
                'agreed' ||
            !request.taxiId
        ) {

            throw new Error(
                'The negotiated fare and driver must be locked before payment can complete.'
            );
        }


        if (
            request.negotiatedBookingFinalized ===
                true &&
            request.safetyShareCompleted ===
                true &&
            request.status ===
                'accepted'
        ) {

            ASIYE.state.booking
                .requestId =
                requestId;


            ASIYE.state.booking
                .request =
                request;


            localStorage.setItem(
                'currentRequestId',
                requestId
            );


            await ASIYE.ride
                ?.start?.(
                    requestId
                );


            return request;
        }


        const method =
            String(
                request.paymentMethod ||
                'cash'
            )
                .toLowerCase();


        const paymentStatus =
            String(
                paymentResult?.status ||
                request.paymentStatus ||
                ''
            );


        const paymentReady =
            method ===
                'cash'
                ? paymentStatus ===
                    'cash_due'
                : [
                    'held',
                    'captured'
                ].includes(
                    paymentStatus
                );


        if (!paymentReady) {
            throw new Error(
                method ===
                    'card'
                    ? 'Card payment must be confirmed before the booking can continue.'
                    : method ===
                        'wallet'
                        ? 'Wallet funds must be reserved before the booking can continue.'
                        : 'The negotiated trip payment is not ready.'
            );
        }


        const existingPin =
            String(
                request.pickupPin ||
                ''
            );


        const pickupPin =
            /^\d{4}$/.test(
                existingPin
            )
                ? existingPin
                : this.generatePin();


        await requestRef
            .update({
                pickupPin,
                requirePin:
                    true,
                safetyShareRequired:
                    true,
                safetyShareCompleted:
                    false
            });


        const liveTrackingUrl =
            await this.createLiveShareUrl(
                requestId
            );


        await this.requireTripShare({
            requestId,
            liveTrackingUrl,
            pickupPin,
            pickupAddress:
                request.pickupAddress ||
                'Current location',
            destination:
                request.destination ||
                request.destinationName ||
                'Not available',
            service:
                'Asiye Go'
        });


        await requestRef
            .update({
                pickupPin,
                safetyShareCompleted:
                    true,
                safetyShareAt:
                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


        const finalized =
            await ASIYE.goNegotiation
                .post(
                    'finalizeNegotiatedGoBooking',
                    {
                        requestId
                    }
                );


        const finalSnapshot =
            await requestRef
                .once(
                    'value'
                );


        const finalRequest =
            finalSnapshot.val() || {
                ...request,
                pickupPin,
                safetyShareCompleted:
                    true,
                status:
                    finalized.status ||
                    'accepted',
                paymentsReady:
                    true,
                paymentStatus
            };


        finalRequest.requestId =
            requestId;


        ASIYE.state.booking
            .requestId =
            requestId;


        ASIYE.state.booking
            .request =
            finalRequest;


        localStorage.setItem(
            'currentRequestId',
            requestId
        );


        await ASIYE.ride
            ?.start?.(
                requestId
            );


        ASIYE.ui?.toast?.(
            `Fare R${Number(
                finalRequest.agreedFare ||
                request.agreedFare ||
                0
            ).toFixed(0)} agreed. Payment ready, PIN created and driver reserved.`
        );


        return finalRequest;
    },


    /*
     * Final card-booking gate.
     * Paystack MUST already be verified and held/captured before this runs.
     * Only then do we create the safety PIN, live link, share it, dispatch
     * drivers and present the live ride screen.
     */
    async finalizePaidCardBooking(
        requestId,
        restoredRequest = null
    ) {
        if (!requestId) {
            throw new Error(
                'Paid booking reference is missing.'
            );
        }


        const requestRef =
            firebase
                .database()
                .ref(
                    `requests/${requestId}`
                );


        let request =
            restoredRequest;


        if (!request) {
            const snapshot =
                await requestRef
                    .once(
                        'value'
                    );

            request =
                snapshot.val();
        }


        if (!request) {
            throw new Error(
                'Paid ride could not be restored.'
            );
        }


        if (
            String(
                request.paymentMethod ||
                ''
            ).toLowerCase() !==
                'card'
        ) {
            throw new Error(
                'This booking is not a card booking.'
            );
        }


        const paymentStatus =
            String(
                request.paymentStatus ||
                ''
            );


        if (
            ![
                'held',
                'captured'
            ].includes(
                paymentStatus
            ) ||
            request.paymentsReady !==
                true
        ) {
            throw new Error(
                'Card payment must be confirmed before the booking can continue.'
            );
        }


        if (
            request.negotiationEnabled ===
                true &&
            request.fareStatus ===
                'agreed' &&
            request.taxiId
        ) {

            return this
                .finalizeNegotiatedGoBooking(
                    requestId,
                    {
                        ready:
                            true,
                        status:
                            paymentStatus
                    },
                    request
                );
        }


        /*
         * A duplicate Paystack return must not create a second PIN/share or
         * dispatch the same ride twice.
         */
        if (
            request.cardBookingFinalized ===
                true &&
            request.safetyShareCompleted ===
                true &&
            request.status ===
                'pending'
        ) {
            ASIYE.state.booking
                .requestId =
                requestId;

            ASIYE.state.booking
                .request =
                request;

            localStorage.setItem(
                'currentRequestId',
                requestId
            );

            await ASIYE.ride
                ?.start?.(
                    requestId
                );

            return request;
        }


        const existingPin =
            String(
                request.pickupPin ||
                ''
            );


        const pickupPin =
            /^\d{4}$/.test(
                existingPin
            )
                ? existingPin
                : this.generatePin();


        /*
         * At this point payment is safe. Move to the safety gate and persist
         * the generated PIN before opening the share sheet.
         */
        await requestRef
            .update({
                pickupPin,
                requirePin:
                    true,
                safetyShareRequired:
                    true,
                safetyShareCompleted:
                    false,
                status:
                    'share_required'
            });


        const liveTrackingUrl =
            await this.createLiveShareUrl(
                requestId
            );


        await this.requireTripShare({
            requestId,
            liveTrackingUrl,
            pickupPin,
            pickupAddress:
                request.pickupAddress ||
                'Current location',
            destination:
                request.destination ||
                request.destinationName ||
                'Not available',
            service:
                'Asiye Go'
        });


        const finalPatch = {
            pickupPin,
            safetyShareCompleted:
                true,
            safetyShareAt:
                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP,
            status:
                'pending',
            paymentStatus,
            paymentsReady:
                true,
            cardBookingFinalized:
                true,
            cardBookingFinalizedAt:
                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };


        await requestRef
            .update(
                finalPatch
            );


        const finalRequest = {
            ...request,
            ...finalPatch,
            pickupPin,
            safetyShareCompleted:
                true,
            status:
                'pending',
            paymentStatus,
            paymentsReady:
                true,
            cardBookingFinalized:
                true
        };


        const uid =
            ASIYE.state.userId;


        if (uid) {
            await firebase
                .database()
                .ref(
                    `commuters/${uid}`
                )
                .update({
                    currentRequest:
                        requestId
                });
        }


        ASIYE.state.booking
            .requestId =
            requestId;


        ASIYE.state.booking
            .request =
            finalRequest;


        localStorage.setItem(
            'currentRequestId',
            requestId
        );


        await this.notifyGoDrivers(
            requestId,
            finalRequest
        );


        await ASIYE.ride
            ?.start?.(
                requestId
            );


        ASIYE.ui?.toast?.(
            'Payment confirmed. PIN created and trip shared. Looking for your driver.'
        );


        return finalRequest;
    },


    /* ========================================================
       FIND + NOTIFY GO DRIVERS

       Idle drivers are notified first.

       If there are none, the nearest busy driver is
       reserved for this passenger via queuedTaxiId.

       IMPORTANT:
       taxiId     means the driver has ACCEPTED.
       queuedTaxiId means the driver is BUSY but this
                    passenger is queued behind them.
       ======================================================== */

    async notifyGoDrivers(
        requestId,
        request
    ) {

        const authUser =
            firebase.auth()
                .currentUser;


        if (!authUser) {

            throw new Error(
                'Please sign in again before requesting a driver.'
            );
        }


        const token =
            await authUser
                .getIdToken(
                    true
                );


        let response;

        try {

            response =
                await fetch(
                    'https://us-central1-asiye-80386.cloudfunctions.net/dispatchGoRideRequest',
                    {
                        method:
                            'POST',

                        headers: {
                            'Authorization':
                                `Bearer ${token}`,

                            'Content-Type':
                                'application/json'
                        },

                        body:
                            JSON.stringify({
                                requestId:
                                    requestId
                            })
                    }
                );

        } catch (error) {

            console.error(
                'Go dispatch network failure:',
                error
            );


            throw new Error(
                'Could not reach nearby drivers. Check your connection and try again.'
            );
        }


        const payload =
            await response
                .json()
                .catch(
                    () => ({})
                );


        if (!response.ok) {

            throw new Error(
                payload.error ||
                'Could not send this ride request to nearby drivers.'
            );
        }


        if (
            payload.mode ===
            'broadcast'
        ) {

            console.log(
                `✅ Go request sent to ${payload.drivers || 0} nearby driver(s)`
            );

        } else if (
            payload.mode ===
            'queued'
        ) {

            console.log(
                '⏳ Go request queued behind driver:',
                payload.driverId
            );

        } else {

            console.log(
                '🔎 Go request is searching for an online driver.'
            );
        }


        return payload;
    },


    /* ========================================================
       CANCEL
       ======================================================== */

    async cancelCurrentRide() {

        const requestId =

            ASIYE.state.booking
                .requestId ||

            localStorage.getItem(
                'currentRequestId'
            );


        if (!requestId) {

            return;
        }


        const snapshot =

            await firebase
                .database()
                .ref(
                    `requests/${requestId}`
                )
                .once(
                    'value'
                );


        const request =
            snapshot.val();


        if (!request) {

            this.clearLocalRide();

            return;
        }


        /*
         * CLUB:
         * cancel only this passenger,
         * not the entire pool.
         */

        if (
            request.type === 'club' &&
            request.passengers &&
            ASIYE.state.userId
        ) {

            await firebase
                .database()
                .ref(
                    `requests/${requestId}/passengers/${ASIYE.state.userId}`
                )
                .update({

                    status:
                        'cancelled_by_commuter',

                    cancelledAt:

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP
                });


            /*
             * Recalculate active passenger count.
             */

            const updatedSnapshot =

                await firebase
                    .database()
                    .ref(
                        `requests/${requestId}/passengers`
                    )
                    .once(
                        'value'
                    );


            const passengers =

                updatedSnapshot.val() || {};


            const active =

                Object.values(
                    passengers
                )
                .filter(
                    passenger =>
                        passenger.status !==
                        'cancelled_by_commuter'
                );


            const capacity =

                Number(
                    request.capacity ||
                    request.maxCapacity ||
                    4
                );


            const update = {

                passengerCount:
                    active.length,

                remainingSeats:
                    Math.max(
                        0,
                        capacity -
                        active.length
                    ),

                poolReady:
                    active.length >=
                    capacity
            };


            if (
                active.length <
                capacity
            ) {

                update.status =
                    'pooling';
            }


            await firebase
                .database()
                .ref(
                    `requests/${requestId}`
                )
                .update(
                    update
                );


        } else {

            /*
             * GO
             */

            const cancellationPatch = {

                status:
                    'cancelled_by_commuter',

                cancelledAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            };


            await firebase
                .database()
                .ref(
                    `requests/${requestId}`
                )
                .update(
                    cancellationPatch
                );


            if (
                request.type ===
                'delivery'
            ) {
                await firebase
                    .database()
                    .ref(
                        `delivery_requests/${requestId}`
                    )
                    .update(
                        cancellationPatch
                    )
                    .catch(
                        () => {}
                    );
            }
        }


        /*
         * Notify assigned driver.
         */

        if (
            request.taxiId
        ) {

            await firebase
                .database()
                .ref(
                    `notifications/taxis/${request.taxiId}`
                )
                .push({

                    type:
                        'cancelled_by_commuter',

                    requestId:
                        requestId,

                    commuterId:
                        ASIYE.state.userId,

                    title:
                        'Passenger cancelled',

                    timestamp:

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP
                });
        }


        /*
         * Clear queue reservation if any.
         */

        if (
            request.queuedTaxiId
        ) {

            await firebase
                .database()
                .ref(
                    `taxis/${request.queuedTaxiId}/bookingQueue/${requestId}`
                )
                .remove()
                .catch(
                    () => {}
                );
        }


        await firebase
            .database()
            .ref(
                `commuters/${ASIYE.state.userId}`
            )
            .update({

                currentRequest:
                    null
            });


        this.clearLocalRide();
    },


    clearLocalRide() {

        ASIYE.state.booking
            .requestId =
            null;


        ASIYE.state.booking
            .request =
            null;


        localStorage.removeItem(
            'currentRequestId'
        );
    },


    async requirePassengerPin() {

        return await new Promise(
            (resolve, reject) => {

                const dialog =
                    document.createElement(
                        'dialog'
                    );

                dialog.setAttribute(
                    'aria-label',
                    'Create trip PIN'
                );

                dialog.style.cssText =
                    'border:0;border-radius:22px;padding:0;max-width:360px;width:calc(100% - 32px);box-shadow:0 22px 60px rgba(0,0,0,.28);';

                dialog.innerHTML = `
                    <form method="dialog" style="padding:22px;font-family:inherit;">
                        <div style="font-size:11px;font-weight:900;letter-spacing:.12em;color:#777;">TRIP SAFETY</div>
                        <h2 style="margin:7px 0 8px;font-size:24px;">Create your 4-digit PIN</h2>
                        <p style="margin:0 0 16px;color:#666;line-height:1.5;">
                            You will give this PIN to your verified driver only when you are ready to start the trip.
                        </p>
                        <input
                            data-trip-pin
                            type="password"
                            inputmode="numeric"
                            autocomplete="off"
                            maxlength="4"
                            pattern="[0-9]{4}"
                            placeholder="••••"
                            required
                            style="width:100%;box-sizing:border-box;text-align:center;font-size:28px;letter-spacing:.55em;padding:14px;border:1px solid #ddd;border-radius:14px;"
                        >
                        <p data-trip-pin-error style="min-height:18px;margin:7px 0;color:#b42318;font-size:12px;"></p>
                        <button type="submit" value="confirm" style="width:100%;border:0;border-radius:14px;padding:14px;background:#111;color:#fff;font-weight:900;">
                            Continue
                        </button>
                        <button type="button" data-trip-pin-cancel style="width:100%;border:0;background:transparent;padding:13px;font-weight:800;">
                            Cancel booking
                        </button>
                    </form>
                `;

                document.body.appendChild(
                    dialog
                );

                const input =
                    dialog.querySelector(
                        '[data-trip-pin]'
                    );

                const error =
                    dialog.querySelector(
                        '[data-trip-pin-error]'
                    );

                const cleanup =
                    () => {
                        dialog.close?.();
                        dialog.remove();
                    };

                dialog.querySelector(
                    '[data-trip-pin-cancel]'
                ).onclick =
                    () => {
                        cleanup();
                        reject(
                            new Error(
                                'Booking cancelled. A 4-digit trip PIN is required.'
                            )
                        );
                    };

                dialog.addEventListener(
                    'cancel',
                    event => {
                        event.preventDefault();
                        cleanup();
                        reject(
                            new Error(
                                'Booking cancelled. A 4-digit trip PIN is required.'
                            )
                        );
                    }
                );

                dialog.querySelector(
                    'form'
                ).onsubmit =
                    event => {
                        event.preventDefault();

                        const pin =
                            String(
                                input.value ||
                                ''
                            )
                            .replace(
                                /\D/g,
                                ''
                            );

                        if (
                            !/^\d{4}$/.test(
                                pin
                            )
                        ) {
                            error.textContent =
                                'Enter exactly four numbers.';
                            input.focus();
                            return;
                        }

                        cleanup();
                        resolve(
                            pin
                        );
                    };

                dialog.showModal();
                setTimeout(
                    () => input.focus(),
                    80
                );
            }
        );
    },


    async requireTripShare({
        requestId = '',
        liveTrackingUrl = '',
        pickupPin,
        pickupAddress,
        destination,
        service = 'Asiye trip'
    }) {

        if (!window.AsiyeTripShare) {
            throw new Error(
                'Trip sharing is required before booking. Update the Asiye app and try again.'
            );
        }

        const trackingUrl =
            liveTrackingUrl ||
            this.liveTrackingUrl(requestId);

        const text =
            `I'm booking ${service} with Asiye. Pickup: ${pickupAddress || 'Current location'}. Destination: ${destination || 'Not available'}. Safety PIN: ${pickupPin}. Follow my trip live: ${trackingUrl}. Please keep these trip details until I arrive safely.`;

        ASIYE.ui?.toast?.(
            'Share this trip with a loved one to continue.'
        );

        await AsiyeTripShare.require(
            text
        );

        return true;
    },


    async createLiveShareUrl(requestId) {

        const authUser =
            firebase.auth().currentUser;


        if (!authUser) {

            throw new Error(
                'Please sign in again before sharing this trip.'
            );
        }


        const token =
            await authUser.getIdToken(true);


        const response =
            await fetch(
                'https://us-central1-asiye-80386.cloudfunctions.net/createTripShareToken',
                {
                    method:
                        'POST',

                    headers: {
                        'Authorization':
                            `Bearer ${token}`,

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            requestId:
                                requestId
                        })
                }
            );


        const payload =
            await response
                .json()
                .catch(
                    () => ({})
                );


        if (
            !response.ok ||
            !payload.liveTrackingUrl
        ) {

            throw new Error(
                payload.error ||
                'Unable to create a secure live tracking link.'
            );
        }


        return payload.liveTrackingUrl;
    },


    liveTrackingUrl(requestId) {
        const id = String(requestId || '').trim();
        return id
            ? `https://asiye-80386.web.app/track.html?trip=${encodeURIComponent(id)}`
            : 'https://asiye-80386.web.app/track.html';
    },


    generatePin() {

        return String(

            Math.floor(

                1000 +

                Math.random() *
                9000
            )
        );
    },


    distanceKm(
        lat1,
        lng1,
        lat2,
        lng2
    ) {

        const R =
            6371;


        const rad =
            value =>
                value *
                Math.PI /
                180;


        const dLat =
            rad(
                lat2 - lat1
            );


        const dLng =
            rad(
                lng2 - lng1
            );


        const a =

            Math.sin(
                dLat / 2
            ) ** 2 +

            Math.cos(
                rad(lat1)
            ) *

            Math.cos(
                rad(lat2)
            ) *

            Math.sin(
                dLng / 2
            ) ** 2;


        return (

            R *
            2 *
            Math.atan2(

                Math.sqrt(a),

                Math.sqrt(1 - a)
            )
        );
    }

};
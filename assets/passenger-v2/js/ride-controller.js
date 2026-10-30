/* ============================================================
   ASIYE PASSENGER V2
   RIDE CONTROLLER
   ============================================================ */

window.ASIYE =
    window.ASIYE || {};


ASIYE.ride = {

    requestId:
        null,

    requestRef:
        null,

    requestListener:
        null,

    driverRef:
        null,

    driverListener:
        null,

    currentDriverId:
        null,

    lastApproachRouteAt:
        0,

    lastApproachRoutePoint:
        null,

    driverSearchRetryTimer:
        null,

    driverSearchRetryCount:
        0,

    driverSearchFastRetries:
        6,

    isActiveBooking(request, passengerId = ASIYE.state.userId) {
        const ended = value => {
            const status = String(value || '').trim().toLowerCase();
            return ['completed','expired','rejected'].includes(status) || /^cancelled(?:_|$)|^canceled(?:_|$)/.test(status);
        };
        const ids = [passengerId, window.firebase?.auth?.()?.currentUser?.uid].filter(Boolean).map(String);
        const memberId = ids.find(id => request?.passengers?.[id]);
        return Boolean(request && ids.length &&
            (ids.includes(String(request.commuterId || '')) || memberId) &&
            !ended(request.status) &&
            !(request.type === 'club' && ended(request.passengers?.[memberId]?.status)));
    },

    async refreshLiveTripRoute(driverLatitude, driverLongitude) {
        const now = Date.now();
        const previous = this.lastApproachRoutePoint;
        const movedEnough = !previous ||
            Math.abs(previous[0] - driverLatitude) > 0.0008 ||
            Math.abs(previous[1] - driverLongitude) > 0.0008;

        if (!movedEnough && now - this.lastApproachRouteAt < 12000) return;

        const request = ASIYE.state.booking?.request || {};
        const status = String(request.status || '');
        const onboard = ['passenger_onboard','all_onboard','in_transit'].includes(status);
        const passenger = this.getPassengerData(request) || {};

        const targetLat = Number(onboard
            ? (request.destinationLatitude ?? ASIYE.state.destination?.latitude)
            : (passenger.pickupLat ?? passenger.pickupLatitude ?? request.commuterLocation?.latitude ?? request.pickupLatitude ?? ASIYE.state.booking?.pickup?.latitude));
        const targetLng = Number(onboard
            ? (request.destinationLongitude ?? ASIYE.state.destination?.longitude)
            : (passenger.pickupLng ?? passenger.pickupLongitude ?? request.commuterLocation?.longitude ?? request.pickupLongitude ?? ASIYE.state.booking?.pickup?.longitude));

        if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return;

        const token = window.ASIYE_CONFIG?.mapboxToken;
        if (!token) return;

        this.lastApproachRouteAt = now;
        this.lastApproachRoutePoint = [driverLatitude, driverLongitude];

        try {
            const url =
                'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/' +
                `${driverLongitude},${driverLatitude};${targetLng},${targetLat}` +
                '?geometries=geojson&overview=full&steps=false&alternatives=false' +
                `&access_token=${encodeURIComponent(token)}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Directions failed: ${response.status}`);
            const data = await response.json();
            const geometry = data.routes?.[0]?.geometry;
            if (!geometry) return;

            ASIYE.map?.drawRoute?.(geometry);
            ASIYE.map?.fitActiveTrip?.(false);
        } catch (error) {
            console.warn('Live driver route update failed:', error);
        }
    },


    /* ========================================================
       START

       Begins the single unified listener for this ride.
       All subsequent state transitions flow through
       handleRequest().
       ======================================================== */

    hydrateRequest(request, requestId) {
        const passenger = this.getPassengerData(request) || {};
        const coords = request.destinationCoords || {};
        const pickup = request.commuterLocation || request.pickupLocation || {};
        const point = (lat, lng) => ({latitude: lat == null ? null : Number(lat), longitude: lng == null ? null : Number(lng)});
        ASIYE.state.destination = {
            name: passenger.destinationName || passenger.destination || request.destinationName || request.destination,
            address: passenger.destination || request.destination || request.destinationName,
            ...point(passenger.destinationLat ?? request.destinationLatitude ?? coords.latitude,
                     passenger.destinationLng ?? request.destinationLongitude ?? coords.longitude)
        };
        ASIYE.state.booking.pickup = {
            address: passenger.pickupAddress || request.pickupAddress,
            ...point(passenger.pickupLat ?? passenger.pickupLatitude ?? pickup.latitude,
                     passenger.pickupLng ?? passenger.pickupLongitude ?? pickup.longitude)
        };
        Object.assign(ASIYE.state.booking, {requestId, request, rideType: request.rideType || request.type,
            paymentMethod: passenger.paymentMethod || request.paymentMethod || 'cash',
            fare: Number(passenger.price ?? request.agreedFare ?? request.finalAmount ?? request.calculatedPrice ?? 0)});
        ASIYE.state.route = {distanceKm: Number(request.routeDistanceKm || 0),
            durationMinutes: Number(request.routeDurationMinutes || 0), geometry: request.routeGeometry || null};
        if (request.type === 'club') Object.assign(ASIYE.state.booking.club || (ASIYE.state.booking.club = {}), {
            poolId: requestId, mode: request.clubMode, capacity: request.requiredPassengers || request.capacity,
            confirmedPassengers: request.passengerCount, remainingSeats: request.remainingSeats,
            pricePerPassenger: passenger.price, poolReady: request.poolReady,
            departureTime: passenger.departureTime || request.departureTime,
            workWaitExpiresAt: request.workWaitExpiresAt
        });
        ASIYE.state.ui.page = 'trip';
        ASIYE.state.ui.sheet = 'trip';
    },

    async restoreTripRoute(generation) {
        const pickup = ASIYE.state.booking.pickup;
        const destination = ASIYE.state.destination;
        const token = window.ASIYE_CONFIG?.mapboxToken;
        if (!token || !pickup || !destination ||
            [pickup.latitude, pickup.longitude, destination.latitude, destination.longitude].some(value => value == null || !Number.isFinite(value))) return;
        try {
            const response = await fetch('https://api.mapbox.com/directions/v5/mapbox/driving/' +
                `${pickup.longitude},${pickup.latitude};${destination.longitude},${destination.latitude}` +
                `?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`);
            if (!response.ok) return;
            const geometry = (await response.json()).routes?.[0]?.geometry;
            if (!geometry || generation !== this._generation || this.lastApproachRouteAt) return;
            ASIYE.state.route.geometry = geometry;
            ASIYE.map?.drawRoute?.(geometry);
            ASIYE.map?.fitActiveTrip?.();
        } catch (error) { console.warn('Saved trip route could not be drawn:', error); }
    },

    async start(requestId, restoredRequest = null) {
        if (!requestId) throw new Error('Missing request ID.');
        this.stop();
        const generation = this._generation;
        this.requestId = requestId;
        const ref = firebase.database().ref(`requests/${requestId}`);
        const request = restoredRequest || (await ref.once('value')).val();
        if (generation !== this._generation) return false;
        if (!request) throw new Error('Active booking could not be loaded.');
        request.requestId = requestId;
        this.hydrateRequest(request, requestId);
        localStorage.setItem('currentRequestId', requestId);
        // Paint the saved state before resolving restore; a delayed Firebase
        // listener must never leave Home visible beneath a restoration toast.
        this.handleRequest(request);
        this.requestRef = ref;
        this.requestListener = ref.on('value', snapshot => {
            if (generation !== this._generation) return;
            const live = snapshot.val();
            if (!live) return;
            live.requestId = requestId;
            this.hydrateRequest(live, requestId);
            window.AsiyeTripChat?.watchTrip?.(live, requestId);
            this.handleRequest(live);
        }, error => ASIYE.ui?.toast?.(error.message || 'Unable to refresh your booking.'));
        if (request.routeGeometry) ASIYE.map?.drawRoute?.(request.routeGeometry);
        else void this.restoreTripRoute(generation);
        ASIYE.map?.resize?.();
        ASIYE.map?.fitActiveTrip?.();
        return true;
    },

    /* ========================================================
       STOP
       ======================================================== */

    stop() {
        this._generation = (this._generation || 0) + 1;

        if (
            this.requestRef &&
            this.requestListener
        ) {

            this.requestRef.off(
                'value',
                this.requestListener
            );
        }


        this.requestRef =
            null;


        this.requestListener =
            null;


        if (
            this.driverSearchRetryTimer
        ) {
            clearTimeout(
                this.driverSearchRetryTimer
            );

            this.driverSearchRetryTimer =
                null;
        }


        this.driverSearchRetryCount =
            0;


        this.stopDriver();
    },


    /* ========================================================
       HANDLE REQUEST
       ======================================================== */

    handleRequest(request) {

        void ASIYE.payments?.handleTripState?.(request)?.catch?.(error =>
            ASIYE.ui?.toast?.(error.message || 'Unable to continue payment.'));

        let status =
            request.status ||
            'pending';


        /*
         * Club passengers have individual pickup states.
         *
         * The global Club request can be collecting passengers,
         * while only one passenger is actually being collected.
         */

        if (
            request.type === 'club' &&
            request.passengers &&
            ASIYE.state.userId &&
            request.passengers[
                ASIYE.state.userId
            ]
        ) {

            const passenger =

                request.passengers[
                    ASIYE.state.userId
                ];


            const personalStatus =
                passenger.status ||
                'waiting_pool';


            if (
                [
                    'driver_on_way',
                    'arrived',
                    'passenger_onboard',
                    'in_transit',
                    'completed',
                    'cancelled_by_commuter'
                ].includes(
                    personalStatus
                )
            ) {

                status =
                    personalStatus;

            } else if (
                request.status ===
                    'collecting_passengers'
            ) {

                status =
                    'club_waiting_pickup';
            }
        }


        const isNegotiatedGo =
            request.type !==
                'club' &&
            request.type !==
                'delivery' &&
            String(
                request.rideType ||
                'go'
            ) ===
                'go' &&
            request.negotiationEnabled ===
                true;


        if (
            isNegotiatedGo &&
            request.fareStatus ===
                'driver_counter' &&
            !request.taxiId
        ) {

            this.renderGoFareCounter(
                request
            );

            return;
        }


        switch (status) {


            case 'pending':

            case 'searching':

                this.renderGoSearching(
                    request
                );

                break;


            case 'driver_busy':

                this.renderDriverBusy(
                    request
                );

                if (
                    request.queuedTaxiId
                ) {

                    this.listenDriver(
                        request.queuedTaxiId
                    );
                }

                break;


            case 'pooling':

            case 'waiting_members':

            case 'work_negotiation':

                ASIYE.ui
                    .renderClubWaiting(
                        request
                    );

                break;


            case 'payment_required':

                if (
                    request.type ===
                        'club'
                ) {
                    ASIYE.ui
                        .renderClubWaiting(
                            request
                        );
                } else {
                    this.renderPaymentRequired(
                        request
                    );
                }

                break;


            case 'pool_ready':

                /*
                 * Keep the same live Work progress screen when the passenger
                 * group becomes ready. It now shows that full driver details
                 * have been released and that Asiye is waiting for acceptance.
                 */
                ASIYE.ui
                    .renderClubWaiting(
                        request
                    );

                break;


            case 'driver_waiting':

                /*
                 * Club has a driver but is not
                 * yet full. Show the pool-building
                 * view so the passenger keeps
                 * seeing seat progress.
                 */

                ASIYE.ui
                    .renderClubWaiting(
                        request
                    );

                break;


            case 'accepted':

            case 'driver_waiting_driver':

                this.renderDriverAssigned(
                    request
                );
                this.listenDriver(request.taxiId);

                break;


            case 'driver_on_way':

                this.renderDriverOnWay(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'club_waiting_pickup':

                this.renderClubWaitingPickup(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'collecting_passengers':

                /*
                 * Go passengers — treat the whole
                 * trip as "driver on way".
                 */

                this.renderDriverOnWay(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'arrived':

                this.renderArrived(
                    request
                );

                break;


            case 'passenger_onboard':

            case 'all_onboard':

            case 'in_transit':

                this.renderInTransit(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'completed':

                this.renderCompleted(
                    request
                );

                this.stopDriver();

                break;


            case 'cancelled_by_driver':

            case 'cancelled_by_admin':

            case 'rejected':

                this.renderCancelled(
                    request
                );

                break;


            case 'cancelled_by_commuter':

                this.stop();

                ASIYE.booking
                    ?.clearLocalRide?.();

                ASIYE.map
                    ?.clearTrip?.();

                ASIYE.ui
                    .renderHome();

                break;
        }
        if (!['completed', 'expired', 'rejected'].includes(status) && !String(status).startsWith('cancelled'))
            this.renderTripSummary(request, status);
    },

    renderTripSummary(request, status) {
        const container = document.getElementById('sheetContent');
        if (!container) return;
        const passenger = this.getPassengerData(request) || {};
        const escape = value => ASIYE.ui.escape(String(value || ''));
        container.querySelector('[data-trip-summary]')?.remove();
        const summary = document.createElement('section');
        summary.dataset.tripSummary = 'true';
        const arrival = Boolean(passenger.arrivedAt || request.arrivedAt || request.tripStartedAt ||
            ['arrived', 'passenger_onboard', 'all_onboard', 'in_transit'].includes(status));
        const pickup = escape(passenger.pickupAddress || request.pickupAddress || 'Pickup details pending');
        const destination = escape(passenger.destination || request.destination || request.destinationName || 'Destination details pending');
        const fare = Number(ASIYE.state.booking.fare || 0).toFixed(2);
        const method = String(ASIYE.state.booking.paymentMethod || request.paymentMethod || 'cash').toLowerCase();
        const modern = Boolean(container.querySelector('.ride-match'));
        if (modern) {
            summary.className = 'ride-match-summary';
            summary.innerHTML = `
                <div class="ride-match-route" aria-label="Your route">
                    <div class="ride-match-stop"><span class="ride-match-location" aria-hidden="true"></span><div><span>Pickup</span><p>${pickup}</p></div></div>
                    <div class="ride-match-stop"><span class="ride-match-location ride-match-location--destination" aria-hidden="true"></span><div><span>Destination</span><p>${destination}</p></div></div>
                </div>
                <div class="ride-match-fare"><div><span>${request.negotiationEnabled && request.fareStatus !== 'agreed' ? 'Your offer' : 'Agreed fare'}</span><small>${method === 'cash' ? 'Cash · pay after your trip' : escape(method === 'card' ? 'Card payment' : method)}</small></div><strong>R${fare}</strong></div>
                ${arrival ? '' : '<button type="button" class="ride-match-cancel" data-trip-cancel>Cancel booking</button>'}`;
        } else {
            summary.innerHTML = `<p><strong>Pickup:</strong> ${pickup}<br>
                <strong>Destination:</strong> ${destination}<br>
                <strong>Fare:</strong> R${fare} · ${escape(method)}</p>
                ${arrival ? '' : '<button type="button" class="secondary-button" data-trip-cancel>Cancel booking</button>'}`;
        }
        container.append(summary);
        summary.querySelector('[data-trip-cancel]')?.addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try { await ASIYE.booking.cancelCurrentRide(); }
            catch (error) { ASIYE.ui.toast(error.message || 'Cancellation failed.'); event.currentTarget.disabled = false; }
        });
    },

    renderPaymentRequired(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) return;


        const method =
            String(
                request.paymentMethod ||
                'card'
            )
                .toLowerCase();


        const negotiated =
            request.negotiationEnabled ===
                true &&
            request.fareStatus ===
                'agreed' &&
            Boolean(
                request.taxiId
            );


        const agreedFare =
            Number(
                request.agreedFare ||
                request.finalAmount ||
                0
            );


        const driverName =
            request.driverName ||
            'Your driver';


        const paymentCopy =
            method ===
                'card'
                ? 'Complete the Paystack payment for the agreed fare. Your driver is reserved while you pay.'
                : method ===
                    'wallet'
                    ? 'Asiye is reserving the agreed fare from your Wallet. Your driver stays reserved.'
                    : 'Your fare is agreed. Pay cash to the driver after drop-off. Your driver can head to pickup now.';


        container.innerHTML = `
            <div class="asiye-row">
                <div class="asiye-status-icon asiye-search-icon">
                    <i class="fas fa-${method === 'card' ? 'credit-card' : method === 'wallet' ? 'wallet' : 'money-bill-wave'}"></i>
                </div>

                <div>
                    <div class="home-kicker">
                        ${negotiated ? 'Fare agreed' : 'Payment'}
                    </div>

                    <h2 class="sheet-page-title">
                        ${
                            negotiated
                                ? `R${agreedFare.toFixed(0)} · Driver reserved`
                                : 'Complete payment'
                        }
                    </h2>

                    <p style="margin:6px 0 0;color:#777;font-size:12px;line-height:1.45;">
                        ${
                            negotiated
                                ? ASIYE.ui.escape(paymentCopy)
                                : method === 'card'
                                    ? 'Complete the Paystack card payment before the ride can continue.'
                                    : 'Your selected payment method must be ready before the ride can continue.'
                        }
                    </p>
                </div>
            </div>

            ${
                negotiated
                    ? `
                    <div class="asiye-request-activity">
                        <div class="asiye-request-step done">
                            <span><i class="fas fa-check"></i></span>
                            <div>
                                <strong>Fare agreed</strong>
                                <small>${ASIYE.ui.escape(driverName)} is reserved at R${agreedFare.toFixed(0)}.</small>
                            </div>
                        </div>

                        <div class="asiye-request-step active">
                            <span><i class="fas fa-${method === 'card' ? 'credit-card' : method === 'wallet' ? 'wallet' : 'shield-halved'}"></i></span>
                            <div>
                                <strong>
                                    ${method === 'card' ? 'Complete Paystack payment' : method === 'wallet' ? 'Reserve Wallet fare' : 'Cash due after drop-off'}
                                </strong>
                                <small>
                                    ${method === 'cash' ? 'No upfront cash payment is required. Your PIN is checked at pickup.' : 'Asiye creates your pickup PIN after payment is ready.'} Share the trip after arrival.
                                </small>
                            </div>
                        </div>

                        <div class="asiye-request-step">
                            <span><i class="fas fa-car-side"></i></span>
                            <div>
                                <strong>Driver starts pickup</strong>
                                <small>${method === 'cash' ? 'Your driver can collect you now. Cash is paid after drop-off.' : 'Unlocked when payment is ready.'} The PIN is checked at pickup.</small>
                            </div>
                        </div>
                    </div>
                    `
                    : ''
            }
            ${method === 'card' ? `<div class="asiye-card-payment-status" data-card-payment-state data-request-id="${ASIYE.ui.escape(request.requestId)}" role="status" aria-live="polite">
                <p data-card-payment-message></p>
                <button type="button" class="asiye-primary-btn" data-card-payment-retry hidden>Try card payment again</button>
                <button type="button" class="asiye-primary-btn" data-card-payment-check hidden>I have paid · check confirmation</button>
            </div>` : ''}
        `;

        ASIYE.payments?.paintCardPaymentState?.();

        if (
            method === 'card' && request.taxiId &&
            ASIYE.payments?.cardFailure?.requestId !== request.requestId &&
            !['held', 'captured'].includes(request.paymentStatus) &&
            ASIYE.payments?.pendingCard?.()?.requestId !== request.requestId
        ) {
            ASIYE.payments
                ?.prepare?.(
                    request.requestId
                )
                .catch(
                    error =>
                        ASIYE.ui?.toast?.(
                            error.message ||
                            'Unable to reopen card payment.'
                        )
                );
        }
    },


    /* ========================================================
       GO SEARCHING
       ======================================================== */

    isGoDriverSearchActive(request) {
        return Boolean(request && request.type !== 'club' && !request.taxiId &&
            request.fareStatus !== 'driver_counter' &&
            ['pending', 'searching'].includes(request.status));
    },

    scheduleGoDriverSearchRetry(request) {
        if (!this.isGoDriverSearchActive(request)) {
            if (this.driverSearchRetryTimer) clearTimeout(this.driverSearchRetryTimer);
            this.driverSearchRetryTimer = null;
            return;
        }
        if (this.driverSearchRetryTimer) return;
        const requestId = request.requestId || this.requestId;
        const generation = this._generation;
        // Keep an active offer searchable when a driver comes online later.
        // After six quick checks, slow down rather than silently stopping.
        const delay = Number(request.driverFoundCount || 0) > 0 ||
            this.driverSearchRetryCount >= this.driverSearchFastRetries ? 20000 : 8000;
        this.driverSearchRetryTimer = setTimeout(async () => {
            this.driverSearchRetryTimer = null;
            if (this.requestId !== requestId || this._generation !== generation) return;
            const current = ASIYE.state.booking?.request || request;
            if (!this.isGoDriverSearchActive(current)) return;
            this.driverSearchRetryCount += 1;
            try {
                await ASIYE.booking?.notifyGoDrivers?.(requestId, current);
            } catch (error) {
                console.warn('Go driver search retry failed:', error);
            } finally {
                if (this.requestId === requestId && this._generation === generation) {
                    this.scheduleGoDriverSearchRetry(ASIYE.state.booking?.request || current);
                }
            }
        }, delay);
    },


    renderGoFareCounter(
        request
    ) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) {
            return;
        }


        if (
            this.driverSearchRetryTimer
        ) {
            clearTimeout(
                this.driverSearchRetryTimer
            );

            this.driverSearchRetryTimer =
                null;
        }


        const passengerOffer =
            Number(
                request.passengerOffer ||
                request.finalAmount ||
                0
            );


        const counterFare =
            Number(
                request.driverCounterFare ||
                passengerOffer
            );


        const maximum =
            Number(
                request.maximumFareOffer ||
                counterFare
            );


        const driverName =
            request.negotiationDriverName ||
            'A nearby driver';


        container.innerHTML = `
            <div class="asiye-row">
                <div class="asiye-status-icon">
                    <i class="fas fa-comments-dollar"></i>
                </div>

                <div>
                    <div class="home-kicker">
                        Asiye Go negotiation
                    </div>

                    <h2 class="sheet-page-title">
                        Driver counter: R${counterFare.toFixed(0)}
                    </h2>

                    <div class="home-greeting">
                        ${ASIYE.ui.escape(driverName)}
                        has sent you a counter-offer.
                        No payment has been taken yet.
                    </div>
                </div>
            </div>

            <div class="go-counter-comparison">
                <div>
                    <span>Your offer</span>
                    <strong>
                        R${passengerOffer.toFixed(0)}
                    </strong>
                </div>

                <div>
                    <span>Driver counter</span>
                    <strong>
                        R${counterFare.toFixed(0)}
                    </strong>
                </div>

                <div>
                    <span>Maximum allowed</span>
                    <strong>
                        R${maximum.toFixed(0)}
                    </strong>
                </div>
            </div>

            <p class="go-counter-note">
                The counter is still below the Asiye Go ceiling.
                Accept it to lock this driver and continue to payment,
                or keep your original offer and Asiye will continue searching.
            </p>

            <button
                id="acceptGoFareCounter"
                class="primary-button"
            >
                Accept R${counterFare.toFixed(0)} &amp; book ride
            </button>

            <button
                id="keepGoFareOffer"
                class="secondary-button"
                style="margin-top:9px;"
            >
                Keep my R${passengerOffer.toFixed(0)} offer
            </button>

            <button id="cancelGoFareRequest" class="secondary-button" style="margin-top:9px;">
                Cancel request
            </button>
        `;


        document
            .getElementById(
                'acceptGoFareCounter'
            )
            ?.addEventListener(
                'click',
                async event => {

                    const button =
                        event.currentTarget;


                    button.disabled =
                        true;

                    button.textContent =
                        'Locking fare...';


                    try {

                        await ASIYE.goNegotiation
                            .acceptDriverCounter(
                                request.requestId ||
                                this.requestId,
                                request
                            );


                        ASIYE.ui
                            ?.toast?.(
                                `Fare R${counterFare.toFixed(0)} agreed. Preparing payment.`
                            );


                    } catch (error) {

                        button.disabled =
                            false;

                        button.textContent =
                            `Accept R${counterFare.toFixed(0)} & book ride`;


                        ASIYE.ui
                            ?.toast?.(
                                error.message ||
                                'Could not accept this driver counter.'
                            );
                    }
                }
            );


        document
            .getElementById(
                'keepGoFareOffer'
            )
            ?.addEventListener(
                'click',
                async event => {

                    const button =
                        event.currentTarget;


                    button.disabled =
                        true;

                    button.textContent =
                        'Continuing search...';


                    try {

                        await ASIYE.goNegotiation
                            .keepPassengerOffer(
                                request.requestId ||
                                this.requestId,
                                request
                            );


                        const refreshed = {
                            ...request,
                            fareStatus:
                                'passenger_offer',
                            driverCounterFare:
                                null,
                            negotiationDriverId:
                                null,
                            status:
                                'searching'
                        };


                        await ASIYE.booking
                            ?.notifyGoDrivers?.(
                                request.requestId ||
                                this.requestId,
                                refreshed
                            );


                        ASIYE.ui
                            ?.toast?.(
                                `Keeping your R${passengerOffer.toFixed(0)} offer. Searching for another driver.`
                            );


                    } catch (error) {

                        button.disabled =
                            false;

                        button.textContent =
                            `Keep my R${passengerOffer.toFixed(0)} offer`;


                        ASIYE.ui
                            ?.toast?.(
                                error.message ||
                                'Could not continue the fare search.'
                            );
                    }
                }
            );

        document.getElementById('cancelGoFareRequest')?.addEventListener('click', () => {
            ASIYE.booking?.cancelCurrentRide?.();
        });
    },


    renderGoSearching(request) {
        const container = document.getElementById('sheetContent');
        if (!container) return;
        const foundCount = Number(request.driverFoundCount || request.driverDispatchCount || 0);
        const driverFound = foundCount > 0 || String(request.driverSearchStatus || '').startsWith('driver_found');
        const distanceKm = Number(request.nearestDriverDistanceKm || 0);
        const escape = value => ASIYE.ui.escape(String(value || ''));
        const fareDecision = request.lastGoFareDecision;
        const driverDeclined = fareDecision?.action === 'declined' &&
            Number(fareDecision.offerRound) === Number(request.passengerOfferRound || 1);
        const offer = Number(request.passengerOffer || request.finalAmount || 0);
        const driverDetail = distanceKm > 0
            ? `Nearest available driver is about ${distanceKm.toFixed(1)} km from your pickup.`
            : foundCount > 1 ? `${foundCount} nearby drivers have received your request.`
                : 'A nearby driver has received your request.';
        this.scheduleGoDriverSearchRetry(request);
        container.innerHTML = `
            <section class="ride-match go-driver-search ${driverFound ? 'go-driver-search--found' : ''}">
                <div class="go-search-hero">
                    <span class="go-search-service">ASIYE GO <span>PRIVATE RIDE</span></span>
                    <div class="go-search-radar" aria-hidden="true">
                        <span class="go-search-ring"></span><span class="go-search-ring"></span><span class="go-search-ring"></span>
                        <span class="go-search-car">${driverFound
                            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6"/></svg>'
                            : '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m7 13 3-6h12l3 6 2 3v8H5v-8l2-3Z"/><path d="M7 13h18M9 24v3m14-3v3"/><path d="M8 18h5m6 0h5"/></svg>'}</span>
                    </div>
                    <div role="status" aria-live="polite" aria-atomic="true">
                        <h2 class="go-search-title">${driverFound ? 'Driver found' : 'Searching for a nearby driver'}</h2>
                        <p class="go-search-copy">${driverFound
                            ? 'Waiting for a driver to accept your fare or make a counter-offer.'
                            : 'Looking for an available driver near your pickup. Your request stays open while we search.'}</p>
                    </div>
                    <div class="go-search-live"><span></span>${driverFound ? 'Waiting for a response' : 'Searching nearby'}<span class="go-search-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
                    ${driverFound ? `<p class="go-search-driver-detail">${escape(driverDetail)}</p>` : ''}
                </div>
                ${driverDeclined ? `<p class="go-search-note" role="status">${escape(fareDecision.driverName || 'A driver')} declined your R${offer.toFixed(0)} offer. We are checking other drivers.</p>` : ''}
                <ol class="go-search-steps" aria-label="Booking progress">
                    <li class="done"><span class="go-search-step-icon">✓</span><div><strong>Request created</strong><small>Your pickup and destination are saved.</small></div></li>
                    <li class="${driverFound ? 'done' : 'active'}"><span class="go-search-step-icon">${driverFound ? '✓' : '2'}</span><div><strong>${driverFound ? 'Driver found' : 'Finding your driver'}</strong><small>${driverFound ? escape(driverDetail) : 'Checking available drivers around you.'}</small></div></li>
                    <li class="${driverFound ? 'active' : ''}"><span class="go-search-step-icon">3</span><div><strong>Driver response</strong><small>${driverFound ? 'Your driver can accept, decline or counter.' : 'We will let you know when a driver responds.'}</small></div></li>
                </ol>
                ${request.negotiationEnabled ? '<p class="go-search-note">Your offer goes directly to nearby drivers. No payment is taken until a fare is agreed.</p>' : ''}
            </section>`;
    },


    /* ========================================================
       DRIVER BUSY

       Passenger is queued behind a driver who is still
       finishing another trip.
       ======================================================== */

    renderDriverBusy(
        request
    ) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) {

            return;
        }


        container.innerHTML = `

            <div class="asiye-row">

                <div
                    class="
                        asiye-status-icon
                        asiye-search-icon
                    "
                >

                    <i class="fas fa-car-side"></i>

                </div>


                <div>

                    <div class="home-kicker">

                        Asiye Go

                    </div>


                    <h2 class="sheet-page-title">

                        Your driver is completing another ride

                    </h2>


                    <div class="home-greeting">

                        You're in the queue.
                        The driver will receive your booking
                        as soon as the current trip is completed.

                    </div>

                </div>

            </div>


            <div class="asiye-search-progress">

                <span></span>

            </div>


            <div class="asiye-route-summary">

                <div
                    style="
                        font-size:9px;
                        color:#888;
                        font-weight:800;
                        text-transform:uppercase;
                    "
                >

                    Your destination

                </div>


                <strong
                    style="
                        display:block;
                        margin-top:4px;
                        font-size:12px;
                    "
                >

                    ${ASIYE.ui.escape(
                        request.destination ||
                        request.destinationName ||
                        'Destination'
                    )}

                </strong>

            </div>


            <div
                style="
                    margin-top:12px;
                    padding:13px;
                    border-radius:15px;
                    background:#f5f5f5;
                "
            >

                <div
                    style="
                        font-size:9px;
                        color:#888;
                        font-weight:800;
                        text-transform:uppercase;
                    "
                >

                    Booking status

                </div>


                <div
                    style="
                        margin-top:4px;
                        font-size:12px;
                        font-weight:900;
                        color:#111;
                    "
                >

                    <i
                        class="fas fa-clock"
                        style="margin-right:5px;"
                    ></i>

                    Driver finishing current trip

                </div>

            </div>


            <button
                id="cancelQueuedRide"
                class="secondary-button"
                style="margin-top:12px;"
            >

                Cancel booking

            </button>

        `;


        document
            .getElementById(
                'cancelQueuedRide'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.booking
                        ?.cancelCurrentRide?.();
                }
            );
    },


    /* ========================================================
       POOL READY
       ======================================================== */

    renderPoolReady(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) return;


        container.innerHTML = `

            <div class="asiye-row">

                <div class="asiye-status-icon">
                    <i class="fas fa-users"></i>
                </div>

                <div>

                    <div class="home-kicker">
                        Asiye Club
                    </div>

                    <h2 class="sheet-page-title">
                        Your Club is ready
                    </h2>

                    <div class="home-greeting">
                        All ${
                            request.capacity ||
                            request.maxCapacity
                        } passengers are confirmed.
                        Finding your driver.
                    </div>

                </div>

            </div>

            <div class="asiye-search-progress">
                <span></span>
            </div>
        `;
    },


    /* ========================================================
       CLUB WAITING PICKUP
       ======================================================== */

    renderClubWaitingPickup(
        request
    ) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) {

            return;
        }


        const capacity =
            Number(
                request.effectiveRequiredPassengers ||
                request.requiredPassengers ||
                request.minimumPassengers ||
                request.capacity ||
                request.maxCapacity ||
                4
            );


        const onboardCount =

            Object.values(
                request.passengers ||
                {}
            )
            .filter(
                member =>

                    [
                        'passenger_onboard',
                        'in_transit',
                        'completed'
                    ]
                    .includes(
                        member.status
                    )
            )
            .length;


        container.innerHTML = `

            <div class="home-kicker">
                Asiye Club
            </div>


            <h2 class="home-title">
                Collection has started
            </h2>


            <div class="home-greeting">

                Your driver is collecting Club members.
                We'll notify you when you're next.

            </div>


            <div class="club-summary-grid">

                <div>

                    <span>
                        Collected
                    </span>

                    <strong>
                        ${onboardCount}/${capacity}
                    </strong>

                </div>


                <div>

                    <span>
                        Your status
                    </span>

                    <strong>
                        Waiting
                    </strong>

                </div>

            </div>


            <div class="club-driver-rule">

                <i class="fas fa-car-side"></i>

                <div>

                    <strong>
                        Driver is collecting passengers
                    </strong>

                    <p>
                        Keep your phone nearby.
                        You'll receive an update when
                        the driver starts heading to you.
                    </p>

                </div>

            </div>

        `;
    },


    /* ========================================================
       DRIVER ASSIGNED
       ======================================================== */

    renderDriverAssigned(request) {
        const container = document.getElementById('sheetContent');
        if (!container) return;
        const escape = value => ASIYE.ui.escape(String(value || ''));
        const isClub = request.type === 'club';
        const phone = String(request.driverPhone || '').replace(/[^\d+]/g, '');
        const callable = /^\+?\d{6,15}$/.test(phone);
        container.innerHTML = `
            <section class="ride-match" aria-label="Your confirmed driver">
                <div class="ride-match-topline">
                    <span class="ride-match-service">${isClub ? 'Asiye Club' : 'Asiye Go'}</span>
                    <span class="ride-match-status">${this.rideMatchIcon('check')}Driver confirmed</span>
                </div>
                <h2>Your ride is confirmed</h2>
                <p class="ride-match-intro">${isClub
                    ? 'Your driver is assigned. We’ll keep you updated as your Club gets ready.'
                    : 'Your driver is getting ready to collect you.'}</p>
                ${this.driverCard(request)}
                <div class="ride-match-actions" aria-label="Contact your driver">
                    ${callable
                        ? `<a href="tel:${escape(phone)}" aria-label="Call ${escape(request.driverName || 'your driver')}">${this.rideMatchIcon('call')}Call driver</a>`
                        : `<button type="button" disabled>${this.rideMatchIcon('call')}Call unavailable</button>`}
                    <button type="button" data-match-message>${this.rideMatchIcon('message')}Message</button>
                </div>
                <p class="ride-match-feedback" role="status" aria-live="polite"></p>
            </section>`;
        container.querySelector('[data-match-message]')?.addEventListener('click', async () => {
            try {
                if (typeof window.AsiyeTripChat?.open !== 'function')
                    throw new Error('Messaging is unavailable. Please call your driver.');
                await window.AsiyeTripChat.open(request, request.requestId || this.requestId);
            } catch (error) {
                const feedback = container.querySelector('.ride-match-feedback');
                if (feedback) feedback.textContent = error.message || 'Messaging is unavailable right now.';
            }
        });
        container.querySelectorAll('.ride-match img').forEach(img =>
            img.addEventListener('error', () => img.remove(), {once: true}));
    },


    /* ========================================================
       DRIVER ON WAY
       ======================================================== */

    async retrieveParcelPickupPin(requestId) {
        if (!requestId || this._parcelPins?.[requestId] ||
            this._parcelPinPending?.[requestId]) return;
        this._parcelPinPending = this._parcelPinPending || {};
        this._parcelPinPending[requestId] = true;
        try {
            const currentUser = firebase.auth().currentUser;
            if (!currentUser) return;
            const token = await currentUser.getIdToken();
            const response = await fetch(
                'https://us-central1-asiye-80386.cloudfunctions.net/getParcelPickupPinSecure',
                {method:'POST',headers:{Authorization:`Bearer ${token}`,
                  'Content-Type':'application/json'},body:JSON.stringify({requestId})}
            );
            const result = await response.json().catch(()=>({}));
            if (!response.ok || !/^[0-9]{4}$/.test(String(result.pickupPin||'')))
                throw new Error(result.error || 'Could not load your pickup PIN.');
            this._parcelPins = this._parcelPins || {};
            this._parcelPins[requestId] = String(result.pickupPin);
            // Only redraw the PIN panel for the same active trip.
            const node = document.querySelector('[data-parcel-pin]');
            if (this.requestId === requestId && node) {
                node.setAttribute('aria-label','Pickup PIN '+this._parcelPins[requestId]);
                node.innerHTML=Array.from(this._parcelPins[requestId])
                    .map(digit=>'<span aria-hidden="true">'+digit+'</span>').join('');
            }
        }catch(error){
            console.warn('Secure Parcel PIN could not be loaded:',error?.message);
        }finally{
            delete this._parcelPinPending[requestId];
        }
    },

    // Illustrations are display assets only. Approval still requires the real car photo.
    vehicleIllustration(request = {}) {
        const make = String(request.vehicleMake || '').trim().toLowerCase();
        const model = String(request.vehicleModel || '').trim().toLowerCase();
        const corolla = /\btoyota\b/.test(make) && /\bcorolla\b/.test(model);
        const palette = {white:'#f5f5f0',silver:'#aeb9c1',grey:'#66737f',gray:'#66737f',
            black:'#303b47',blue:'#3973ad',red:'#b94442',green:'#50846c',
            gold:'#b4a077',brown:'#8a6954',orange:'#ce7c39',yellow:'#dfbd51'};
        const colour = String(request.vehicleColor || '').trim().toLowerCase();
        const paint = palette[colour] || '#aeb9c1';
        const label = corolla ? 'Toyota Corolla illustration' : 'Vehicle illustration';
        // Static, original SVG geometry; user input never enters SVG markup.
        const body = corolla
            ? 'M39 104 70 97 106 66Q112 61 127 61H205Q219 62 233 74L262 97 291 104Q300 106 302 119L299 139H27L26 122Q26 109 39 104Z'
            : 'M36 104 72 97 104 69Q114 63 131 63H199Q215 64 228 76L255 97 287 104Q298 108 299 121L297 139H28L26 122Q26 109 36 104Z';
        return `<svg class="asiye-vehicle-art" viewBox="0 0 330 180" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg" data-vehicle-art="${corolla ? 'toyota-corolla' : 'generic'}">
            <ellipse cx="165" cy="148" rx="140" ry="9" fill="#263746" opacity=".10"/>
            <g class="asiye-vehicle-body">
                <path d="${body}" fill="${paint}" stroke="#344350" stroke-width="2"/>
                <path d="m88 96 27-26h38v26Zm72-26h42q10 0 20 9l19 17h-81Z" fill="#344c60" stroke="#203545" stroke-width="2"/>
                <path d="m119 74-20 19h12l20-19m39 0v19h9V74" fill="#d6edf4" opacity=".28"/>
                <path d="M36 118h258M85 103v30m74-32v32m78-30v30" fill="none" stroke="#344350" stroke-width="1.5" opacity=".45"/>
                <path d="M137 107h12m66 0h12" stroke="#344350" stroke-width="3" stroke-linecap="round"/>
                <path d="m29 111 22-4 9 11H28Z" fill="#f9d4ad"/><path d="m276 108 21 5 2 8h-27Z" fill="#f6f5dd"/>
                <path d="M118 132h94" stroke="#344350" stroke-width="3" stroke-linecap="round" opacity=".5"/>
                <path d="M47 139a32 32 0 0 1 64 0m112 0a32 32 0 0 1 64 0" fill="#293743"/>
            </g>
            <g fill="#26323d" stroke="#18232c" stroke-width="2"><circle cx="79" cy="139" r="25"/><circle cx="255" cy="139" r="25"/></g>
            <g fill="#c9d3d9" stroke="#6f818f" stroke-width="2"><circle cx="79" cy="139" r="15"/><circle cx="255" cy="139" r="15"/></g>
            <g fill="#435565"><circle cx="79" cy="139" r="5"/><circle cx="255" cy="139" r="5"/></g>
        </svg>`;
    },

    renderPickupCard(request, arrived) {
        const container = document.getElementById('sheetContent');
        if (!container) return;
        const escape = value => ASIYE.ui.escape(value);
        const passenger = this.getPassengerData(request);
        const secureParcel = request.type === 'delivery' && request.parcelSecurityVersion === 2;
        const pin = secureParcel ? String(this._parcelPins?.[request.requestId] || '----')
            : String(passenger.pickupPin ?? request.pickupPin ?? '----');
        const name = request.driverName || 'Your driver';
        const rating = Number(request.driverRating);
        const phone = String(request.driverPhone || '').replace(/[^\d+]/g, '');
        const driverPhoto =
            request.driverProfileImageUrl ||
            request.profileImageUrl ||
            request.profile_picture_url ||
            '';
        const vehicleDescription =
            [
                request.vehicleColor,
                request.vehicleMake,
                request.vehicleModel,
                request.vehicleYear
            ]
            .filter(Boolean)
            .join(' ');
        const icons = {
            call: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z"/>',
            message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 9h9M7 13h6"/>',
            safety: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>'
        };
        const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
        container.innerHTML = `
            <section class="pickup-card ${arrived ? 'pickup-card--arrived' : ''}">
                <header class="pickup-heading">
                    <span class="pickup-status"><span></span>${arrived ? 'Driver arrived' : 'Driver on the way'}</span>
                    <h2>${arrived ? 'Your driver is here' : `${escape(name)} is coming`}</h2>
                    <p ${arrived ? '' : 'id="passengerDriverEta"'}>${arrived ? 'Meet your driver at the pickup point.' : 'Your driver is heading to your pickup.'}</p>
                </header>
                <div class="pickup-progress" aria-hidden="true"><span></span><span></span><span></span></div>
                <div class="pickup-driver">
                    <div class="pickup-avatar" aria-hidden="true">
                        ${driverPhoto
                            ? `<img src="${escape(driverPhoto)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
                            : escape(name.charAt(0).toUpperCase())}
                    </div>
                    <div class="pickup-driver-info">
                        <strong>${escape(name)}</strong>
                        <span>${Number.isFinite(rating) && rating > 0 ? `<span class="pickup-star">★</span> ${rating.toFixed(1)} <span class="pickup-muted">· Verified driver</span>` : 'Verified driver'}</span>
                        <span class="pickup-muted">${escape(vehicleDescription || 'Vehicle details available')}</span>
                    </div>
                    <div class="pickup-vehicle">
                        <span>Vehicle plate</span>
                        <strong>${escape(request.vehicleReg || 'Not available')}</strong>
                    </div>
                </div>
                <div class="pickup-vehicle-illustration">
                    ${this.vehicleIllustration(request)}
                    <span>Vehicle illustration · Confirm the number plate before boarding</span>
                </div>
                <div class="pickup-pin">
                    <div class="pickup-pin-heading"><span>${arrived ? 'Give your driver this PIN' : 'Your pickup PIN'}</span>${icon('safety')}</div>
                    <div class="pickup-pin-digits" ${secureParcel ? 'data-parcel-pin' : ''} aria-label="Pickup PIN ${escape(pin)}">${Array.from(pin).map(digit => `<span aria-hidden="true">${escape(digit)}</span>`).join('')}</div>
                    <p>${arrived ? 'Share when you are ready to start your ride.' : 'Share with your driver when they arrive.'}</p>
                </div>
                <div class="pickup-actions">
                    <button type="button" data-pickup-action="call">${icon('call')}<span>Call</span></button>
                    <button type="button" data-pickup-action="message">${icon('message')}<span>Message</span></button>
                    <button type="button" data-pickup-action="safety">${icon('safety')}<span>Safety</span></button>
                </div>
                <div class="pickup-action-feedback" role="status"></div>
            </section>`;
        container.querySelectorAll('[data-pickup-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.pickupAction;
                if (action === 'message') {
                    AsiyeTripChat.open(request, this.requestId);
                    return;
                }
                if (action === 'call') {
                    if (!phone || !/^\+?\d{7,15}$/.test(phone)) {
                        container.querySelector('.pickup-action-feedback').textContent = 'The driver’s contact number is not available yet.';
                        return;
                    }
                    window.location.href = `${action === 'call' ? 'tel' : 'sms'}:${phone}`;
                } else {
                    container.querySelector('.pickup-action-feedback').textContent = 'Check the vehicle plate before boarding. Share your pickup PIN only with your driver when you are ready to start.';
                }
            });
        });
        if (request.clubSecurityVersion === 2) window.ClubLive.enhancePickup(request, container, arrived);
        if (arrived && request.goContinuationVersion === 2) {
            const shareArea = document.createElement('div');
            shareArea.className = 'pickup-live-share';
            shareArea.style.cssText = 'margin-top:12px;display:grid;gap:8px;';
            const info = document.createElement('p');
            info.style.cssText = 'margin:0;font-size:13px;line-height:1.45;';
            info.textContent = 'You can share your live location with loved ones via WhatsApp. Sharing is optional: your driver can verify your pickup PIN and start the trip without it.';
            shareArea.append(info);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'primary-button';
            button.textContent = 'Share live trip with loved ones';
            shareArea.append(button);
            container.append(shareArea);
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await ASIYE.booking.completeGoSafetyShare(request);
                    ASIYE.ui.toast('Trip link shared. Return to Asiye to show your driver the pickup PIN.');
                } catch (error) {
                    ASIYE.ui.toast(error.message || 'Sharing was not completed. You may still start using the pickup PIN.');
                } finally {
                    if (button.isConnected) button.disabled = false;
                }
            });
        }
        ASIYE.map?.resize();
        if (secureParcel && pin === '----') void this.retrieveParcelPickupPin(request.requestId);
    },

    renderDriverOnWay(request) {
        this.renderPickupCard(request, false);
    },

    /* ========================================================
       ARRIVED
       ======================================================== */

    renderArrived(request) {
        this.renderPickupCard(request, true);
    },

    /* ========================================================
       IN TRANSIT
       ======================================================== */

    renderInTransit(request) {
        this.hydrateTripEnd(request);

        const container =
            document.getElementById(
                'sheetContent'
            );


        container.innerHTML = `

            <div class="passenger-transit-card"><div class="asiye-between">

                <div>

                    <div class="home-kicker">
                        Trip underway
                    </div>

                    <h2 class="home-title">
                        On the way
                    </h2>

                    <div class="home-greeting">
                        ${
                            ASIYE.ui.escape(
                                request.destination
                            )
                        }
                    </div>

                </div>

                <div class="asiye-status-icon">
                    <i class="fas fa-route"></i>
                </div>

            </div>

            <div class="asiye-actions transit-actions">

                <button class="asiye-action-button" id="transitSafety">
                    <i class="fas fa-shield-halved" aria-hidden="true"></i>
                    Safety
                </button>

                <button class="asiye-action-button" id="transitShare">
                    <i class="fas fa-share-nodes"></i>
                    Share
                </button>

                <button class="asiye-action-button" id="inTransitChat">
                    <i class="fas fa-comment"></i>
                    Message
                </button>

            </div>
            </div>
        `;
        document.getElementById('inTransitChat')?.addEventListener('click', () => AsiyeTripChat.open(request, this.requestId));
        document.getElementById('transitSafety')?.addEventListener('click', () => AsiyePages.open('safety'));
        document.getElementById('transitShare')?.addEventListener('click', async () => {
            try {
                // A server-authorized live tracking URL, not the pickup PIN.
                const liveTrackingUrl = await ASIYE.booking.createLiveShareUrl(this.requestId);
                const text = `Follow my Asiye ride live to ${request.destination || request.destinationName || 'my destination'}: ${liveTrackingUrl}`;
                await AsiyeTripShare.require(text);
                ASIYE.ui.toast('Live link shared. Return to Asiye to follow your trip.');
            } catch (error) {
                if (error.name !== 'AbortError') ASIYE.ui.toast(error.message || 'Unable to share live trip. Please try again.');
            }
        });
        this.renderEarlyEnd(request);
    },

    hydrateTripEnd(request) {
        for(const field of ['tripEndSafety','tripCompletion'])if(typeof request[field]==='string'){
            try{request[field]=JSON.parse(request[field]);}catch(_){request[field]=null;}
        }
    },

    renderEarlyEnd(request) {
        this.hydrateTripEnd(request);
        clearTimeout(this._earlyEndTimer);
        const end=request.tripEndSafety,container=document.getElementById('sheetContent');
        if(!container||!end||request.status!=='in_transit'||request.type==='delivery')return;
        container.querySelector('[data-early-end]')?.remove();
        const passengerId=request.type==='club'
            ? Object.keys(request.passengers||{}).find(id=>id===ASIYE.state.userId||request.passengers[id].authUid===firebase.auth().currentUser?.uid)
            : request.commuterId;
        const response=end.responses?.[passengerId];
        const expired=end.expiresAt<=Date.now()&&!request.tripCompletion;
        const pending=!expired&&end.status==='pending'&&!response;
        const panel=document.createElement('section');panel.dataset.earlyEnd='true';panel.className='trip-end-safety';
        panel.setAttribute('role',pending?'alertdialog':'status');
        if(pending){panel.setAttribute('aria-labelledby','earlyEndTitle');panel.setAttribute('aria-describedby','earlyEndDescription');}
        const message=expired?'This request expired. Your trip is still active.':
            end.status==='declined'?'The trip is still active. A passenger chose to continue to the destination.':
            end.status==='withdrawn'?'Your driver withdrew the request. The trip is still active.':
            response?.accepted?'You agreed to end here. Waiting for the other confirmations and the driver to finish.':
            (end.locationAvailable?'Your driver wants to end the trip before your destination.':'We cannot confirm arrival at your destination. Your driver wants to end the trip here.')+' Are you sure you want to end the trip here?';
        panel.innerHTML='<h3 id="earlyEndTitle">'+(pending?'End trip before your destination?':'End trip safety check')+'</h3><p id="earlyEndDescription">'+
            ASIYE.ui.escape(message)+'</p>'+(pending?'<p>Only agree if you want to finish here. The agreed fare stays the same.'+
            (request.type==='club'?' Every onboard passenger must agree.':'')+'</p><div class="trip-end-safety-actions">'+
            '<button type="button" class="secondary-button" data-end-answer="no">Keep trip active</button><button type="button" class="primary-button" data-end-answer="yes">End trip here</button></div>':'');
        container.prepend(panel);
        for(const button of panel.querySelectorAll('[data-end-answer]'))button.addEventListener('click',async()=>{
            if(this._endResponseActive)return;
            const id=this.requestId;this._endResponseActive=true;
            const buttons=panel.querySelectorAll('button');buttons.forEach(item=>item.disabled=true);
            try{
                await ASIYE.goNegotiation.post('goTripActionSecure',{requestId:id,action:'respondEarlyEnd',
                    endRequestId:end.id,accepted:button.dataset.endAnswer==='yes'});
            }catch(error){ASIYE.ui.toast(error.message||'Unable to save your response. The trip stays active.');buttons.forEach(item=>item.disabled=false);}
            finally{this._endResponseActive=false;}
        });
        if(!expired&&end.status==='pending'){
            const id=this.requestId;
            this._earlyEndTimer=setTimeout(()=>{if(this.requestId===id)this.renderEarlyEnd(request);},Math.max(1,end.expiresAt-Date.now()+50));
        }
    },


    /* ========================================================
       COMPLETED
       ======================================================== */

    renderCompleted(request) {
        this.hydrateTripEnd(request);

        const passenger =
            this.getPassengerData(
                request
            );


        const amount =

            Number(

                passenger.finalAmount ||

                passenger.price ||

                request.finalAmount ||

                request.calculatedPrice ||

                request.pricePerPassenger ||

                0
            );


        const container =
            document.getElementById(
                'sheetContent'
            );


        container.innerHTML = `

            <div class="asiye-complete">

                <div class="asiye-complete-icon">
                    <i class="fas fa-check"></i>
                </div>

                <h2 class="home-title">
                    ${request.tripCompletion?.mode==='agreed_early_end'?'Trip ended here':"You've arrived"}
                </h2>

                <div class="home-greeting">
                    ${request.tripCompletion?.mode==='agreed_early_end'?'Ended before the destination with your agreement: ':''}
                    ${ASIYE.ui.escape(
                        request.destination
                    )}
                </div>

                <div class="asiye-complete-price">
                    R${amount.toFixed(2)}
                </div>

                <div class="asiye-payment-method">
                    <span>Payment method</span>
                    <strong>${ASIYE.ui.escape(passenger.paymentMethod || request.paymentMethod || 'cash')}</strong>
                </div>

            </div>

            <button
                id="completeRideDone"
                class="primary-button"
                style="margin-top:16px;"
            >
                Done
            </button>

        `;


        document
            .getElementById(
                'completeRideDone'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.stop();

                    ASIYE.booking
                        ?.clearLocalRide?.();

                    ASIYE.map
                        ?.clearTrip?.();

                    ASIYE.ui
                        .renderHome();
                }
            );
    },


    /* ========================================================
       CANCELLED
       ======================================================== */

    renderCancelled() {

        this.stop();


        ASIYE.booking
            ?.clearLocalRide?.();


        ASIYE.map
            ?.clearTrip?.();


        ASIYE.ui.toast(
            'Your ride was cancelled.'
        );


        ASIYE.ui
            .renderHome();
    },


    /* ========================================================
       DRIVER CARD
       ======================================================== */

    rideMatchIcon(name) {
        const paths = {
            check: '<path d="m6 12 4 4 8-8"/>',
            call: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z"/>',
            message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 9h9M7 13h6"/>',
            car: '<path d="m5 10 2-5h10l2 5M4 10h16v8H4zM6 18v2m12-2v2M7 14h.01M17 14h.01"/>'
        };
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
    },

    driverCard(request) {
        const escape = value => ASIYE.ui.escape(String(value || ''));
        const name = String(request.driverName || 'Your driver');
        const image = value => /^(https?:\/\/|\.{0,2}\/|assets\/)/i.test(String(value || ''))
            ? String(value) : '';
        const photo = image(request.driverProfileImageUrl || request.profileImageUrl || request.profile_picture_url);
        const vehicle = [request.vehicleColor, request.vehicleMake, request.vehicleModel, request.vehicleYear]
            .filter(Boolean).join(' ');
        const rating = Number(request.driverRating);
        return `
            <div class="ride-match-driver-card">
                <div class="ride-match-driver">
                    <div class="ride-match-avatar" aria-hidden="true"><span>${escape(name.charAt(0).toUpperCase())}</span>
                        ${photo ? `<img src="${escape(photo)}" alt="">` : ''}</div>
                    <div class="ride-match-driver-info">
                        <strong>${escape(name)}</strong>
                        <span>${Number.isFinite(rating) && rating > 0 && rating <= 5
                            ? `<span class="ride-match-star" aria-hidden="true">★</span> ${rating.toFixed(1)} <span class="ride-match-dot">·</span> Your driver`
                            : 'Your assigned driver'}</span>
                    </div>
                </div>
                <div class="ride-match-vehicle">
                    <div class="ride-match-car-photo">${this.vehicleIllustration(request)}</div>
                    <div class="ride-match-vehicle-info">
                        <span>${escape(vehicle || 'Vehicle details will appear here')}</span>
                        ${request.vehicleReg ? `<strong class="ride-match-plate">${escape(request.vehicleReg)}</strong>` : ''}
                    </div>
                </div>
            </div>`;
    },


    /* ========================================================
       PASSENGER DATA
       ======================================================== */

    getPassengerData(request) {

        if (
            request.type === 'club' &&
            request.passengers &&
            ASIYE.state.userId &&
            request.passengers[
                ASIYE.state.userId
            ]
        ) {

            return request.passengers[
                ASIYE.state.userId
            ];
        }


        return request;
    },


    /* ========================================================
       DRIVER LOCATION LISTENER
       ======================================================== */

    listenDriver(
        driverId
    ) {

        if (!driverId) {

            return;
        }


        /*
         * Already listening to this driver.
         */

        if (
            this.currentDriverId ===
                driverId &&
            this.driverRef &&
            this.driverListener
        ) {

            return;
        }


        /*
         * Stop old driver listener.
         */

        this.stopDriver();


        this.currentDriverId =
            driverId;


        this.driverRef =

            firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                );


        this.driverListener =

            this.driverRef.on(

                'value',

                snapshot => {

                    const driver =
                        snapshot.val();


                    if (!driver) {

                        return;
                    }


                    const latitude =

                        Number(
                            driver.latitude ??
                            driver.location?.latitude ??
                            driver.location?.lat
                        );


                    const longitude =

                        Number(
                            driver.longitude ??
                            driver.location?.longitude ??
                            driver.location?.lng
                        );


                    const heading =

                        Number(
                            driver.heading ??
                            driver.location?.heading ??
                            0
                        );


                    if (
                        !Number.isFinite(
                            latitude
                        ) ||
                        !Number.isFinite(
                            longitude
                        )
                    ) {

                        return;
                    }


                    ASIYE.map
                        ?.showDriverLocation?.(
                            latitude,
                            longitude,
                            heading
                        );

                    // Draw the actual road route between the moving driver and
                    // the passenger pickup (then driver to destination onboard).
                    this.refreshLiveTripRoute(
                        latitude,
                        longitude
                    );
                }
            );
    },


    /* ========================================================
       STOP DRIVER LISTENER
       ======================================================== */

    stopDriver() {

        if (
            this.driverRef &&
            this.driverListener
        ) {

            this.driverRef.off(

                'value',

                this.driverListener
            );
        }


        this.driverRef =
            null;


        this.driverListener =
            null;


        this.currentDriverId =
            null;

        this.lastApproachRouteAt = 0;
        this.lastApproachRoutePoint = null;


        ASIYE.map
            ?.removeDriverMarker?.();
    },


    /* ========================================================
       RESTORE
       ======================================================== */

    async restore() {

        const commuterId =
            ASIYE.state.userId;


        const localRequestId =
            String(
                localStorage.getItem(
                    'currentRequestId'
                ) ||
                ''
            ).trim();


        let serverRequestId =
            '';


        if (commuterId) {

            const currentSnapshot =

                await firebase
                    .database()
                    .ref(
                        `commuters/${commuterId}/currentRequest`
                    )
                    .once(
                        'value'
                    )
;


            serverRequestId =
                String(
                    currentSnapshot?.val?.() ||
                    ''
                ).trim();
        }


        /*
         * Server currentRequest is authoritative. The local ID is retained as
         * a recovery fallback for bookings created by older app builds.
         */
        const candidates =
            [
                serverRequestId,
                localRequestId
            ]
            .filter(
                (
                    value,
                    index,
                    values
                ) =>
                    value &&
                    values.indexOf(
                        value
                    ) === index
            );


        for (
            const requestId
            of candidates
        ) {

            const snap =

                await firebase
                    .database()
                    .ref(
                        `requests/${requestId}`
                    )
                    .once(
                        'value'
                    );


            const request =
                snap.val();


            const stale = !this.isActiveBooking(request, commuterId);


            if (stale) {

                if (ASIYE.state.booking.requestId === requestId) {
                    ASIYE.state.booking.requestId = null;
                    ASIYE.state.booking.request = null;
                }

                if (
                    localRequestId ===
                        requestId
                ) {
                    localStorage.removeItem(
                        'currentRequestId'
                    );
                }


                if (
                    commuterId &&
                    serverRequestId ===
                        requestId
                ) {

                    await firebase
                        .database()
                        .ref(
                            `commuters/${commuterId}/currentRequest`
                        )
                        .transaction(
                            current =>
                                current == null || String(
                                    current ||
                                    ''
                                ) ===
                                    String(
                                        requestId
                                    )
                                    ? null
                                    : undefined
                        )
                        .catch(
                            () => {}
                        );
                }


                continue;
            }


            request.requestId =
                requestId;


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


            /*
             * Older app builds may have a valid local request but no server
             * lock. Repair that lock so both passenger and backend agree.
             */
            if (
                commuterId &&
                serverRequestId !==
                    requestId
            ) {

                await firebase
                    .database()
                    .ref(
                        `commuters/${commuterId}/currentRequest`
                    )
                    .transaction(
                        current =>
                            !current ||
                            String(current) ===
                                String(
                                    requestId
                                )
                                ? requestId
                                : undefined
                    )
                    .catch(
                        () => {}
                    );
            }


            await this.start(
                requestId, request
            );


            return true;
        }


        return false;
    }

};

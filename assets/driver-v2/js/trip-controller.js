/* ============================================================
   ASIYE DRIVER V2
   TRIP CONTROLLER

   GO:
   accepted
   → driver_on_way
   → arrived
   → passenger_onboard
   → in_transit
   → completed

   CLUB:
   driver_waiting / pool_ready
   → collecting_passengers
   → individual pickups
   → all_onboard
   → in_transit
   → completed
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};


ASIYE_DRIVER.trip = {

    requestId:
        null,

    request:
        null,

    requestRef:
        null,

    requestListener:
        null,

    currentPassengerId:
        null,

    routePhase:
        null,


    /* ========================================================
       START
       ======================================================== */

    async start(requestId, restoredRequest = null) {
        if (!requestId) return false;
        this.stop();
        const generation = this._generation;
        this.requestId = requestId;
        const ref = firebase.database().ref(`requests/${requestId}`);
        const request = restoredRequest || (await ref.once('value')).val();
        if (generation !== this._generation) return false;
        if (!request) return false;
        const apply = live => {
            live.key = requestId;
            live.requestId = requestId;
            this.request = live;
            ASIYE_DRIVER.state.activeRequest = live;
            window.AsiyeTripChat?.watchTrip?.(live, requestId);
            this.handleState(live);
            this.renderCancellation(live);
            this.renderEarlyEnd(live);
        };
        localStorage.setItem('currentRequestId', requestId);
        apply(request);
        this.requestRef = ref;
        this.requestListener = ref.on('value', snapshot => {
            if (generation !== this._generation) return;
            const live = snapshot.val();
            if (!live) { this.cleanup(); return; }
            apply(live);
        }, error => ASIYE_DRIVER.ui?.toast?.(error.message || 'Unable to refresh booking.', 'danger'));
        return true;
    },

    renderCancellation(request) {
        const container = document.getElementById('activeTripContent');
        if (!container) return;
        container.querySelector('[data-trip-cancel]')?.remove();
        const arrived = request.arrivedAt || request.tripStartedAt ||
            ['arrived', 'passenger_onboard', 'all_onboard', 'in_transit', 'completed'].includes(request.status) ||
            Object.values(request.passengers || {}).some(p => p.arrivedAt || p.pinVerifiedAt);
        if (arrived || String(request.status).startsWith('cancelled') || ['rejected', 'expired'].includes(request.status)) return;
        if (container.querySelector('[data-club-cancel]')) return;
        const button = document.createElement('button');
        button.dataset.tripCancel = 'true';
        button.className = 'driver-btn driver-btn-secondary';
        button.textContent = 'Cancel booking';
        container.append(button);
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await this.cancelTrip(); }
            catch (error) { ASIYE_DRIVER.ui.toast(error.message || 'Unable to cancel.', 'danger'); button.disabled = false; }
        });
    },

    async goAction(action, details = {}) {
        return ASIYE_DRIVER.requests.postNegotiation('goTripActionSecure', {requestId: this.requestId, action, ...details});
    },

    async parcelAction(action, details = {}) {
        return ASIYE_DRIVER.requests.postNegotiation('parcelTripActionSecure', {
            requestId:this.requestId, action, ...details
        });
    },

    /* ========================================================
       STATE MACHINE
       ======================================================== */

    handleState(
        request
    ) {
        if (request.clubSecurityVersion === 2 && ['pooling','driver_waiting','pool_ready','work_negotiation'].includes(request.status)) { window.ClubLive.renderDriver(request); return; }


        const status =
            request.status;


        console.log(
            '🚕 Driver trip state:',
            status
        );


        switch (status) {


            case 'payment_required':

                if (
                    (request.negotiationEnabled === true &&
                     request.fareStatus === 'agreed') ||
                    (request.type === 'delivery' &&
                     request.paymentMethod === 'card' &&
                     Boolean(request.taxiId))
                ) {

                    this.renderNegotiatedPaymentWaiting(
                        request
                    );
                }

                break;


            case 'accepted':

                this.renderAccepted(
                    request
                );
                void this.resumeConfirmedCardPickup(request);

                break;


            case 'driver_waiting':

                this.renderClubWaiting(
                    request
                );

                break;


            case 'pool_ready':

                this.renderClubReady(
                    request
                );

                break;


            case 'driver_on_way':

                this.renderDriverOnWay(
                    request
                );
                void this.resumeConfirmedCardPickup(request);

                break;


            case 'collecting_passengers':

                this.handleClubCollection(
                    request
                );

                break;


            case 'arrived':

                this.renderArrived(
                    request
                );

                break;


            case 'passenger_onboard':

            case 'all_onboard':

                this.handleOnboardState(
                    request
                );

                break;


            case 'in_transit':

                this.renderInTransit(
                    request
                );

                break;


            case 'completed':

                this.renderCompleted(
                    request
                );

                break;


            case 'cancelled_by_commuter':

            case 'cancelled_by_admin':

            case 'rejected':

                this.handleCancelled(
                    request
                );

                break;
        }
    },


    /* ========================================================
       GO — FARE AGREED, WAITING FOR PASSENGER PAYMENT
       ======================================================== */

    renderNegotiatedPaymentWaiting(
        request
    ) {

        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) {
            return;
        }


        const agreedFare =
            Number(
                request.agreedFare ||
                request.finalAmount ||
                0
            );


        const driverNet =
            Number(
                request.driverNetFare ||
                (
                    agreedFare *
                    (
                        1 -
                        Number(
                            request.commissionRate ||
                            0.20
                        )
                    )
                )
            );


        const paymentMethod =
            String(
                request.paymentMethod ||
                'cash'
            )
                .toLowerCase();


        container.innerHTML = `
            <div class="driver-payment-wait-card">

                <div class="driver-dialog-kicker">
                    ${request.type === 'delivery' ? 'Asiye Parcel · Driver reserved' : 'Asiye Go · Fare agreed'}
                </div>

                <h2 class="driver-title">
                    R${agreedFare.toFixed(0)} agreed
                </h2>

                <div class="driver-subtitle">
                    You are reserved for this passenger.
                    ${
                        paymentMethod === 'card'
                            ? 'Waiting for confirmed Paystack payment. Pickup unlocks automatically after confirmation.'
                            : 'Cash is due after drop-off. Head to pickup and verify the passenger PIN before driving to the destination.'
                    }
                </div>

                <div class="driver-request-meta" style="margin-top:16px;">
                    <div>
                        <span>Passenger fare</span>
                        <strong>
                            R${agreedFare.toFixed(2)}
                        </strong>
                    </div>

                    <div>
                        <span>You receive</span>
                        <strong>
                            R${driverNet.toFixed(2)}
                        </strong>
                    </div>

                    <div>
                        <span>Payment</span>
                        <strong>
                            ${paymentMethod.toUpperCase()}
                        </strong>
                    </div>
                </div>

                <div class="driver-payment-wait-note">
                    ${paymentMethod === 'cash'
                      ? 'No upfront cash confirmation is needed. Verify the passenger PIN at pickup; collect cash after drop-off.'
                      : 'Pickup unlocks when payment is confirmed. Verify the PIN at pickup before departure.'}
                </div>
                ${paymentMethod === 'cash' ? '<button class="driver-btn driver-btn-primary" data-cash-pickup>Start cash pickup</button>' : ''}
                ${paymentMethod === 'card' ? '<a class="driver-btn driver-btn-primary" href="./payout.html">Card earnings · verify payment setup</a><p class="driver-payment-wait-note">If payment setup is incomplete, finish it here. The passenger can then tap Try card payment again.</p>' : ''}

            </div>
        `;


        container.querySelector('[data-cash-pickup]')?.addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try { await this.goAction('cashPickup'); }
            catch (error) { ASIYE_DRIVER.ui.toast(error.message || 'Unable to start pickup.', 'danger'); event.currentTarget.disabled = false; }
        });

        document
            .getElementById(
                'activeTripSheet'
            )
            ?.classList
            .add(
                'open'
            );
    },


    /* ========================================================
       GO — ACCEPTED
       ======================================================== */

    renderAccepted(
        request
    ) {

        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showAcceptedTrip ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showAcceptedTrip(
                    request
                );

        } else {

            window.dispatchEvent(

                new CustomEvent(
                    'asiye-driver-trip-update',
                    {
                        detail: {
                            state:
                                'accepted',
                            request
                        }
                    }
                )
            );
        }
    },


    /* ========================================================
       GO — START PICKUP
       ======================================================== */

    async resumeConfirmedCardPickup(request) {
        const id = this.requestId;
        if (!id || request.type === 'club' || request.type === 'delivery' ||
            request.paymentMethod !== 'card' || request.goContinuationVersion !== 2 ||
            request.fareStatus !== 'agreed' || request.paymentsReady !== true ||
            !['held', 'captured'].includes(request.paymentStatus) ||
            !['accepted', 'driver_on_way'].includes(request.status) ||
            this._cardPickupNavigatedFor === id || this._cardPickupActive) return;
        this._cardPickupActive = true;
        try {
            if (request.status === 'accepted') await this.goAction('onWay');
            const live = (await this.requestRef.once('value')).val();
            if (this.requestId !== id || live?.status !== 'driver_on_way' || live.paymentsReady !== true) return;
            await this.startPickupNavigation(live);
            this._cardPickupNavigatedFor = id;
        } catch (error) {
            ASIYE_DRIVER.ui?.toast?.(error.message || 'Payment confirmed. Tap Start pickup to retry navigation.', 'warning');
        } finally { this._cardPickupActive = false; }
    },

    async startPickup() {

        if (
            !this.requestId ||
            !this.request
        ) {

            return;
        }


        if (
            this.request.type ===
            'club'
        ) {

            return await this.startClubCollection();
        }


        if (
            this.request.negotiationEnabled ===
                true &&
            (
                this.request.fareStatus !==
                    'agreed' ||
                this.request.paymentsReady !==
                    true ||
                this.request.status !==
                    'accepted'
            )
        ) {

            throw new Error(
                'Wait for the confirmed passenger payment before starting pickup.'
            );
        }


        if (this.request.type === 'delivery' &&
            String(this.request.paymentMethod || 'cash').toLowerCase() === 'card' &&
            (this.request.paymentsReady !== true ||
             !['held', 'captured'].includes(String(this.request.paymentStatus || '')))) {
            throw new Error('Confirm Paystack payment before collecting this parcel.');
        }

        if (this.request.parcelSecurityVersion === 2) {
            await this.parcelAction('onWay');
            await this.startPickupNavigation(this.request);
            return;
        }
        if (this.request.goContinuationVersion === 2) {
            await this.goAction('onWay');
            await this.startPickupNavigation(this.request);
            return;
        }

        await this.requestRef.update({

            status:
                'driver_on_way',

            driverOnWayAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


        await this.notifyPassenger(

            this.request.commuterId,

            {

                type:
                    'driver_on_way',

                title:
                    'Driver is on the way',

                message:
                    `${this.request.driverName || 'Your driver'} is heading to your pickup location.`,

                requestId:
                    this.requestId
            }
        );


        /* ====================================================
           DRIVER MAP — PICKUP NAVIGATION
           ==================================================== */

        await this.startPickupNavigation(
            this.request
        );
    },


    /* ========================================================
       START PICKUP NAVIGATION
       ======================================================== */

    async startPickupNavigation(
        request
    ) {

        if (!request) {

            return;
        }


        const pickup =

            request.commuterLocation ||

            request.pickupLocation ||

            request.passengerLocation;


        const latitude =

            Number(
                pickup?.latitude ??
                pickup?.lat
            );


        const longitude =

            Number(
                pickup?.longitude ??
                pickup?.lng
            );


        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {

            ASIYE_DRIVER.ui
                ?.toast?.(
                    'Passenger location is unavailable.'
                );


            return;
        }


        const target = {

            type:
                'pickup',

            id:
                request.commuterId,

            label:
                request.pickupAddress ||
                request.commuterName ||
                'Passenger pickup',

            latitude:
                latitude,

            longitude:
                longitude
        };


        /*
         * Draw the route on the driver map.
         */

        const route =

            await ASIYE_DRIVER.map
                ?.routeTo?.(
                    target
                );


        /*
         * Render the in-app navigator first so the guidance engine can bind
         * its speed, traffic, voice and follow controls.
         */

        ASIYE_DRIVER.ui
            ?.showPickupNavigation?.(
                request,
                target,
                route
            );


        ASIYE_DRIVER.navigator
            ?.startTarget?.(
                target,
                {
                    key:
                        `${this.requestId || request.requestId || request.key}:pickup:${target.id || ''}:${target.latitude},${target.longitude}`,
                    route:
                        route?.rawRoute ||
                        null
                }
            );
    },


    /* ========================================================
       START DESTINATION NAVIGATION

       Called when the passenger is onboard and the trip
       moves to in_transit. Swaps the driver's route from
       "Driver → Passenger" to "Driver → Destination".
       ======================================================== */

    async startDestinationNavigation(request) {
        const current = this.requestRef ? (await this.requestRef.once('value')).val() : request;
        if ((current?.goContinuationVersion === 2 || current?.parcelSecurityVersion === 2) &&
            (current.status !== 'in_transit' || !current.pinVerifiedAt))
            throw new Error('Verify the passenger PIN at pickup before starting destination navigation.');
        ASIYE_DRIVER.ui.closePassengerPin?.();
        ASIYE_DRIVER.ui.showInTransit(current || request);
    },


    /* ========================================================
       DRIVER ON WAY
       ======================================================== */

    renderDriverOnWay(
        request
    ) {

        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showPickupNavigation ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showPickupNavigation(
                    request
                );
        }
    },


    /* ========================================================
       GO — ARRIVED
       ======================================================== */

    async markArrived() {

        if (
            !this.requestId ||
            !this.request
        ) {

            return;
        }


        /*
         * CLUB passenger arrival is individual.
         */

        if (
            this.request.type ===
            'club'
        ) {

            return await this
                .markClubPassengerArrived();
        }


        if (this.request.parcelSecurityVersion === 2) {
            await this.parcelAction('arrive');
            return;
        }
        if (this.request.goContinuationVersion === 2) {
            await this.goAction('arrive');
            return;
        }

        await this.requestRef.update({

            status:
                'arrived',

            arrivedAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


        await this.notifyPassenger(

            this.request.commuterId,

            {

                type:
                    'driver_arrived',

                title:
                    'Driver arrived',

                message:
                    'Your driver has arrived at your pickup location.',

                requestId:
                    this.requestId
            }
        );
    },


    renderArrived(
        request
    ) {

        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showPassengerPin ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showPassengerPin({

                    requestId:
                        this.requestId,

                    passengerId:
                        request.commuterId,

                    passengerName:
                        request.commuterName,

                    expectedPin:
                        request.parcelSecurityVersion === 2 ? undefined : request.pickupPin,

                    isClub:
                        false
                });
        }
    },


    /* ========================================================
       VERIFY GO PIN
       ======================================================== */

    async verifyGoPin(
        enteredPin
    ) {
        if (this.request?.parcelSecurityVersion === 2) {
            const result = await this.parcelAction('verifyPin', {pin:enteredPin});
            if (result.pinValid) await this.startDestinationNavigation(this.request);
            return result.pinValid === true;
        }
        if (this.request?.goContinuationVersion === 2) {
            const result = await this.goAction('verifyPin', {pin: enteredPin});
            if (result.pinValid) await this.startDestinationNavigation(this.request);
            return result.pinValid === true;
        }


        if (
            !this.request
        ) {

            return false;
        }


        const expected =

            String(
                this.request.pickupPin ||
                ''
            );


        const entered =

            String(
                enteredPin ||
                ''
            )
            .trim();


        if (
            !expected ||
            entered !== expected
        ) {

            return false;
        }


        await this.requestRef.update({

            status:
                'passenger_onboard',

            passengerOnboardAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


        /*
         * Immediately begin private trip.
         */

        await this.startGoTrip();


        return true;
    },


    async startGoTrip() {
        if (this.request?.parcelSecurityVersion === 2)
            throw new Error('Parcel movement requires server PIN verification.');

        await this.requestRef.update({

            status:
                'in_transit',

            tripStartedAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


        /*
         * Driver → Destination.
         */

        await this.startDestinationNavigation(
            this.request
        );
    },


    /* ========================================================
       CLUB WAITING
       ======================================================== */

    renderClubWaiting(
        request
    ) {

        const progress =
            this.getClubProgress(
                request
            );


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showClubWaiting ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showClubWaiting({

                    request:
                        request,

                    confirmed:
                        progress.confirmed,

                    capacity:
                        progress.capacity,

                    remaining:
                        progress.remaining
                });
        }
    },


    /* ========================================================
       CLUB READY
       ======================================================== */

    renderClubReady(
        request
    ) {

        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showClubReady ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showClubReady(
                    request
                );
        }
    },


    /* ========================================================
       START CLUB COLLECTION
       ======================================================== */

    async startClubCollection() {
        if (this.request?.clubSecurityVersion === 2) { await window.ClubLive.driverAction('collect'); await this.navigateToNextClubPassenger(); return; }


        if (
            !this.request ||
            this.request.type !==
                'club'
        ) {

            return;
        }


        const progress =
            this.getClubProgress(
                this.request
            );


        /*
         * STRICT CLUB RULE:
         *
         * Do not start fetching until
         * required passenger capacity is filled.
         */

        if (!progress.ready) {

            throw new Error(

                `Club is not ready. ${progress.remaining} passenger(s) still required.`

            );
        }


        await this.requestRef.update({

            status:
                'collecting_passengers',

            collectionStartedAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP,

            waitingForMore:
                false
        });


        await firebase
            .database()
            .ref(
                `taxis/${ASIYE_DRIVER.state.driverId}`
            )
            .update({

                isBroadcasting:
                    false,

                isFull:
                    true,

                passengerCount:
                    progress.confirmed
            });


        await this.notifyAllClubPassengers(
            this.request,
            {
                type:
                    'driver_on_way',

                title:
                    'Club collection started',

                message:
                    'Your Asiye Club driver has started collecting passengers.'
            }
        );


        /*
         * Navigate to closest passenger.
         */

        await this.navigateToNextClubPassenger();
    },


    /* ========================================================
       CLUB COLLECTION STATE
       ======================================================== */

    async handleClubCollection(request) {
        const members = Object.entries(request.passengers || {});
        const current = members.find(([, p]) => p.status === 'arrived') ||
            members.find(([, p]) => p.status === 'driver_on_way');
        if (current) {
            const [id, passenger] = current;
            this.currentPassengerId = id;
            if (passenger.status === 'arrived') {
                ASIYE_DRIVER.ui.showPassengerPin({requestId: this.requestId, passengerId: id,
                    passengerName: passenger.name || passenger.commuterName, isClub: true});
            } else {
                await this.startPickupNavigation({...request, commuterId: id,
                    commuterName: passenger.name || passenger.commuterName, pickupAddress: passenger.pickupAddress,
                    commuterLocation: {latitude: passenger.pickupLat, longitude: passenger.pickupLng}});
            }
            return;
        }
        this.currentPassengerId = null;
        await this.navigateToNextClubPassenger(request);
    },

    /* ========================================================
       FIND NEXT CLOSEST PASSENGER
       ======================================================== */

    async navigateToNextClubPassenger(
        request = null
    ) {

        const req =
            request ||
            this.request;


        if (
            !req ||
            !req.passengers
        ) {

            return;
        }


        const driverLocation =
            this.getDriverLocation();


        const candidates =

            Object.entries(
                req.passengers
            )
            .map(
                ([id, passenger]) => ({

                    id,
                    ...passenger
                })
            )
            .filter(
                passenger =>

                    ![
                        'passenger_onboard',
                        'in_transit',
                        'completed',
                        'cancelled_by_commuter',
                        'cancelled_by_driver'
                    ]
                    .includes(
                        passenger.status
                    )
            );


        /*
         * Everyone collected.
         */

        if (
            candidates.length ===
            0
        ) {

            await this.markAllOnboard();

            return;
        }


        /*
         * Calculate distance from current driver position.
         */

        candidates.forEach(
            passenger => {

                const lat =
                    Number(
                        passenger.pickupLat ||
                        passenger.latitude
                    );


                const lng =
                    Number(
                        passenger.pickupLng ||
                        passenger.longitude
                    );


                passenger._distance =

                    (
                        driverLocation &&
                        Number.isFinite(lat) &&
                        Number.isFinite(lng)
                    )

                    ? this.distanceKm(

                        driverLocation.lat,
                        driverLocation.lng,

                        lat,
                        lng
                    )

                    : Infinity;
            }
        );


        candidates.sort(

            (a, b) =>
                a._distance -
                b._distance
        );


        const next =
            candidates[0];


        this.currentPassengerId =
            next.id;


        if (req.clubSecurityVersion === 2) {
            await window.ClubLive.driverAction('onWay', {passengerId:next.id});
        } else {
        await firebase
            .database()
            .ref(
                `requests/${this.requestId}/passengers/${next.id}`
            )
            .update({

                status:
                    'driver_on_way',

                driverOnWayAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


        }

        await this.notifyPassenger(

            next.id,

            {

                type:
                    'driver_on_way',

                title:
                    'Driver is coming to you',

                message:
                    'Your Club driver is heading to your pickup point.',

                requestId:
                    this.requestId
            }
        );


        /*
         * Navigate driver to this Club passenger.
         */

        await this.startPickupNavigation({

            ...req,

            commuterId:
                next.id,

            commuterName:

                next.name ||
                next.commuterName ||
                'Passenger',

            commuterProfileImageUrl:
                next.profileImageUrl ||
                next.profile_picture_url ||
                '',

            passengerProfileImageUrl:
                next.profileImageUrl ||
                next.profile_picture_url ||
                '',

            pickupAddress:
                next.pickupAddress,

            commuterLocation: {

                latitude:

                    next.pickupLat ??
                    next.latitude,

                longitude:

                    next.pickupLng ??
                    next.longitude
            }
        });
    },


    /* ========================================================
       CLUB PASSENGER ARRIVED
       ======================================================== */

    async markClubPassengerArrived() {
        if (this.request?.clubSecurityVersion === 2) { await window.ClubLive.driverAction('arrive', {passengerId:this.currentPassengerId}); ASIYE_DRIVER.ui.showPassengerPin({isClub:true,passengerId:this.currentPassengerId,passengerName:this.request.passengers[this.currentPassengerId]?.name}); return; }


        const passengerId =
            this.currentPassengerId;


        if (!passengerId) {

            return;
        }


        const passenger =

            this.request
                ?.passengers
                ?.[passengerId];


        if (!passenger) {

            return;
        }


        await firebase
            .database()
            .ref(
                `requests/${this.requestId}/passengers/${passengerId}`
            )
            .update({

                status:
                    'arrived',

                arrivedAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


        await this.notifyPassenger(

            passengerId,

            {

                type:
                    'driver_arrived',

                title:
                    'Driver arrived',

                message:
                    'Your Club driver has arrived at your pickup point.',

                requestId:
                    this.requestId
            }
        );


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showPassengerPin ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showPassengerPin({

                    requestId:
                        this.requestId,

                    passengerId:
                        passengerId,

                    passengerName:

                        passenger.name ||
                        passenger.commuterName ||
                        'Passenger',

                    expectedPin:
                        passenger.pickupPin,

                    isClub:
                        true
                });
        }
    },


    /* ========================================================
       VERIFY CLUB PASSENGER PIN
       ======================================================== */

    async verifyClubPin(
        passengerId,
        enteredPin
    ) {
        if (this.request?.clubSecurityVersion === 2) { try { await window.ClubLive.driverAction('verifyPin', {passengerId, pin:enteredPin}); this.currentPassengerId=null; this.request=(await this.requestRef.once('value')).val(); await this.navigateToNextClubPassenger(this.request); return true; } catch(e) { ASIYE_DRIVER.ui.toast(e.message,'danger'); return false; } }


        if (
            !passengerId ||
            !this.request
                ?.passengers
                ?.[passengerId]
        ) {

            return false;
        }


        const passenger =

            this.request
                .passengers[
                    passengerId
                ];


        const expected =

            String(
                passenger.pickupPin ||
                ''
            );


        const entered =

            String(
                enteredPin ||
                ''
            )
            .trim();


        if (
            !expected ||
            entered !== expected
        ) {

            return false;
        }


        await firebase
            .database()
            .ref(
                `requests/${this.requestId}/passengers/${passengerId}`
            )
            .update({

                status:
                    'passenger_onboard',

                passengerOnboardAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


        await this.notifyPassenger(

            passengerId,

            {

                type:
                    'passenger_onboard',

                title:
                    'Pickup confirmed',

                message:
                    'Your pickup has been confirmed.',

                requestId:
                    this.requestId
            }
        );


        /*
         * Free current target.
         */

        this.currentPassengerId =
            null;


        /*
         * Load fresh request before
         * choosing next passenger.
         */

        const freshSnapshot =

            await this.requestRef.once(
                'value'
            );


        const freshRequest =
            freshSnapshot.val();


        this.request =
            freshRequest;


        const remaining =

            this.getPendingClubPassengers(
                freshRequest
            );


        if (
            remaining.length ===
            0
        ) {

            await this.markAllOnboard();

        } else {

            await this
                .navigateToNextClubPassenger(
                    freshRequest
                );
        }


        return true;
    },


    /* ========================================================
       ALL CLUB PASSENGERS ONBOARD
       ======================================================== */

    async markAllOnboard() {
        if (this.request?.clubSecurityVersion === 2) return this.startClubTrip();


        await this.requestRef.update({

            status:
                'all_onboard',

            allOnboardAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


        await this.startClubTrip();
    },


    async startClubTrip() {
        if (this.request?.clubSecurityVersion === 2) return window.ClubLive.driverAction('start');


        const freshSnapshot =

            await this.requestRef.once(
                'value'
            );


        const request =
            freshSnapshot.val();


        if (!request) return;


        await this.requestRef.update({

            status:
                'in_transit',

            tripStartedAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


        /*
         * Update individual passenger states.
         */

        const updates = {};


        Object.entries(
            request.passengers ||
            {}
        )
        .forEach(
            ([id, passenger]) => {

                if (
                    passenger.status ===
                    'passenger_onboard'
                ) {

                    updates[
                        `passengers/${id}/status`
                    ] =
                        'in_transit';
                }
            }
        );


        if (
            Object.keys(updates)
                .length
        ) {

            await this.requestRef
                .update(
                    updates
                );
        }


        await this.notifyAllClubPassengers(

            request,

            {

                type:
                    'trip_started',

                title:
                    'Club trip started',

                message:
                    'All passengers are onboard. Your Club trip has started.'
            }
        );


        /*
         * Driver → Destination.
         */

        await this.startDestinationNavigation(
            request
        );
    },


    /* ========================================================
       ONBOARD
       ======================================================== */

    handleOnboardState(
        request
    ) {

        if (
            request.type ===
            'club'
        ) {

            return;
        }


        /*
         * For GO, verifyGoPin already
         * advances to in_transit and drives
         * destination navigation.
         */
    },


    /* ========================================================
       IN TRANSIT
       ======================================================== */

    renderInTransit(
        request
    ) {
        if (request.goContinuationVersion === 2 && !request.pinVerifiedAt) {
            ASIYE_DRIVER.ui.toast('Pickup PIN verification is required before destination navigation.', 'danger');
            return;
        }
        ASIYE_DRIVER.ui.closePassengerPin?.();


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showInTransit ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showInTransit(
                    request
                );
        }
    },


    async settleSelectedPayments(options = {}) {
        const request =
            this.request;

        if (!request) {
            return true;
        }
        // Parcel deliveries must also settle confirmed card/wallet payments.
        // The server rejects a card payment that has not been verified.

        const authUser =
            firebase.auth()
                .currentUser;

        if (!authUser) {
            throw new Error(
                'Driver session expired. Sign in again before completing this trip.'
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
                    'https://us-central1-asiye-80386.cloudfunctions.net/settleTripPayment',
                    {
                        method:
                            'POST',
                        headers: {
                            'Authorization':
                                `Bearer ${token}`,
                            'X-Firebase-Auth':
                                `Bearer ${token}`,
                            'Content-Type':
                                'application/json'
                        },
                        body:
                            JSON.stringify({
                                requestId:
                                    this.requestId,
                                endRequestId: options.endRequestId
                            })
                    }
                );
        } catch (error) {
            throw new Error(
                'Unable to settle the passenger payment. Check your connection and try again.'
            );
        }

        const payload =
            await response
                .json()
                .catch(
                    () => ({})
                );

        if (
            !response.ok ||
            payload.settled !==
                true
        ) {
            throw new Error(
                payload.error ||
                'The selected payment method is not ready to complete this trip.'
            );
        }

        return payload;
    },


    /* ========================================================
       COMPLETE TRIP
       ======================================================== */

    async confirmCompletion() {
        const request=this.request;
        if(!request||!this.requestId||this._finishing)return;
        const id=this.requestId;
        const check=await this.goAction('checkTripEnd');
        if(this.requestId!==id)return;
        if(check.approved){await this.completeTrip({endRequestId:check.endRequestId});return;}
        const cash=request.type==='club'
            ? Object.values(request.passengers||{}).filter(p=>!/cancelled|rejected/.test(p.status||'')&&p.paymentMethod==='cash')
                .reduce((sum,p)=>sum+Number(p.price||0),0)
            : request.paymentMethod==='cash'?Number(request.agreedFare||request.finalAmount||0):0;
        const early=check.requiresPassengerConfirmation;
        if(early&&check.status==='pending'){
            ASIYE_DRIVER.ui.toast('Waiting for the passenger to confirm. The trip is still active.');return;
        }
        const message=early
            ? (check.locationAvailable?'You are not at your destination. Are you sure you want to end the trip here?':'We cannot confirm arrival at the destination. Are you sure you want to end the trip here?')+
              (request.type==='club'?' Every onboard passenger must also confirm.':' The passenger must also confirm.')+
              ' The agreed fare stays the same.'+(cash>0?` Confirm only after collecting R${cash.toFixed(2)} cash.`:'')
            : cash>0?`Confirm drop-off and that you collected R${cash.toFixed(2)} cash.`:'Confirm that the trip has ended at the destination.';
        ASIYE_DRIVER.ui.confirm(early?'End trip before destination?':'Complete trip',message,async()=>{
            if(this.requestId!==id)return;
            try{
                if(early)await this.goAction('requestEarlyEnd',{warningConfirmed:true,cashCollected:cash>0});
                else await this.completeTrip();
            }catch(error){ASIYE_DRIVER.ui.toast(error.message||'Unable to end the trip.','danger');}
        });
    },

    renderEarlyEnd(request) {
        clearTimeout(this._earlyEndTimer);
        const container=document.getElementById('activeTripContent');
        container?.querySelector('[data-early-end]')?.remove();
        if(!container||request.status!=='in_transit'||request.type==='delivery')return;
        const end=request.tripEndSafety,button=document.getElementById('driverCompleteTrip');
        if(!end)return;
        const expired=end.expiresAt<=Date.now()&&!request.tripCompletion;
        const status=expired?'expired':end.status;
        const panel=document.createElement('section');panel.dataset.earlyEnd='true';panel.className='trip-end-safety';
        panel.setAttribute('role','status');
        const message=status==='pending'?'Waiting for passenger confirmation. Your trip is still active.':
            status==='approved'?'All passengers agreed to end the trip here. Finishing the trip…':
            status==='declined'?'A passenger chose to keep the trip active. Continue to the destination.':
            status==='expired'?'The confirmation request expired. The trip is still active.':'The end-trip request was withdrawn. The trip is still active.';
        panel.innerHTML='<strong>End trip safety check</strong><p>'+ASIYE_DRIVER.ui.escape(message)+'</p>'+
            (status==='pending'?'<button type="button" data-withdraw-early-end class="driver-btn driver-btn-secondary">Keep trip active</button>':'');
        if(button)button.before(panel);else container.prepend(panel);
        if(button){button.disabled=status==='pending';if(status==='approved')button.textContent='Finish agreed early end';}
        panel.querySelector('[data-withdraw-early-end]')?.addEventListener('click',async event=>{
            event.currentTarget.disabled=true;
            try{await this.goAction('withdrawEarlyEnd',{endRequestId:end.id});}
            catch(error){ASIYE_DRIVER.ui.toast(error.message,'danger');if(event.currentTarget)event.currentTarget.disabled=false;}
        });
        const key=this.requestId+':'+end.id;
        if(status==='approved'&&this._earlyEndAttempt!==key){
            this._earlyEndAttempt=key;
            void this.completeTrip({endRequestId:end.id}).catch(error=>
                ASIYE_DRIVER.ui.toast(error.message||'Unable to finish. Tap Finish agreed early end to retry.','danger'));
        }
        if(['pending','approved'].includes(status)&&end.expiresAt>Date.now()){
            const id=this.requestId;
            this._earlyEndTimer=setTimeout(()=>{if(this.requestId===id)this.renderEarlyEnd(this.request);},end.expiresAt-Date.now()+50);
        }
    },

    async completeTrip(options = {}) {
        if(this._finishing)return;
        this._finishing=true;
        try{return await this.finishConfirmedTrip(options);}finally{this._finishing=false;}
    },

    async finishConfirmedTrip(options = {}) {
        if (this.request?.clubSecurityVersion === 2) { await this.settleSelectedPayments(options); await window.ClubLive.driverAction('complete',options); await this.releaseDriver(); return; }


        if (
            !this.requestId ||
            !this.request
        ) {

            return;
        }


        const request =
            this.request;


        try {
            if (request.goContinuationVersion === 2 && String(request.paymentMethod).toLowerCase() === 'cash')
                await this.goAction('collectCash', {cashCollected: true,endRequestId:options.endRequestId});
            const settlementResult = await this.settleSelectedPayments(options);
            if (request.parcelSecurityVersion === 2) {
                await this.parcelAction('complete');
                ASIYE_DRIVER.ui.closePassengerPin?.();
                await this.releaseDriver();
                return;
            }
            if (settlementResult?.serverCompleted === true) {
                ASIYE_DRIVER.ui.closePassengerPin?.();
                await this.releaseDriver();
                return;
            }
        } catch (error) {
            ASIYE_DRIVER.ui
                ?.toast?.(
                    error?.message ||
                    'Unable to settle the passenger payment.',
                    'danger'
                );

            throw error;
        }


        const activeClubPassengers =
            request.type === 'club'
                ? Object.values(request.passengers || {})
                    .filter(passenger =>
                        ![
                            'cancelled',
                            'cancelled_by_commuter',
                            'cancelled_by_driver',
                            'cancelled_by_admin',
                            'rejected'
                        ].includes(passenger?.status)
                    ).length
                : 1;


        const grossFare =
            Math.max(
                0,
                Number(
                    request.type === 'club'
                        ? (
                            request.driverGrossFare ||
                            (
                                Number(request.pricePerPassenger || 0) *
                                activeClubPassengers
                            ) ||
                            request.totalPoolFare ||
                            request.calculatedPrice ||
                            0
                        )
                        : (
                            request.agreedFare ||
                            request.finalAmount ||
                            request.calculatedPrice ||
                            0
                        )
                )
            );


        const commissionRate =
            0.20;


        const platformCommission =
            Math.round(
                grossFare *
                commissionRate *
                100
            ) / 100;


        const driverNetFare =
            Math.round(
                (
                    grossFare -
                    platformCommission
                ) *
                100
            ) / 100;

        // Card-paid portions already deliver the Asiye 20% through the
        // server-managed card settlement. Do not add that same fee to the
        // driver's commission debt again.
        const cardGross = request.type === 'club'
            ? Object.values(request.passengers || {})
                .filter(passenger => ![
                    'cancelled','cancelled_by_commuter','cancelled_by_driver',
                    'cancelled_by_admin','rejected'
                ].includes(passenger?.status) &&
                String(passenger?.paymentMethod || request.paymentMethod).toLowerCase() === 'card')
                .reduce((sum, passenger) => {
                    const amount = Number(passenger.price || request.pricePerPassenger || 0);
                    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
                }, 0)
            : String(request.paymentMethod || '').toLowerCase() === 'card'
                ? grossFare : 0;
        const alreadyWithheldCommission = Math.min(
            platformCommission, Math.round(Math.min(grossFare, cardGross) * 20) / 100
        );
        const additionalCommissionDebt = Math.max(
            0, Math.round((platformCommission - alreadyWithheldCommission) * 100) / 100
        );


        const settlementId =
            `${this.requestId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;


        const settlementRef =
            this.requestRef.child(
                'driverSettlement'
            );


        const settlementResult =
            await settlementRef.transaction(
                current => {

                    if (current) {
                        return;
                    }

                    return {
                        settlementId,
                        grossFare,
                        commissionRate,
                        platformCommission,
                        driverNetFare,
                        createdAt:
                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP
                    };
                }
            );


        const settlement =
            settlementResult.snapshot.val() ||
            {
                grossFare,
                commissionRate,
                platformCommission,
                driverNetFare
            };


        const settlementCreated =
            settlement.settlementId ===
            settlementId;


        if (
            settlementCreated &&
            request.taxiId
        ) {

            await firebase
                .database()
                .ref(
                    `taxis/${request.taxiId}`
                )
                .transaction(
                    driver => {

                        if (!driver) {
                            return driver;
                        }

                        driver.totalTrips =
                            Number(
                                driver.totalTrips ||
                                0
                            ) + 1;

                        driver.grossEarnings =
                            Math.round(
                                (
                                    Number(driver.grossEarnings || 0) +
                                    Number(settlement.grossFare || 0)
                                ) *
                                100
                            ) / 100;

                        driver.totalEarnings =
                            Math.round(
                                (
                                    Number(driver.totalEarnings || 0) +
                                    Number(settlement.driverNetFare || 0)
                                ) *
                                100
                            ) / 100;

                        driver.netEarnings =
                            driver.totalEarnings;

                        driver.commissionAccrued =
                            Math.round(
                                (
                                    Number(driver.commissionAccrued || 0) +
                                    Number(settlement.platformCommission || 0)
                                ) *
                                100
                            ) / 100;

                        driver.commissionDebt =
                            Math.round(
                                (
                                    Number(driver.commissionDebt || 0) +
                                    Number(additionalCommissionDebt || 0)
                                ) *
                                100
                            ) / 100;

                        driver.lastTripGross =
                            Number(settlement.grossFare || 0);

                        driver.lastTripCommission =
                            Number(settlement.platformCommission || 0);

                        driver.lastTripNet =
                            Number(settlement.driverNetFare || 0);

                        return driver;
                    }
                );
        }


        const updates = {

            status:
                'completed',

            commissionRate:
                Number(settlement.commissionRate || commissionRate),

            driverGrossFare:
                Number(settlement.grossFare || grossFare),

            platformCommission:
                Number(settlement.platformCommission || platformCommission),

            driverNetFare:
                Number(settlement.driverNetFare || driverNetFare),

            commissionApplied:
                true,

            completedAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };


        /*
         * Mark each active Club passenger complete.
         */

        if (
            request.type ===
                'club' &&
            request.passengers
        ) {

            Object.entries(
                request.passengers
            )
            .forEach(
                ([id, passenger]) => {

                    if (
                        ![
                            'cancelled_by_commuter',
                            'cancelled_by_driver'
                        ]
                        .includes(
                            passenger.status
                        )
                    ) {

                        updates[
                            `passengers/${id}/status`
                        ] =
                            'completed';


                        updates[
                            `passengers/${id}/completedAt`
                        ] =
                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP;
                    }
                }
            );
        }


        await this.requestRef.update(
            updates
        );


        if (
            request.type ===
            'delivery'
        ) {
            await firebase
                .database()
                .ref(
                    `delivery_requests/${this.requestId}`
                )
                .update(
                    updates
                )
                .catch(
                    () => {}
                );
        }


        /*
         * Notifications.
         */

        if (
            request.type ===
            'club'
        ) {

            await this.notifyAllClubPassengers(

                request,

                {

                    type:
                        'ride_completed',

                    title:
                        'Trip completed',

                    message:
                        'Your Asiye Club trip is complete.',

                    amount:
                        request.pricePerPassenger ||
                        0
                }
            );


        } else if (
            request.commuterId
        ) {

            await this.notifyPassenger(

                request.commuterId,

                {

                    type:
                        'ride_completed',

                    title:
                        'Trip completed',

                    message:
                        request.tripCompletion?.mode==='agreed_early_end'?'Your trip ended here with your agreement.':'You have arrived at your destination.',

                    amount:

                        request.finalAmount ||
                        request.calculatedPrice ||
                        0,

                    requestId:
                        this.requestId
                }
            );
        }


        await this.releaseDriver();
    },


    renderCompleted(
        request
    ) {
        ASIYE_DRIVER.ui.closePassengerPin?.();

        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showTripCompleted ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showTripCompleted(
                    request
                );
        }
    },


    /* ========================================================
       DRIVER CANCEL
       ======================================================== */

    async cancelTrip(
        reason = ''
    ) {
        if (this.request?.clubSecurityVersion === 2) { await window.ClubLive.driverAction('cancelDriver'); await this.releaseDriver(); return true; }
        if (this.request?.parcelSecurityVersion === 2) {
            const result = await ASIYE_DRIVER.requests.postNegotiation(
                'cancelParcelBookingSecure',{requestId:this.requestId}
            );
            if (result.ok) {
                await this.releaseDriver();
                this.cleanup();
            }
            return Boolean(result.ok);
        }
        if (this.request && this.request.type !== 'club') {
            await this.goAction('cancel');
            await this.releaseDriver();
            this.cleanup();
            return true;
        }



        if (
            !this.requestId ||
            !this.request
        ) {

            return false;
        }


        if (
            [
                'arrived',
                'passenger_onboard',
                'all_onboard',
                'in_transit',
                'completed'
            ].includes(
                String(
                    this.request.status ||
                    ''
                )
            )
        ) {

            ASIYE_DRIVER.ui
                ?.toast?.(
                    'This trip has already started and can no longer be cancelled.',
                    'danger'
                );

            return false;
        }


        const cancellationPatch = {

            status:
                'cancelled_by_driver',

            cancellationReason:
                reason || '',

            cancelledAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };


        await this.requestRef.update(
            cancellationPatch
        );


        if (
            this.request.type ===
            'delivery'
        ) {
            await firebase
                .database()
                .ref(
                    `delivery_requests/${this.requestId}`
                )
                .update(
                    cancellationPatch
                )
                .catch(
                    () => {}
                );
        }


        if (
            this.request.type ===
            'club'
        ) {

            await this.notifyAllClubPassengers(

                this.request,

                {

                    type:
                        'ride_cancelled',

                    title:
                        'Driver cancelled',

                    message:
                        'Your Club driver cancelled this trip.'
                }
            );


        } else if (
            this.request.commuterId
        ) {

            await this.notifyPassenger(

                this.request.commuterId,

                {

                    type:
                        'ride_cancelled',

                    title:
                        'Driver cancelled',

                    message:
                        'Your driver cancelled the ride.',

                    requestId:
                        this.requestId
                }
            );
        }


        await this.releaseDriver();

        return true;
    },


    /* ========================================================
       PASSENGER CANCELLED
       ======================================================== */

    async handleCancelled(
        request
    ) {

        /*
         * Club may still continue if only
         * one passenger cancelled.
         */

        if (
            request.type ===
                'club' &&
            request.passengers
        ) {

            const active =

                this.getActiveClubPassengers(
                    request
                );


            if (
                active.length >
                0
            ) {

                /*
                 * Keep driver assigned.
                 */

                return;
            }
        }


        await this.releaseDriver();
    },


    /* ========================================================
       RELEASE DRIVER

       Called when a trip completes or is cancelled.

       Order matters:
       1. Clear the driver's current trip
       2. Promote the next queued passenger if any
       3. Only reopen general broadcasting if no queue
       ======================================================== */

    async releaseDriver() {

        const driverId =
            ASIYE_DRIVER.state
                ?.driverId;


        if (!driverId) {

            return;
        }


        /* ====================================================
           STEP 1 — Clear the current trip
           ==================================================== */

        await firebase
            .database()
            .ref(
                `taxis/${driverId}`
            )
            .update({

                currentRequest:
                    null,

                isFull:
                    false,

                passengerCount:
                    0,

                updatedAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


        ASIYE_DRIVER.state
            .availability
            .currentRequest =
            null;


        ASIYE_DRIVER.state
            .availability
            .isFull =
            false;


        if (
            ASIYE_DRIVER.state.driver
        ) {

            ASIYE_DRIVER.state
                .driver.currentRequest =
                null;


            ASIYE_DRIVER.state
                .driver.isFull =
                false;


            ASIYE_DRIVER.state
                .driver.passengerCount =
                0;
        }


        /* ====================================================
           STEP 2 — Give reserved passengers their turn
           ==================================================== */

        const queuedRequestId =

            await ASIYE_DRIVER
                .requests
                ?.promoteNextQueuedRequest?.();


        /* ====================================================
           STEP 3 — Reopen broadcasting only if queue empty
           ==================================================== */

        const broadcasting =
            !queuedRequestId;


        await firebase
            .database()
            .ref(
                `taxis/${driverId}`
            )
            .update({

                isBroadcasting:
                    broadcasting
            });


        ASIYE_DRIVER.state
            .availability
            .isBroadcasting =
            broadcasting;


        if (
            ASIYE_DRIVER.state.driver
        ) {

            ASIYE_DRIVER.state
                .driver.isBroadcasting =
                broadcasting;
        }


        /* ====================================================
           STEP 4 — Reset local trip state and UI
           ==================================================== */

        localStorage.removeItem(
            'currentRequestId'
        );


        this.stop();


        this.requestId =
            null;


        this.request =
            null;


        this.currentPassengerId =
            null;


        ASIYE_DRIVER.map
            ?.clearRoute?.();


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showDashboard ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showDashboard();
        }
    },


    /* ========================================================
       ROUTING HELPERS
       ======================================================== */

    routeToPassenger(
        request
    ) {

        const lat =

            Number(
                request
                    .commuterLocation
                    ?.latitude
            );


        const lng =

            Number(
                request
                    .commuterLocation
                    ?.longitude
            );


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {

            return;
        }


        if (
            ASIYE_DRIVER.map &&
            typeof ASIYE_DRIVER.map
                .routeTo ===
                'function'
        ) {

            ASIYE_DRIVER.map.routeTo({

                latitude:
                    lat,

                longitude:
                    lng,

                label:
                    request.commuterName ||
                    'Passenger',

                type:
                    'pickup'
            });
        }
    },


    routeToClubPassenger(
        passenger
    ) {

        const lat =

            Number(
                passenger.pickupLat
            );


        const lng =

            Number(
                passenger.pickupLng
            );


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {

            return;
        }


        ASIYE_DRIVER.map
            ?.routeTo?.({

                latitude:
                    lat,

                longitude:
                    lng,

                label:

                    passenger.name ||
                    passenger.commuterName ||
                    'Passenger',

                type:
                    'pickup'
            });
    },


    routeToDestination(
        request
    ) {

        const coords =
            request.destinationCoords ||
            {};


        const lat =

            Number(
                coords.latitude
            );


        const lng =

            Number(
                coords.longitude
            );


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {

            return;
        }


        ASIYE_DRIVER.map
            ?.routeTo?.({

                latitude:
                    lat,

                longitude:
                    lng,

                label:
                    request.destination ||
                    'Destination',

                type:
                    'dropoff'
            });
    },


    /* ========================================================
       NOTIFICATIONS
       ======================================================== */

    async notifyPassenger(
        commuterId,
        notification
    ) {

        if (!commuterId) {

            return;
        }


        await firebase
            .database()
            .ref(
                `notifications/commuters/${commuterId}`
            )
            .push({

                ...notification,

                timestamp:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });
    },


    async notifyAllClubPassengers(
        request,
        notification
    ) {

        if (
            !request?.passengers
        ) {

            return;
        }


        const jobs =
            [];


        Object.entries(
            request.passengers
        )
        .forEach(
            ([id, passenger]) => {

                if (
                    passenger.status ===
                    'cancelled_by_commuter'
                ) {

                    return;
                }


                jobs.push(

                    this.notifyPassenger(

                        id,

                        {

                            ...notification,

                            requestId:
                                this.requestId,

                            isClub:
                                true
                        }
                    )
                );
            }
        );


        await Promise.all(
            jobs
        );
    },


    /* ========================================================
       CLUB HELPERS
       ======================================================== */

    getClubProgress(
        request
    ) {

        const capacity =

            Number(

                request.effectiveRequiredPassengers ||

                request.requiredPassengers ||

                request.minimumPassengers ||

                request.capacity ||

                request.maxCapacity ||

                (
                    request.clubMode ===
                    'club7'
                    ? 4
                    : 3
                )
            );


        const active =

            this.getActiveClubPassengers(
                request
            );


        return {

            confirmed:
                active.length,

            capacity:
                capacity,

            remaining:

                Math.max(

                    0,

                    capacity -
                    active.length
                ),

            ready:

                active.length >=
                capacity
        };
    },


    getActiveClubPassengers(
        request
    ) {

        return Object
            .entries(
                request.passengers ||
                {}
            )
            .filter(
                ([id, passenger]) =>

                    ![
                        'cancelled_by_commuter',
                        'cancelled_by_driver',
                        'cancelled_by_admin',
                        'rejected'
                    ]
                    .includes(
                        passenger.status
                    )
            )
            .map(
                ([id, passenger]) => ({

                    id,
                    ...passenger
                })
            );
    },


    getPendingClubPassengers(
        request
    ) {

        return this
            .getActiveClubPassengers(
                request
            )
            .filter(
                passenger =>

                    ![
                        'passenger_onboard',
                        'in_transit',
                        'completed'
                    ]
                    .includes(
                        passenger.status
                    )
            );
    },


    /* ========================================================
       DRIVER LOCATION
       ======================================================== */

    getDriverLocation() {

        const driver =
            ASIYE_DRIVER.state
                ?.driver ||
            {};


        const lat =
            Number(
                driver.latitude
            );


        const lng =
            Number(
                driver.longitude
            );


        if (
            Number.isFinite(lat) &&
            Number.isFinite(lng)
        ) {

            return {
                lat,
                lng
            };
        }


        return null;
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

            2 *
            R *
            Math.atan2(

                Math.sqrt(a),

                Math.sqrt(1 - a)
            )
        );
    },


    /* ========================================================
       STOP
       ======================================================== */

    stop() {
        this._generation = (this._generation || 0) + 1;

        ASIYE_DRIVER.navigator?.stop();

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
    },


    cleanup() {

        this.stop();


        this.requestId =
            null;


        this.request =
            null;


        this.currentPassengerId =
            null;
    }

};

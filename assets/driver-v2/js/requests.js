/* ============================================================
   ASIYE DRIVER V2
   REQUEST SERVICE

   Responsibilities:
   - Listen for incoming passenger requests
   - Load request details
   - Validate driver availability
   - Accept Go / Club safely with Firebase transactions
   - Decline notifications
   - Restore pending request queue
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};


ASIYE_DRIVER.requests = {

    notificationRef:
        null,

    notificationListener:
        null,

    activeNotificationKey:
        null,

    activeRequest:
        null,

    incomingRef: null,
    incomingListener: null,
    incomingSignature: '',

    stopIncomingWatch() {
        if (this.incomingRef && this.incomingListener) this.incomingRef.off('value', this.incomingListener);
        this.incomingRef = null;
        this.incomingListener = null;
        this.incomingSignature = '';
    },

    watchIncomingRequest(requestId, initial) {
        this.stopIncomingWatch();
        const signature = request => JSON.stringify([
            request?.status, request?.taxiId, request?.fareStatus, request?.passengerOffer,
            request?.agreedFare, request?.driverCounterFare, request?.negotiationRound,
            request?.driverCounterCount, request?.counterExpiresAt,
            request?.fareCounterDeclinedDrivers?.[ASIYE_DRIVER.state.driverId],
            request?.fareOfferDeclinedDrivers?.[ASIYE_DRIVER.state.driverId]?.offerRound
        ]);
        this.incomingSignature = signature(initial);
        const ref = firebase.database().ref(`requests/${requestId}`);
        this.incomingRef = ref;
        this.incomingListener = ref.on('value', snapshot => {
            if (this.incomingRef !== ref || ASIYE_DRIVER.state?.loggingOut) return;
            const request = snapshot.val();
            const next = signature(request);
            if (next === this.incomingSignature) return;
            this.incomingSignature = next;
            if (!request || !this.isRequestAvailable(request)) {
                this.stopIncomingWatch();
                ASIYE_DRIVER.ui?.closeIncomingRequest?.();
                this.removeNotification(this.activeNotificationKey);
                this.activeRequest = null;
                ASIYE_DRIVER.state.incomingRequest = null;
                if (request?.taxiId === ASIYE_DRIVER.state.driverId && request.fareStatus === 'agreed' &&
                    ASIYE_DRIVER.trip?.requestId !== requestId) ASIYE_DRIVER.trip?.start?.(requestId);
                return;
            }
            request.key = requestId;
            request.requestId = requestId;
            this.activeRequest = request;
            ASIYE_DRIVER.state.incomingRequest = request;
            ASIYE_DRIVER.ui?.showIncomingRequest?.(request);
        }, () => {
            this.stopIncomingWatch();
            ASIYE_DRIVER.ui?.closeIncomingRequest?.();
        });
    },


    async postNegotiation(
        endpoint,
        body
    ) {

        const user =
            firebase.auth()
                .currentUser;


        if (!user) {
            throw new Error(
                'Please sign in again before negotiating this fare.'
            );
        }


        const token =
            await user.getIdToken(
                true
            );


        const response =
            await fetch(
                `https://us-central1-asiye-80386.cloudfunctions.net/${endpoint}`,
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
                        JSON.stringify(
                            body ||
                            {}
                        )
                }
            );


        const payload =
            await response
                .json()
                .catch(
                    () => ({})
                );


        if (!response.ok) {
            throw new Error(
                payload.error ||
                'Fare negotiation could not be completed.'
            );
        }


        return payload;
    },


    async counterFare(
        amount,
        requestId = null
    ) {

        const id =
            requestId ||
            this.activeRequest
                ?.requestId ||
            this.activeRequest
                ?.key;


        if (!id) {
            throw new Error(
                'Missing ride request.'
            );
        }


        const result =
            await this.postNegotiation(
                'counterGoFare',
                {
                    requestId:
                        id,

                    ...(this.activeRequest?.requestId === id || this.activeRequest?.key === id ? {
                        passengerOffer: this.activeRequest.passengerOffer,
                        negotiationRound: this.activeRequest.negotiationRound
                    } : {}),

                    amount:
                        Math.round(
                            Number(
                                amount
                            )
                        )
                }
            );


        ASIYE_DRIVER.ui
            ?.toast?.(
                `Counter R${Number(
                    result.counterFare ||
                    amount
                ).toFixed(0)} sent to the passenger.`
            );


        return result;
    },


    /* ========================================================
       START REQUEST SYSTEM
       ======================================================== */

    start() {

        if (ASIYE_DRIVER.state?.loggingOut) return;

        const driverId =
            ASIYE_DRIVER.state?.driverId;


        if (!driverId) {

            console.warn(
                'Driver request service waiting for driver ID.'
            );

            return;
        }


        this.stop();


        console.log(
            '🚕 Starting Asiye Driver request service'
        );


        this.listenToNotifications(
            driverId
        );


        /*
         * Fallback:
         * check for an existing current request.
         */

        this.restoreActiveRequest();
    },


    /* ========================================================
       LISTEN TO DRIVER NOTIFICATIONS
       ======================================================== */

    listenToNotifications(
        driverId
    ) {

        this.notificationRef =

            firebase
                .database()
                .ref(
                    `notifications/taxis/${driverId}`
                );


        this.notificationListener =

            this.notificationRef.on(

                'child_added',

                async snapshot => {

                    const notification =
                        snapshot.val();


                    if (!notification) {

                        return;
                    }


                    const requestId =

                        notification.requestId ||
                        notification.requestKey;


                    if (notification.type === 'club_waiting_sync' && requestId) {
                        const assigned = (await firebase.database().ref(`requests/${requestId}`).once('value')).val();
                        if (assigned?.clubSecurityVersion === 2 && assigned.taxiId === ASIYE_DRIVER.state.driverId) {
                            ASIYE_DRIVER.trip.start(requestId);
                            ASIYE_DRIVER.ui?.toast?.(notification.message, 'club');
                        }
                        await this.removeNotification(snapshot.key);
                        return;
                    }

                    /*
                     * Privacy-safe Asiye Work area alert.
                     *
                     * IMPORTANT: never load requests/{requestId} here. The
                     * backend deliberately sends no requestId or trip details
                     * until the passenger group is ready.
                     */
                    if (
                        notification.type ===
                            'club_area_alert'
                    ) {

                        const timestamp =
                            Number(
                                notification.timestamp ||
                                0
                            );


                        if (
                            timestamp &&
                            Date.now() -
                                timestamp >
                                10 *
                                60 *
                                1000
                        ) {

                            return;
                        }


                        ASIYE_DRIVER.ui
                            ?.toast?.(
                                notification.message ||
                                'An Asiye Work booking is forming near your area. Details will unlock when the group is ready.',
                                'club'
                            );


                        window.dispatchEvent(
                            new CustomEvent(
                                'asiye-driver-work-area-alert',
                                {
                                    detail: {
                                        title:
                                            notification.title ||
                                            'Asiye Work · Area booking',

                                        message:
                                            notification.message ||
                                            'A shared Work booking is forming near you.',

                                        requiredPassengers:
                                            Number(
                                                notification.requiredPassengers ||
                                                0
                                            )
                                    }
                                }
                            )
                        );


                        return;
                    }


                    /*
                     * Fare negotiation assignment.
                     * The passenger may have accepted a driver counter after
                     * the original request overlay closed. This notification
                     * moves the now-reserved driver into the live trip state.
                     */
                    if (
                        notification.type ===
                            'go_fare_agreed_driver' &&
                        requestId
                    ) {

                        const requestSnapshot =
                            await firebase
                                .database()
                                .ref(
                                    `requests/${requestId}`
                                )
                                .once(
                                    'value'
                                );


                        const assigned =
                            requestSnapshot.val();


                        if (
                            assigned &&
                            assigned.fareStatus ===
                                'agreed'
                        ) {

                            assigned.requestId =
                                requestId;


                            this.activeRequest =
                                assigned;


                            ASIYE_DRIVER.state
                                .incomingRequest =
                                null;


                            ASIYE_DRIVER.ui
                                ?.closeIncomingRequest?.();


                            ASIYE_DRIVER.trip
                                ?.start?.(
                                    requestId
                                );


                            const passengerReady =
                                notification.ready ===
                                    true ||
                                (
                                    assigned.status ===
                                        'accepted' &&
                                    assigned.paymentsReady ===
                                        true
                                );


                            ASIYE_DRIVER.ui
                                ?.toast?.(
                                    passengerReady
                                        ? `Passenger ready at R${Number(
                                            assigned.agreedFare ||
                                            notification.agreedFare ||
                                            0
                                        ).toFixed(0)}. Payment and safety checks are complete — start pickup when ready.`
                                        : `Fare R${Number(
                                            assigned.agreedFare ||
                                            notification.agreedFare ||
                                            0
                                        ).toFixed(0)} agreed. Waiting for passenger payment confirmation.`
                                );
                        }


                        await this.removeNotification(
                            snapshot.key
                        );


                        return;
                    }


                    /*
                     * Ignore non-booking notifications.
                     */

                    const bookingTypes = [

                        'ride_request',
                        'passenger',
                        'club',
                        'club_request',
                        'request'
                    ];


                    if (
                        !bookingTypes.includes(
                            notification.type
                        )
                    ) {

                        return;
                    }


                    if (!requestId) {

                        console.warn(
                            'Booking notification missing requestId'
                        );

                        return;
                    }


                    /*
                     * Driver must be available.
                     */

                    if (
                        !this.isDriverAvailable()
                    ) {

                        /*
                         * Do not leave an actionable notification stranded
                         * while this driver is offline, not broadcasting or
                         * awaiting vehicle approval. Removing it lets a later
                         * server dispatch recreate the same request key once
                         * the driver genuinely becomes available.
                         */
                        await this.removeNotification(
                            snapshot.key
                        );


                        return;
                    }


                    this.activeNotificationKey =
                        snapshot.key;


                    await this.loadIncomingRequest(

                        requestId,

                        snapshot.key
                    );
                }
            );
    },


    /* ========================================================
       LOAD REQUEST
       ======================================================== */

    async loadIncomingRequest(
        requestId,
        notificationKey = null
    ) {

        if (ASIYE_DRIVER.state?.loggingOut) return;

        try {

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

            if (ASIYE_DRIVER.state?.loggingOut) return;


            if (!request) {

                /*
                 * Request was removed/cancelled.
                 */

                await this.removeNotification(
                    notificationKey
                );

                return;
            }


            request.key =
                requestId;

            request.requestId = requestId;


            if (
                !this.isRequestAvailable(
                    request
                )
            ) {

                await this.removeNotification(
                    notificationKey
                );

                return;
            }


            this.activeRequest =
                request;


            ASIYE_DRIVER.state
                .incomingRequest =
                request;


            /*
             * Display through driver UI.
             */

            if (
                ASIYE_DRIVER.ui &&
                typeof ASIYE_DRIVER.ui
                    .showIncomingRequest ===
                    'function'
            ) {

                ASIYE_DRIVER.ui
                    .showIncomingRequest(
                        request
                    );


            } else {

                /*
                 * Allows us to build the UI later
                 * without changing this service.
                 */

                window.dispatchEvent(

                    new CustomEvent(
                        'asiye-driver-request',
                        {
                            detail:
                                request
                        }
                    )
                );
            }


            this.watchIncomingRequest(requestId, request);
            this.playRequestSound();


        } catch (error) {

            console.error(
                'Failed loading incoming request:',
                error
            );
        }
    },


    /* ========================================================
       DRIVER AVAILABILITY
       ======================================================== */

    isDriverAvailable() {

        if (!window.AsiyeDriverBanking?.isReady()) return false;
        if (ASIYE_DRIVER.state?.loggingOut) return false;

        const driver =
            ASIYE_DRIVER.state
                ?.driver ||
            {};


        if (
            driver.isOnline !== true ||
            driver.isBroadcasting !== true
        ) {

            return false;
        }


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui.hasApprovedVehicle ===
                'function' &&
            !ASIYE_DRIVER.ui.hasApprovedVehicle(driver)
        ) {

            return false;
        }


        /*
         * Already driving another booking.
         */

        if (
            driver.currentRequest
        ) {

            return false;
        }


        if (
            driver.isFull === true
        ) {

            return false;
        }


        return true;
    },


    /* ========================================================
       REQUEST AVAILABILITY
       ======================================================== */

    isRequestAvailable(
        request
    ) {

        const driverId = ASIYE_DRIVER.state.driverId;
        if (request.fareCounterDeclinedDrivers?.[driverId] === true ||
            request.fareOfferDeclinedDrivers?.[driverId]?.offerRound === Number(request.passengerOfferRound || 1)) return false;

        const status =
            String(
                request.status ||
                ''
            )
            .toLowerCase();


        const allowedStatuses = [

            'pending',

            'searching',

            'pooling',

            'waiting_members',

            'pool_ready'
        ];


        if (
            !allowedStatuses.includes(
                status
            )
        ) {

            return false;
        }


        const isClub =
            request.type ===
                'club' ||
            request.rideType ===
                'club4' ||
            request.rideType ===
                'club7';


        /*
         * A forming Work pool is NEVER an actionable request. Drivers may
         * receive the generic area alert, but full request data and Accept
         * remain locked until the pool and all passenger payments are ready.
         */
        if (
            isClub &&
            (
                request.poolReady !==
                    true ||
                request.paymentsReady !==
                    true ||
                status !==
                    'pool_ready'
            )
        ) {

            return false;
        }


        /*
         * Another driver already claimed it.
         */

        if (
            request.taxiId &&
            request.taxiId !==
                ASIYE_DRIVER.state.driverId
        ) {

            return false;
        }


        return true;
    },


    /* ========================================================
       ACCEPT REQUEST

       Rules:
       - One active trip per driver
       - One accepted driver per booking
       - Repeated Accept by same driver is safe
       - A queued booking may only be accepted by its
         reserved driver
       ======================================================== */

    async accept(requestId = null) {

        const displayedOffer = Number(this.activeRequest?.passengerOffer);

        if (!await AsiyeEnrollment.requireApproval()) return;
        if (!await window.AsiyeDriverBanking.require()) return;

        const driverId =
            ASIYE_DRIVER.state
                ?.driverId;


        const authUser =
            firebase.auth()
                .currentUser;


        const authUid =

            authUser?.uid ||

            localStorage.getItem(
                'authUid'
            );


        const driver =
            ASIYE_DRIVER.state
                ?.driver ||
            {};


        const id =

            requestId ||

            ASIYE_DRIVER.state
                ?.incomingRequest
                ?.requestId ||

            ASIYE_DRIVER.state
                ?.incomingRequest
                ?.key ||

            this.activeRequest
                ?.requestId ||

            this.activeRequest
                ?.key;


        if (
            !driverId ||
            !id
        ) {

            throw new Error(
                'Missing driver or request.'
            );
        }


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui.hasApprovedVehicle ===
                'function' &&
            !ASIYE_DRIVER.ui.hasApprovedVehicle(driver)
        ) {
            throw new Error(
                'Complete your approved selfie, car photo, phone and vehicle details before accepting bookings.'
            );
        }


        console.log(
            '🚕 Attempting request acceptance:',
            {
                requestId:
                    id,

                driverId:
                    driverId,

                authUid:
                    authUid
            }
        );


        const requestRef =

            firebase
                .database()
                .ref(
                    `requests/${id}`
                );


        const taxiRef =

            firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                );


        const driverCurrentRequestRef =

            taxiRef.child(
                'currentRequest'
            );


        const requestTaxiRef =

            requestRef.child(
                'taxiId'
            );


        /*
         * IDs that represent this same driver.
         *
         * Legacy driver profile ID and Firebase Auth UID
         * can differ.
         */

        const validDriverIds =

            new Set(
                [
                    driverId,

                    authUid,

                    driver.authUid
                ]
                .filter(Boolean)
            );


        /* ========================================================
           STEP 1
           LOAD FRESH REQUEST
           ======================================================== */

        const freshSnapshot =

            await requestRef.once(
                'value'
            );


        if (
            !freshSnapshot.exists()
        ) {

            throw new Error(
                'This booking no longer exists.'
            );
        }


        const freshRequest =
            freshSnapshot.val();


        console.log(
            '🔎 Accept pre-check:',
            {
                requestId:
                    id,

                status:
                    freshRequest.status,

                taxiId:
                    freshRequest.taxiId,

                queuedTaxiId:
                    freshRequest.queuedTaxiId,

                driverId:
                    driverId
            }
        );


        if (freshRequest.type === 'delivery' &&
            freshRequest.parcelSecurityVersion === 2) {
            // Firebase client may not claim or change a secure Parcel.
            // The backend atomically checks driver identity, active trip
            // lock, vehicle compliance and the verified Paystack subaccount.
            const result = await this.postNegotiation(
                'acceptParcelRequestSecure', {requestId:id,driverId}
            );
            const updated = (await requestRef.once('value')).val();
            if (!updated || updated.taxiId !== driverId) {
                throw new Error('Server Parcel assignment could not be verified.');
            }
            updated.requestId=id;
            this.activeRequest=updated;
            ASIYE_DRIVER.state.incomingRequest=null;
            await this.removeNotification(this.activeNotificationKey);
            await ASIYE_DRIVER.trip?.start?.(id);
            ASIYE_DRIVER.ui?.toast?.(
                updated.paymentMethod === 'card'
                    ? 'Parcel accepted. Waiting for passenger Paystack payment.'
                    : 'Parcel accepted. Navigate to the pickup.'
            );
            return result;
        }

        const isProtectedGo =
            freshRequest.type !==
                'club' &&
            freshRequest.type !==
                'delivery' &&
            String(
                freshRequest.rideType ||
                'go'
            ) ===
                'go' &&
            freshRequest.negotiationEnabled ===
                true;


        if (
            isProtectedGo &&
            freshRequest.fareStatus ===
                'agreed' &&
            freshRequest.taxiId &&
            validDriverIds.has(
                freshRequest.taxiId
            )
        ) {

            const resumed =
                await this.reconcileAcceptance(
                    id
                );

            if (resumed) {
                return {
                    ok:
                        true,
                    requestId:
                        id,
                    status:
                        resumed.status,
                    agreedFare:
                        resumed.agreedFare ||
                        resumed.finalAmount ||
                        0,
                    resumed:
                        true
                };
            }
        }


        if (
            isProtectedGo &&
            freshRequest.fareStatus ===
                'passenger_offer'
        ) {

            const result =
                await this.postNegotiation(
                    'acceptGoFareOffer',
                    {
                        requestId:
                            id,
                        ...(Number.isFinite(displayedOffer) ? {amount:displayedOffer} : {})
                    }
                );


            const updatedSnapshot =
                await requestRef.once(
                    'value'
                );


            const updated =
                updatedSnapshot.val() ||
                {
                    ...freshRequest,
                    fareStatus:
                        'agreed',
                    agreedFare:
                        result.agreedFare,
                    status:
                        result.status
                };


            updated.requestId =
                id;


            this.activeRequest =
                updated;


            ASIYE_DRIVER.state
                .incomingRequest =
                null;


            await this.removeNotification(
                this.activeNotificationKey
            );


            ASIYE_DRIVER.trip
                ?.start?.(
                    id
                );


            ASIYE_DRIVER.ui
                ?.toast?.(
                    `Fare R${Number(
                        result.agreedFare ||
                        updated.agreedFare ||
                        0
                    ).toFixed(0)} accepted. Waiting for passenger payment confirmation.`
                );


            return result;
        }


        if (
            isProtectedGo &&
            freshRequest.fareStatus ===
                'driver_counter'
        ) {

            throw new Error(
                'Your counter is waiting for the passenger. You cannot accept the original offer at the same time.'
            );
        }


        const freshIsClub =
            freshRequest.type ===
                'club' ||
            freshRequest.rideType ===
                'club4' ||
            freshRequest.rideType ===
                'club7';


        if (
            freshIsClub &&
            (
                freshRequest.poolReady !==
                    true ||
                freshRequest.paymentsReady !==
                    true ||
                freshRequest.status !==
                    'pool_ready'
            )
        ) {

            throw new Error(
                'This Asiye Work group is still forming. Full booking details unlock only when all passengers are ready.'
            );
        }


        /* ========================================================
           STEP 2
           TERMINAL STATUS CHECK
           ======================================================== */

        const terminalStatuses = [

            'completed',

            'cancelled_by_commuter',

            'cancelled_by_driver',

            'cancelled_by_admin',

            'rejected'

        ];


        if (
            terminalStatuses.includes(
                freshRequest.status
            )
        ) {

            throw new Error(
                'This booking is no longer available.'
            );
        }


        /* ========================================================
           STEP 3
           MAKE SURE THIS REQUEST CAN BE ACCEPTED
           ======================================================== */

        const claimableStatuses = [

            'pending',

            'searching',

            'driver_busy',

            'pooling',

            'waiting_members',

            'waiting_pool',

            'pool_ready',

            'driver_waiting'

        ];


        const alreadyMine =

            freshRequest.taxiId &&
            validDriverIds.has(
                freshRequest.taxiId
            );


        if (
            !alreadyMine &&
            !claimableStatuses.includes(
                freshRequest.status
            )
        ) {

            throw new Error(
                `This request cannot be accepted while it is ${freshRequest.status}.`
            );
        }


        /*
         * Another driver already owns it.
         */

        if (
            freshRequest.taxiId &&
            !validDriverIds.has(
                freshRequest.taxiId
            )
        ) {

            throw new Error(
                'Another driver already accepted this request.'
            );
        }


        /*
         * If this booking was explicitly queued for
         * one driver, another driver cannot take it.
         */

        if (
            freshRequest.queuedTaxiId &&
            !validDriverIds.has(
                freshRequest.queuedTaxiId
            )
        ) {

            throw new Error(
                'This booking is reserved for another driver.'
            );
        }


        /* ========================================================
           STEP 4
           LOCK THE DRIVER

           Transaction only currentRequest, NOT whole taxi object.

           null:
           driver is free -> claim it.

           same request:
           repeated button press -> okay.

           different request:
           driver already busy -> reject.
           ======================================================== */

        const driverLock =

            await driverCurrentRequestRef
                .transaction(
                    currentRequest => {

                        /*
                         * Null here means the driver is free.
                         *
                         * Unlike the old whole-request transaction,
                         * null is EXPECTED and valid.
                         */

                        if (
                            currentRequest === null ||
                            currentRequest === undefined ||
                            currentRequest === ''
                        ) {

                            return id;
                        }


                        /*
                         * Same ride = idempotent acceptance.
                         */

                        if (
                            currentRequest === id
                        ) {

                            return id;
                        }


                        /*
                         * Another active ride.
                         *
                         * Abort.
                         */

                        return;
                    }
                );


        if (
            !driverLock.committed
        ) {

            const currentTripSnapshot =

                await driverCurrentRequestRef
                    .once(
                        'value'
                    );


            const currentTrip =
                currentTripSnapshot.val();


            console.warn(
                '🚫 Driver lock rejected:',
                {
                    driverId:
                        driverId,

                    currentRequest:
                        currentTrip,

                    attemptedRequest:
                        id
                }
            );


            throw new Error(
                'Complete your current ride before accepting another booking.'
            );
        }


        /*
         * Remember whether we locked the driver.
         *
         * If request claiming fails, we'll release this
         * reservation safely.
         */

        let requestClaimed =
            false;


        try {

            /* ========================================================
               STEP 5
               CLAIM THE REQUEST

               Transaction ONLY taxiId.

               This fixes the "request missing" issue because
               null here simply means no driver has claimed it.
               ======================================================== */

            const claimResult =

                await requestTaxiRef
                    .transaction(
                        currentTaxiId => {

                            /*
                             * No driver has accepted yet.
                             */

                            if (
                                currentTaxiId === null ||
                                currentTaxiId === undefined ||
                                currentTaxiId === ''
                            ) {

                                return driverId;
                            }


                            /*
                             * Same driver already owns it.
                             */

                            if (
                                validDriverIds.has(
                                    currentTaxiId
                                )
                            ) {

                                return driverId;
                            }


                            /*
                             * Another driver owns it.
                             */

                            return;
                        }
                    );


            if (
                !claimResult.committed
            ) {

                const ownerSnapshot =

                    await requestTaxiRef.once(
                        'value'
                    );


                const ownerId =
                    ownerSnapshot.val();


                console.warn(
                    '🚫 Request taxi lock rejected:',
                    {
                        requestId:
                            id,

                        ownerId:
                            ownerId,

                        myDriverId:
                            driverId
                    }
                );


                if (
                    ownerId &&
                    validDriverIds.has(
                        ownerId
                    )
                ) {

                    /*
                     * Same driver already claimed.
                     */

                    requestClaimed =
                        true;

                } else {

                    throw new Error(
                        'Another driver already accepted this request.'
                    );
                }


            } else {

                requestClaimed =
                    true;
            }


            /* ========================================================
               STEP 6
               RE-READ REQUEST AFTER CLAIM

               Protect against passenger cancelling at the exact
               same moment as driver acceptance.
               ======================================================== */

            const claimedSnapshot =

                await requestRef.once(
                    'value'
                );


            const claimedRequest =
                claimedSnapshot.val();


            if (
                !claimedRequest
            ) {

                throw new Error(
                    'Booking disappeared during acceptance.'
                );
            }


            if (
                terminalStatuses.includes(
                    claimedRequest.status
                )
            ) {

                throw new Error(
                    'Passenger cancelled this booking before acceptance completed.'
                );
            }


            /* ========================================================
               STEP 7
               BUILD DRIVER INFORMATION
               ======================================================== */

            const driverName =

                [
                    driver.name,
                    driver.surname
                ]
                .filter(Boolean)
                .join(' ')
                .trim() ||

                driver.fullName ||

                driver.driverName ||

                'Asiye Driver';


            const driverPhone =

                driver.phone ||

                driver.phoneNumber ||

                '';


            const driverRating =

                Number(
                    driver.rating ||
                    5
                );


            const vehicleReg =

                driver.vehicleReg ||

                driver.registration ||

                driver.taxiRegistrationNumber ||

                driver.registrationNumber ||

                '';


            const vehicleMake =

                driver.vehicleMake ||

                driver.make ||

                '';


            const vehicleModel =

                driver.vehicleModel ||

                driver.model ||

                '';


            const vehicleColor =

                driver.vehicleColor ||

                driver.color ||

                '';


            const vehicleYear =

                Number(
                    driver.vehicleYear ||
                    driver.vehicle?.year ||
                    driver.year ||
                    0
                );


            const driverProfileImageUrl =

                driver.profileImageUrl ||
                driver.profile_picture_url ||
                driver.profilePhotoUrl ||
                '';


            const vehiclePhoto =

                driver.vehiclePhoto ||
                driver.carPhoto ||
                '';


            const vehicleInfo =

                [
                    vehicleColor,
                    vehicleMake,
                    vehicleModel
                ]
                .filter(Boolean)
                .join(' ')
                .trim();


            /* ========================================================
               STEP 8
               DETERMINE GO / CLUB STATUS
               ======================================================== */

            const isClub =

                claimedRequest.type ===
                    'club' ||

                claimedRequest.rideType ===
                    'club4' ||

                claimedRequest.rideType ===
                    'club7';


            let passengerCount =
                1;


            let capacity =
                1;


            let poolReady =
                true;


            if (isClub) {

                const passengers =

                    claimedRequest.passengers ||
                    {};


                passengerCount =

                    Object.values(
                        passengers
                    )
                    .filter(
                        passenger => {

                            return ![
                                'cancelled',
                                'cancelled_by_commuter',
                                'cancelled_by_driver',
                                'cancelled_by_admin',
                                'rejected'
                            ]
                            .includes(
                                passenger?.status
                            );
                        }
                    )
                    .length;


                capacity =

                    Number(

                        claimedRequest.capacity ||

                        claimedRequest.maxCapacity ||

                        (
                            claimedRequest.clubMode ===
                                'club7' ||

                            claimedRequest.rideType ===
                                'club7'

                            ? 7

                            : 4
                        )
                    );


                const requiredPassengers =

                    Math.min(
                        capacity,
                        Number(
                            claimedRequest.minimumPassengers ||
                            claimedRequest.requiredPassengers ||
                            (
                                claimedRequest.clubMode ===
                                    'club7' ||
                                claimedRequest.rideType ===
                                    'club7'
                                ? 4
                                : 3
                            )
                        )
                    );


                poolReady =

                    passengerCount >=
                    requiredPassengers;
            }


            const needsDriverCardCheckout =
                !isClub &&
                claimedRequest.type === 'delivery' &&
                String(claimedRequest.paymentMethod || 'cash').toLowerCase() === 'card';
            const nextStatus = isClub
                ? (poolReady ? 'pool_ready' : 'driver_waiting')
                : needsDriverCardCheckout ? 'payment_required' : 'accepted';


            /* ========================================================
               STEP 9
               WRITE ACCEPTANCE DETAILS
               ======================================================== */

            const updates = {

                taxiId:
                    driverId,

                driverAuthUid:
                    authUid ||
                    null,

                driverName:
                    driverName,

                driverPhone:
                    driverPhone,

                driverRating:
                    driverRating,

                vehicleInfo:
                    vehicleInfo,

                vehicleMake:
                    vehicleMake,

                vehicleModel:
                    vehicleModel,

                vehicleColor:
                    vehicleColor,

                vehicleYear:
                    vehicleYear,

                vehicleReg:
                    vehicleReg,

                driverProfileImageUrl:
                    driverProfileImageUrl,

                driverVehiclePhoto:
                    vehiclePhoto,

                vehiclePhoto:
                    vehiclePhoto,

                status:
                    nextStatus,

                ...(needsDriverCardCheckout ? {
                    paymentStatus: 'payment_required',
                    paymentsReady: false
                } : {}),

                acceptedAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP,

                queuedTaxiId:
                    null,

                queuedAt:
                    null,

                queueReady:
                    false,

                driverBusy:
                    false
            };


            if (isClub) {

                updates.poolReady =
                    poolReady;

                updates.passengerCount =
                    passengerCount;

                updates.capacity =
                    capacity;
            }


            await requestRef.update(
                updates
            );


            if (
                claimedRequest.type ===
                'delivery'
            ) {
                await firebase
                    .database()
                    .ref(
                        `delivery_requests/${id}`
                    )
                    .update(
                        updates
                    )
                    .catch(
                        () => {}
                    );
            }


            /* ========================================================
               STEP 10
               UPDATE DRIVER PROFILE
               ======================================================== */

            await taxiRef.update({

                currentRequest:
                    id,

                isBroadcasting:
                    false,

                isFull:

                    isClub

                    ? poolReady

                    : true,

                passengerCount:
                    passengerCount,

                updatedAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


            /*
             * Keep local driver state synchronized too.
             */

            if (
                ASIYE_DRIVER.state.driver
            ) {

                ASIYE_DRIVER.state
                    .driver.currentRequest =
                    id;


                ASIYE_DRIVER.state
                    .driver.isBroadcasting =
                    false;


                ASIYE_DRIVER.state
                    .driver.isFull =

                    isClub

                    ? poolReady

                    : true;
            }


            if (
                ASIYE_DRIVER.state
                    .availability
            ) {

                ASIYE_DRIVER.state
                    .availability
                    .currentRequest =
                    id;


                ASIYE_DRIVER.state
                    .availability
                    .isBroadcasting =
                    false;


                ASIYE_DRIVER.state
                    .availability
                    .isFull =

                    isClub

                    ? poolReady

                    : true;
            }


            localStorage.setItem(
                'currentRequestId',
                id
            );


            /* ========================================================
               STEP 11
               LOAD FINAL ACCEPTED REQUEST
               ======================================================== */

            const finalSnapshot =

                await requestRef.once(
                    'value'
                );


            const accepted =
                finalSnapshot.val();


            if (!accepted) {

                throw new Error(
                    'Accepted booking could not be loaded.'
                );
            }


            accepted.key =
                id;


            accepted.requestId =
                id;


            /* ========================================================
               STEP 12
               NOTIFY PASSENGERS
               ======================================================== */

            const passengerIds =
                [];


            if (
                accepted.passengers
            ) {

                Object.keys(
                    accepted.passengers
                )
                .forEach(
                    passengerId => {

                        if (
                            passengerId &&
                            !passengerIds.includes(
                                passengerId
                            )
                        ) {

                            passengerIds.push(
                                passengerId
                            );
                        }
                    }
                );
            }


            if (
                accepted.commuterId &&
                !passengerIds.includes(
                    accepted.commuterId
                )
            ) {

                passengerIds.push(
                    accepted.commuterId
                );
            }


            await Promise.all(

                passengerIds.map(
                    commuterId =>

                        firebase
                            .database()
                            .ref(
                                `notifications/commuters/${commuterId}`
                            )
                            .push({

                                type:
                                    'request_accepted',

                                requestId:
                                    id,

                                driverId:
                                    driverId,

                                driverAuthUid:
                                    authUid ||
                                    null,

                                driverName:
                                    driverName,

                                driverPhone:
                                    driverPhone,

                                driverRating:
                                    driverRating,

                                vehicleInfo:
                                    vehicleInfo,

                                vehicleMake:
                                    vehicleMake,

                                vehicleModel:
                                    vehicleModel,

                                vehicleColor:
                                    vehicleColor,

                                vehicleYear:
                                    vehicleYear,

                                vehicleReg:
                                    vehicleReg,

                                driverProfileImageUrl:
                                    driverProfileImageUrl,

                                driverVehiclePhoto:
                                    vehiclePhoto,

                                timestamp:

                                    firebase
                                        .database
                                        .ServerValue
                                        .TIMESTAMP
                            })
                )
            );


            /* ========================================================
               STEP 13
               REMOVE ORIGINAL DRIVER NOTIFICATION

               IMPORTANT:
               Notifications may use push IDs rather than requestId.
               ======================================================== */

            if (
                this.activeNotificationKey
            ) {

                await this.removeNotification(
                    this.activeNotificationKey
                )
                .catch(
                    () => {}
                );

            } else {

                /*
                 * Fallback only for notifications that were
                 * written directly under request ID.
                 */

                await firebase
                    .database()
                    .ref(
                        `notifications/taxis/${driverId}/${id}`
                    )
                    .remove()
                    .catch(
                        () => {}
                    );
            }


            /* ========================================================
               STEP 14
               UPDATE LOCAL REQUEST STATE
               ======================================================== */

            this.activeRequest =
                accepted;


            ASIYE_DRIVER.state
                .incomingRequest =
                null;


            ASIYE_DRIVER.state
                .activeRequest =
                accepted;


            if (
                typeof ASIYE_DRIVER
                    .setActiveRequest ===
                    'function'
            ) {

                ASIYE_DRIVER.setActiveRequest(
                    id,
                    accepted
                );
            }


            if (
                typeof ASIYE_DRIVER
                    .setIncomingRequest ===
                    'function'
            ) {

                ASIYE_DRIVER
                    .setIncomingRequest(
                        null
                    );
            }


            /* ========================================================
               STEP 15
               START TRIP CONTROLLER
               ======================================================== */

            if (
                ASIYE_DRIVER.trip &&
                typeof ASIYE_DRIVER.trip
                    .start ===
                    'function'
            ) {

                await ASIYE_DRIVER.trip.start(
                    id
                );
            }


            console.log(
                '✅ Driver accepted request:',
                {
                    requestId:
                        id,

                    driverId:
                        driverId,

                    status:
                        accepted.status,

                    type:
                        accepted.type ||
                        accepted.rideType
                }
            );


            return accepted;


        } catch (error) {

            console.error(
                '❌ Accept request failed:',
                error
            );


            /* ========================================================
               ROLLBACK DRIVER LOCK

               Only clear currentRequest if it still points
               to THIS request.
               ======================================================== */

            if (
                !requestClaimed ||
                error
            ) {

                try {

                    await driverCurrentRequestRef
                        .transaction(
                            currentRequest => {

                                if (
                                    currentRequest ===
                                    id
                                ) {

                                    return null;
                                }


                                return currentRequest;
                            }
                        );

                } catch (rollbackError) {

                    console.warn(
                        'Driver lock rollback failed:',
                        rollbackError
                    );
                }
            }


            /* ========================================================
               ROLLBACK REQUEST CLAIM

               Only release taxiId if THIS driver owns it.
               ======================================================== */

            if (
                requestClaimed
            ) {

                try {

                    await requestTaxiRef
                        .transaction(
                            currentTaxiId => {

                                if (
                                    currentTaxiId &&
                                    validDriverIds.has(
                                        currentTaxiId
                                    )
                                ) {

                                    return null;
                                }


                                return currentTaxiId;
                            }
                        );

                } catch (rollbackError) {

                    console.warn(
                        'Request claim rollback failed:',
                        rollbackError
                    );
                }
            }


            throw error;
        }
    },


    /* ========================================================
       RECONCILE ACCEPTANCE

       Server state is authoritative. This repairs the two failure modes that
       can otherwise leave the driver and passenger on different screens:
       - request belongs to this driver but currentRequest was lost;
       - currentRequest points to this request but the request was never owned.
       ======================================================== */

    async reconcileAcceptance(
        requestId = null,
        strict = false
    ) {

        const driverId =
            ASIYE_DRIVER.state
                ?.driverId;


        const authUid =

            firebase.auth()
                .currentUser
                ?.uid ||

            localStorage.getItem(
                'authUid'
            );


        const id =

            requestId ||

            ASIYE_DRIVER.state
                ?.incomingRequest
                ?.requestId ||

            ASIYE_DRIVER.state
                ?.incomingRequest
                ?.key ||

            ASIYE_DRIVER.state
                ?.activeRequest
                ?.requestId ||

            ASIYE_DRIVER.state
                ?.activeRequest
                ?.key ||

            localStorage.getItem(
                'currentRequestId'
            );


        if (
            !driverId ||
            !id
        ) {

            return null;
        }


        const taxiRef =

            firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                );


        const currentRequestRef =

            taxiRef.child(
                'currentRequest'
            );


        const requestRef =

            firebase
                .database()
                .ref(
                    `requests/${id}`
                );


        try {

            const [
                taxiSnapshot,
                requestSnapshot
            ] =

                await Promise.all([
                    taxiRef.once(
                        'value'
                    ),
                    requestRef.once(
                        'value'
                    )
                ]);


            const liveDriver =
                taxiSnapshot.val() ||
                {};


            const request =
                requestSnapshot.val();


            const validDriverIds =

                new Set(
                    [
                        driverId,
                        authUid,
                        liveDriver.authUid,
                        liveDriver.userUid
                    ]
                    .filter(Boolean)
                    .map(String)
                );


            const terminalStatuses = [

                'completed',
                'cancelled_by_driver',
                'cancelled_by_commuter',
                'cancelled_by_admin',
                'rejected',
                'expired'
            ];


            const ownedByDriver =

                Boolean(
                    request &&
                    request.taxiId &&
                    validDriverIds.has(
                        String(
                            request.taxiId
                        )
                    ) &&
                    !terminalStatuses.includes(
                        String(
                            request.status ||
                            ''
                        )
                    )
                );


            if (ownedByDriver) {

                /*
                 * The request is the source of truth. If an earlier racing
                 * accept cleared the taxi lock, restore it safely.
                 */

                const lock = liveDriver.currentRequest === id ? {committed: true} :
                    await currentRequestRef
                        .transaction(
                            current => {

                                if (
                                    current === null ||
                                    current === undefined ||
                                    current === '' ||
                                    current === id
                                ) {

                                    return id;
                                }


                                return;
                            }
                        );


                if (
                    !lock.committed
                ) {

                    return null;
                }


                const accepted = {
                    key:
                        id,
                    requestId:
                        id,
                    ...request
                };


                if (
                    ASIYE_DRIVER.state
                        .driver
                ) {

                    ASIYE_DRIVER.state
                        .driver
                        .currentRequest =
                        id;
                }


                if (
                    ASIYE_DRIVER.state
                        .availability
                ) {

                    ASIYE_DRIVER.state
                        .availability
                        .currentRequest =
                        id;

                    ASIYE_DRIVER.state
                        .availability
                        .isBroadcasting =
                        false;
                }


                ASIYE_DRIVER.state
                    .incomingRequest =
                    null;


                ASIYE_DRIVER.state
                    .activeRequest =
                    accepted;


                if (
                    typeof ASIYE_DRIVER
                        .setActiveRequest ===
                        'function'
                ) {

                    ASIYE_DRIVER
                        .setActiveRequest(
                            id,
                            accepted
                        );
                }


                localStorage.setItem(
                    'currentRequestId',
                    id
                );


                await ASIYE_DRIVER.trip?.start?.(id, accepted);


                ASIYE_DRIVER.ui
                    ?.updateTopStatus?.();


                return accepted;
            }


            /*
             * No valid server-side assignment exists. Release only this stale
             * request lock; never disturb a different active trip.
             */

            await currentRequestRef
                .transaction(
                    current =>
                        current === id
                            ? null
                            : undefined
                )
                .catch(
                    () => {}
                );


            if (
                ASIYE_DRIVER.state
                    .driver
                    ?.currentRequest ===
                id
            ) {

                ASIYE_DRIVER.state
                    .driver
                    .currentRequest =
                    null;

                ASIYE_DRIVER.state
                    .driver
                    .isFull =
                    false;

                ASIYE_DRIVER.state
                    .driver
                    .isBroadcasting =
                    true;
            }


            if (
                ASIYE_DRIVER.state
                    .availability
                    ?.currentRequest ===
                id
            ) {

                ASIYE_DRIVER.state
                    .availability
                    .currentRequest =
                    null;

                ASIYE_DRIVER.state
                    .availability
                    .isFull =
                    false;

                ASIYE_DRIVER.state
                    .availability
                    .passengerCount =
                    0;

                ASIYE_DRIVER.state
                    .availability
                    .isBroadcasting =
                    true;
            }


            if (
                localStorage.getItem(
                    'currentRequestId'
                ) === id
            ) {

                localStorage.removeItem(
                    'currentRequestId'
                );
            }


            if (
                ASIYE_DRIVER.state
                    .activeRequest
                    ?.key === id ||
                ASIYE_DRIVER.state
                    .activeRequest
                    ?.requestId === id
            ) {

                ASIYE_DRIVER
                    .setActiveRequest?.(
                        null,
                        null
                    );
            }


            ASIYE_DRIVER.ui
                ?.updateTopStatus?.();


            return null;


        } catch (error) {

            console.warn(
                'Driver acceptance reconciliation failed:',
                error
            );
            if (strict) throw error;


            return null;
        }
    },


    /* ========================================================
       DECLINE
       ======================================================== */

    async decline(
        requestId = null
    ) {

        const id =

            requestId ||

            this.activeRequest?.key;


        if (!id) {

            return;
        }

        const offer = this.activeRequest;
        const notificationKey = this.activeNotificationKey;
        if (ASIYE_DRIVER.goNegotiation?.isProtectedGo(offer)) {
            try {
                await this.postNegotiation('declineGoFareOffer', {
                    requestId: id,
                    amount: Number(offer.passengerOffer),
                    negotiationRound: offer.negotiationRound
                });
            } catch (error) {
                ASIYE_DRIVER.ui?.toast?.(error.message || 'Could not decline the offer. Try again.', 'danger');
                return;
            }
        }

        /*
         * Do NOT cancel the passenger's booking.
         *
         * This driver is only declining it.
         */

        if (
            notificationKey
        ) {

            await this.removeNotification(
                notificationKey
            );
        }

        if (this.activeRequest && (this.activeRequest.key || this.activeRequest.requestId) !== id) return;
        this.stopIncomingWatch();

        this.activeRequest =
            null;


        ASIYE_DRIVER.state
            .incomingRequest =
            null;


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .closeIncomingRequest ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .closeIncomingRequest();
        }
    },


    /* ========================================================
       RESTORE ACTIVE DRIVER REQUEST
       ======================================================== */

    async restoreActiveRequest() {
        const driverId = ASIYE_DRIVER.state?.driverId;
        if (!driverId) return false;
        try {
            const driver = (await firebase.database().ref(`taxis/${driverId}`).once('value')).val();
            if (!driver) return false;
            ASIYE_DRIVER.state.driver = driver;
            ASIYE_DRIVER.syncDriverAvailability?.(driver);
            const candidates = [...new Set([driver.currentRequest, localStorage.getItem('currentRequestId')].filter(Boolean))];
            for (const requestId of candidates) {
                if (await this.reconcileAcceptance(requestId, true)) return true;
            }
            ASIYE_DRIVER.ui?.renderDashboard?.();
            return false;
        } catch (error) {
            console.error('Driver restore failed:', error);
            ASIYE_DRIVER.ui?.openActiveTripSheet?.();
            const container = document.getElementById('activeTripContent');
            if (container) {
                container.innerHTML = '<h2>Reconnect to your booking</h2><p>Your trip could not be checked. Retry to restore it.</p><button class="driver-btn driver-btn-primary" data-restore-retry>Retry</button>';
                container.querySelector('[data-restore-retry]')?.addEventListener('click', () => this.restoreActiveRequest());
            }
            return null;
        }
    },

    /* ========================================================
       CLEAR DRIVER REQUEST
       ======================================================== */

    async clearDriverRequest() {

        const driverId =
            ASIYE_DRIVER.state
                ?.driverId;


        if (!driverId) return;


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

                isBroadcasting:
                    true
            });


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
                .driver.isBroadcasting =
                true;
        }


        if (
            ASIYE_DRIVER.state.availability
        ) {

            ASIYE_DRIVER.state
                .availability
                .currentRequest =
                null;


            ASIYE_DRIVER.state
                .availability
                .isFull =
                false;


            ASIYE_DRIVER.state
                .availability
                .passengerCount =
                0;


            ASIYE_DRIVER.state
                .availability
                .isBroadcasting =
                true;
        }


        ASIYE_DRIVER
            .setActiveRequest?.(
                null,
                null
            );


        ASIYE_DRIVER.ui
            ?.updateTopStatus?.();


        localStorage.removeItem(
            'currentRequestId'
        );
    },


    /* ========================================================
       UTILS
       ======================================================== */

    countActivePassengers(
        passengers
    ) {

        return Object
            .values(
                passengers || {}
            )
            .filter(
                passenger =>

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
            .length;
    },


    getDriverName() {

        const driver =
            ASIYE_DRIVER.state
                ?.driver ||
            {};


        const fullName =

            `${driver.name || ''} ${driver.surname || ''}`
            .trim();


        return (
            fullName ||
            driver.fullName ||
            'Asiye Driver'
        );
    },


    async removeNotification(
        notificationKey
    ) {

        if (
            !notificationKey ||
            !ASIYE_DRIVER.state
                ?.driverId
        ) {

            return;
        }


        try {

            await firebase
                .database()
                .ref(
                    `notifications/taxis/${ASIYE_DRIVER.state.driverId}/${notificationKey}`
                )
                .remove();


        } catch (error) {

            console.warn(
                'Unable to remove notification:',
                error
            );
        }
    },


    playRequestSound() {

        try {

            /*
             * Optional.
             *
             * Replace later with local app sound.
             */

            const audio =
                new Audio(

                    'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'

                );


            audio.volume =
                0.6;


            audio.play()
                .catch(() => {});


        } catch (error) {

            // Ignore autoplay restrictions.
        }
    },


    stop() {

        this.stopIncomingWatch();

        if (
            this.notificationRef &&
            this.notificationListener
        ) {

            this.notificationRef.off(

                'child_added',

                this.notificationListener
            );
        }


        this.notificationRef =
            null;


        this.notificationListener =
            null;
    }

};

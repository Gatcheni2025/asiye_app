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


    /* ========================================================
       START REQUEST SYSTEM
       ======================================================== */

    start() {

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

        const driver =
            ASIYE_DRIVER.state
                ?.driver ||
            {};


        if (
            driver.isOnline !== true
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


                poolReady =

                    passengerCount >=
                    capacity;
            }


            const nextStatus =

                isClub

                ? (
                    poolReady

                    ? 'pool_ready'

                    : 'driver_waiting'
                )

                : 'accepted';


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

                vehicleReg:
                    vehicleReg,

                status:
                    nextStatus,

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

                                vehicleReg:
                                    vehicleReg,

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


        /*
         * Do NOT cancel the passenger's booking.
         *
         * This driver is only declining it.
         */

        if (
            this.activeNotificationKey
        ) {

            await this.removeNotification(
                this.activeNotificationKey
            );
        }


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

        const driverId =
            ASIYE_DRIVER.state
                ?.driverId;


        if (!driverId) return;


        try {

            const driverSnapshot =

                await firebase
                    .database()
                    .ref(
                        `taxis/${driverId}`
                    )
                    .once(
                        'value'
                    );


            const driver =
                driverSnapshot.val();


            if (!driver) return;


            ASIYE_DRIVER.state.driver =
                driver;


            const requestId =

                driver.currentRequest ||

                localStorage.getItem(
                    'currentRequestId'
                );


            if (!requestId) {

                return;
            }


            const requestSnapshot =

                await firebase
                    .database()
                    .ref(
                        `requests/${requestId}`
                    )
                    .once(
                        'value'
                    );


            const request =
                requestSnapshot.val();


            if (!request) {

                await this.clearDriverRequest();

                return;
            }


            const terminalStatuses = [

                'completed',

                'cancelled_by_driver',

                'cancelled_by_commuter',

                'cancelled_by_admin',

                'rejected'
            ];


            if (
                terminalStatuses.includes(
                    request.status
                )
            ) {

                await this.clearDriverRequest();

                return;
            }


            ASIYE_DRIVER.state
                .activeRequest =
                {
                    key:
                        requestId,

                    ...request
                };


            if (
                ASIYE_DRIVER.trip
            ) {

                ASIYE_DRIVER.trip.start(
                    requestId
                );
            }


        } catch (error) {

            console.error(
                'Driver restore failed:',
                error
            );
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
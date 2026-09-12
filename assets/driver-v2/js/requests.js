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

       Guarantees at most one active trip per driver.
       ======================================================== */

    async accept(requestId = null) {

        const driverId =
            ASIYE_DRIVER.state.driverId;


        const authUid =
            firebase.auth()
                .currentUser
                ?.uid ||
            localStorage.getItem(
                'authUid'
            );


        const driver =
            ASIYE_DRIVER.state.driver ||
            {};


        const id =

            requestId ||

            ASIYE_DRIVER.state
                .incomingRequest
                ?.requestId ||

            ASIYE_DRIVER.state
                .incomingRequest
                ?.key;


        if (
            !driverId ||
            !id
        ) {

            throw new Error(
                'Missing driver or request.'
            );
        }


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
           CHECK DRIVER AVAILABILITY FIRST
           ======================================================== */

        const taxiSnapshot =

            await firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                )
                .once(
                    'value'
                );


        const taxi =
            taxiSnapshot.val() ||
            {};


        const existingTrip =
            taxi.currentRequest ||
            null;


        /*
         * The same request may call Accept twice.
         * That is okay.
         *
         * A DIFFERENT active request is not.
         */

        if (
            existingTrip &&
            existingTrip !== id
        ) {

            console.warn(
                '🚫 Driver already has an active trip:',
                existingTrip
            );


            throw new Error(
                'Complete your current ride before accepting another booking.'
            );
        }


        /* ========================================================
           REQUEST TRANSACTION
           ======================================================== */

        const requestRef =

            firebase
                .database()
                .ref(
                    `requests/${id}`
                );


        const result =

            await requestRef.transaction(
                request => {

                    if (!request) {

                        return;
                    }


                    /*
                     * Terminal request.
                     */

                    if (
                        [
                            'completed',
                            'cancelled_by_commuter',
                            'cancelled_by_driver',
                            'cancelled_by_admin',
                            'rejected'
                        ].includes(
                            request.status
                        )
                    ) {

                        return;
                    }


                    /*
                     * Already owned by another REAL driver.
                     */

                    if (
                        request.taxiId &&
                        !validDriverIds.has(
                            request.taxiId
                        )
                    ) {

                        return;
                    }


                    /*
                     * If this ride was queued for this
                     * driver, it can now be accepted.
                     */

                    if (
                        request.queuedTaxiId &&
                        request.queuedTaxiId !==
                            driverId
                    ) {

                        return;
                    }


                    const isClub =
                        request.type ===
                        'club';


                    let passengerCount =
                        1;


                    let capacity =
                        1;


                    if (isClub) {

                        const passengers =
                            request.passengers ||
                            {};


                        passengerCount =

                            Object.values(
                                passengers
                            )
                            .filter(
                                passenger =>

                                    ![
                                        'cancelled',
                                        'cancelled_by_commuter',
                                        'rejected'
                                    ]
                                    .includes(
                                        passenger.status
                                    )
                            )
                            .length;


                        capacity =

                            Number(
                                request.capacity ||
                                request.maxCapacity ||
                                (
                                    request.clubMode ===
                                        'club7'
                                    ? 7
                                    : 4
                                )
                            );
                    }


                    const poolReady =

                        isClub
                        ? passengerCount >= capacity
                        : true;


                    /*
                     * This is the moment taxiId
                     * officially becomes assigned.
                     */

                    request.taxiId =
                        driverId;


                    request.driverAuthUid =
                        authUid ||
                        null;


                    request.driverName =

                        [
                            driver.name,
                            driver.surname
                        ]
                        .filter(Boolean)
                        .join(' ') ||

                        driver.driverName ||

                        'Driver';


                    request.driverPhone =
                        driver.phone ||
                        '';


                    request.driverRating =
                        Number(
                            driver.rating ||
                            5
                        );


                    request.vehicleReg =

                        driver.vehicleReg ||

                        driver.registration ||

                        driver.taxiRegistrationNumber ||

                        '';


                    request.vehicleInfo =

                        [
                            driver.vehicleColor ||
                                driver.color,

                            driver.vehicleMake ||
                                driver.make,

                            driver.vehicleModel ||
                                driver.model
                        ]
                        .filter(Boolean)
                        .join(' ');


                    request.acceptedAt =

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP;


                    /*
                     * Remove queue reservation.
                     */

                    request.queuedTaxiId =
                        null;


                    request.queuedAt =
                        null;


                    request.driverBusy =
                        false;


                    if (isClub) {

                        request.poolReady =
                            poolReady;


                        request.status =

                            poolReady

                            ? 'pool_ready'

                            : 'driver_waiting';

                    } else {

                        request.status =
                            'accepted';
                    }


                    return request;
                }
            );


        /* ========================================================
           TRANSACTION FAILED
           ======================================================== */

        if (
            !result.committed
        ) {

            const latestSnapshot =

                await requestRef.once(
                    'value'
                );


            const latest =
                latestSnapshot.val();


            /*
             * Same driver already accepted it.
             * Treat duplicate click as success.
             */

            if (
                latest?.taxiId &&
                validDriverIds.has(
                    latest.taxiId
                )
            ) {

                console.log(
                    'ℹ️ Request already belongs to this driver.'
                );


                ASIYE_DRIVER.setActiveRequest?.(
                    {
                        requestId:
                            id,

                        ...latest
                    }
                );


                ASIYE_DRIVER.trip
                    ?.start?.(
                        id
                    );


                return latest;
            }


            console.warn(
                'Request claim rejected:',
                {
                    requestId:
                        id,

                    taxiId:
                        latest?.taxiId,

                    queuedTaxiId:
                        latest?.queuedTaxiId,

                    status:
                        latest?.status,

                    myDriverId:
                        driverId
                }
            );


            throw new Error(
                latest?.taxiId
                    ? 'Another driver already accepted this request.'
                    : 'This booking is no longer available.'
            );
        }


        const accepted =
            result.snapshot.val();


        /* ========================================================
           DRIVER NOW BUSY
           ======================================================== */

        await firebase
            .database()
            .ref(
                `taxis/${driverId}`
            )
            .update({

                currentRequest:
                    id,

                isBroadcasting:
                    false,

                isFull:
                    accepted.type !==
                        'club',

                passengerCount:

                    accepted.type ===
                        'club'

                    ? Number(
                        accepted.passengerCount ||
                        Object.keys(
                            accepted.passengers ||
                            {}
                        ).length
                    )

                    : 1,

                updatedAt:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


        /* ========================================================
           REMOVE INCOMING NOTIFICATION
           ======================================================== */

        await firebase
            .database()
            .ref(
                `notifications/taxis/${driverId}/${id}`
            )
            .remove()
            .catch(
                () => {}
            );


        /* ========================================================
           PASSENGER NOTIFICATION
           ======================================================== */

        await this.notifyAcceptedPassengers?.(
            id,
            accepted,
            driverId
        );


        ASIYE_DRIVER.setActiveRequest?.(
            {
                requestId:
                    id,

                ...accepted
            }
        );


        ASIYE_DRIVER.setIncomingRequest?.(
            null
        );


        ASIYE_DRIVER.trip
            ?.start?.(
                id
            );


        console.log(
            '✅ Driver accepted request:',
            id
        );


        return accepted;
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
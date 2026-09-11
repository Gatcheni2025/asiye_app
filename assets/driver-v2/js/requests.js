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
       ======================================================== */

    async accept(
        requestId = null
    ) {

        const driverId =
            ASIYE_DRIVER.state
                .driverId;


        const driver =
            ASIYE_DRIVER.state
                .driver ||
            {};


        const id =

            requestId ||

            this.activeRequest?.key ||

            this.activeRequest?.requestId;


        if (
            !driverId ||
            !id
        ) {

            throw new Error(
                'Missing driver or request.'
            );
        }


        const requestRef =

            firebase
                .database()
                .ref(
                    `requests/${id}`
                );


        /*
         * =====================================================
         * IMPORTANT:
         *
         * Transaction prevents two drivers accepting
         * the same booking simultaneously.
         * =====================================================
         */

        const result =

            await requestRef.transaction(
                request => {

                    if (!request) {

                        return;
                    }


                    /*
                     * Another driver won the booking.
                     */

                    if (
                        request.taxiId &&
                        request.taxiId !==
                            driverId
                    ) {

                        return;
                    }


                    const type =
                        request.type;


                    const isClub =
                        type === 'club';


                    const passengers =
                        request.passengers ||
                        {};


                    const passengerCount =
                        isClub

                        ? this.countActivePassengers(
                            passengers
                        )

                        : 1;


                    const capacity =

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


                    const poolReady =

                        isClub &&
                        passengerCount >=
                            capacity;


                    request.taxiId =
                        driverId;


                    request.driverName =

                        this.getDriverName();


                    request.driverPhone =

                        driver.phone ||
                        driver.phoneNumber ||
                        '';


                    request.driverRating =

                        Number(
                            driver.rating ||
                            5
                        );


                    request.vehicleMake =

                        driver.vehicleMake ||
                        driver.make ||
                        '';


                    request.vehicleModel =

                        driver.vehicleModel ||
                        driver.model ||
                        '';


                    request.vehicleColor =

                        driver.vehicleColor ||
                        driver.color ||
                        '';


                    request.vehicleReg =

                        driver.registration ||

                        driver.registrationNumber ||

                        driver.carRegistration ||

                        '';


                    request.acceptedAt =

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP;


                    /*
                     * GO:
                     * accepted and ready for driver.
                     *
                     * CLUB:
                     * driver may be assigned but must wait
                     * until all Club seats are filled.
                     */

                    if (isClub) {

                        request.status =

                            poolReady

                            ? 'pool_ready'

                            : 'driver_waiting';


                        request.poolReady =
                            poolReady;


                        request.passengerCount =
                            passengerCount;


                        request.remainingSeats =

                            Math.max(

                                0,

                                capacity -
                                passengerCount
                            );

                    } else {

                        request.status =
                            'accepted';
                    }


                    return request;
                }
            );


        if (
            !result.committed
        ) {

            throw new Error(
                'Another driver already accepted this request.'
            );
        }


        const acceptedRequest =
            result.snapshot.val();


        if (!acceptedRequest) {

            throw new Error(
                'Request could not be accepted.'
            );
        }


        acceptedRequest.key =
            id;


        /*
         * Lock driver.
         */

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
                    acceptedRequest.type !==
                    'club',

                passengerCount:

                    acceptedRequest.type ===
                    'club'

                    ? Number(
                        acceptedRequest.passengerCount ||
                        0
                    )

                    : 1,

                lastStatusUpdate:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


        /*
         * Mirror local state.
         */

        ASIYE_DRIVER.state
            .driver.currentRequest =
            id;


        ASIYE_DRIVER.state
            .activeRequest =
            acceptedRequest;


        localStorage.setItem(
            'currentRequestId',
            id
        );


        /*
         * Notify passenger(s).
         */

        await this.notifyAcceptance(
            id,
            acceptedRequest
        );


        /*
         * Remove queue notification.
         */

        await this.removeNotification(
            this.activeNotificationKey
        );


        /*
         * Pass ownership to trip controller.
         */

        if (
            ASIYE_DRIVER.trip &&
            typeof ASIYE_DRIVER.trip
                .start ===
                'function'
        ) {

            ASIYE_DRIVER.trip.start(
                id
            );
        }


        return acceptedRequest;
    },


    /* ========================================================
       NOTIFY PASSENGER(S) OF ACCEPTANCE
       ======================================================== */

    async notifyAcceptance(
        requestId,
        request
    ) {

        const jobs =
            [];


        if (
            request.type === 'club' &&
            request.passengers
        ) {

            const passengerIds =

                Object.keys(
                    request.passengers
                );


            passengerIds.forEach(
                commuterId => {

                    const passenger =
                        request.passengers[
                            commuterId
                        ];


                    if (
                        passenger.status ===
                        'cancelled_by_commuter'
                    ) {

                        return;
                    }


                    jobs.push(

                        firebase
                            .database()
                            .ref(
                                `notifications/commuters/${commuterId}`
                            )
                            .push({

                                type:
                                    'request_accepted',

                                requestId:
                                    requestId,

                                driverId:
                                    ASIYE_DRIVER.state
                                        .driverId,

                                driverName:
                                    request.driverName,

                                driverPhone:
                                    request.driverPhone,

                                driverRating:
                                    request.driverRating,

                                vehicleInfo:
                                    `${request.vehicleMake || ''} ${request.vehicleModel || ''}`.trim(),

                                vehicleColor:
                                    request.vehicleColor ||
                                    '',

                                vehicleReg:
                                    request.vehicleReg ||
                                    '',

                                isClub:
                                    true,

                                poolCount:
                                    request.passengerCount,

                                maxCapacity:

                                    request.capacity ||
                                    request.maxCapacity ||
                                    4,

                                poolReady:
                                    request.poolReady ===
                                    true,

                                pickupPin:
                                    passenger.pickupPin ||
                                    '',

                                message:

                                    request.poolReady

                                    ? 'Your Club is ready and your driver has been assigned.'

                                    : 'Your driver is assigned and waiting for the Club to fill.',

                                timestamp:

                                    firebase
                                        .database
                                        .ServerValue
                                        .TIMESTAMP
                            })
                    );
                }
            );


        } else if (
            request.commuterId
        ) {

            jobs.push(

                firebase
                    .database()
                    .ref(
                        `notifications/commuters/${request.commuterId}`
                    )
                    .push({

                        type:
                            'request_accepted',

                        requestId:
                            requestId,

                        driverId:
                            ASIYE_DRIVER.state
                                .driverId,

                        driverName:
                            request.driverName,

                        driverPhone:
                            request.driverPhone,

                        driverRating:
                            request.driverRating,

                        vehicleInfo:
                            `${request.vehicleMake || ''} ${request.vehicleModel || ''}`.trim(),

                        vehicleColor:
                            request.vehicleColor ||
                            '',

                        vehicleReg:
                            request.vehicleReg ||
                            '',

                        pickupPin:
                            request.pickupPin ||
                            '',

                        isClub:
                            false,

                        message:
                            'Your Asiye driver has accepted your ride.',

                        timestamp:

                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP
                    })
            );
        }


        await Promise.all(
            jobs
        );
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
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

    start(
        requestId
    ) {

        if (!requestId) {

            return;
        }


        this.stop();


        this.requestId =
            requestId;


        localStorage.setItem(
            'currentRequestId',
            requestId
        );


        this.requestRef =

            firebase
                .database()
                .ref(
                    `requests/${requestId}`
                );


        this.requestListener =

            this.requestRef.on(

                'value',

                snapshot => {

                    const request =
                        snapshot.val();


                    if (!request) {

                        this.cleanup();

                        return;
                    }


                    request.key =
                        requestId;


                    this.request =
                        request;


                    ASIYE_DRIVER.state
                        .activeRequest =
                        request;


                    this.handleState(
                        request
                    );
                }
            );
    },


    /* ========================================================
       STATE MACHINE
       ======================================================== */

    handleState(
        request
    ) {

        const status =
            request.status;


        console.log(
            '🚕 Driver trip state:',
            status
        );


        switch (status) {


            case 'accepted':

                this.renderAccepted(
                    request
                );

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


        this.routeToPassenger(
            this.request
        );
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
                        request.pickupPin,

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

        await this.requestRef.update({

            status:
                'in_transit',

            tripStartedAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


        this.routeToDestination(
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

    async handleClubCollection(
        request
    ) {

        /*
         * If already routing to a passenger,
         * don't continually restart route.
         */

        if (
            this.currentPassengerId
        ) {

            return;
        }


        await this.navigateToNextClubPassenger(
            request
        );
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


        this.routeToClubPassenger(
            next
        );


        if (
            ASIYE_DRIVER.ui &&
            typeof ASIYE_DRIVER.ui
                .showClubPickup ===
                'function'
        ) {

            ASIYE_DRIVER.ui
                .showClubPickup(
                    next
                );
        }
    },


    /* ========================================================
       CLUB PASSENGER ARRIVED
       ======================================================== */

    async markClubPassengerArrived() {

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


        this.routeToDestination(
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


        this.routeToDestination(
            request
        );
    },


    /* ========================================================
       IN TRANSIT
       ======================================================== */

    renderInTransit(
        request
    ) {

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


    /* ========================================================
       COMPLETE TRIP
       ======================================================== */

    async completeTrip() {

        if (
            !this.requestId ||
            !this.request
        ) {

            return;
        }


        const request =
            this.request;


        const updates = {

            status:
                'completed',

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
                        'You have arrived at your destination.',

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

        if (
            !this.requestId ||
            !this.request
        ) {

            return;
        }


        await this.requestRef.update({

            status:
                'cancelled_by_driver',

            cancellationReason:
                reason || '',

            cancelledAt:

                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        });


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

                request.capacity ||

                request.maxCapacity ||

                (
                    request.clubMode ===
                    'club7'
                    ? 7
                    : 4
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
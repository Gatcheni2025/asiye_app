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
                quote.go || 0
            );


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


        const pickupPin =
            this.generatePin();


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

            paymentMethod:
                ASIYE.state.booking
                    .paymentMethod ||
                'cash',


            /* Safety */

            requirePin:
                true,

            pickupPin:
                pickupPin,


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


        /*
         * Notify eligible drivers.
         */

        await this.notifyGoDrivers(

            requestId,

            requestData
        );


        return requestId;
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

        const taxisSnapshot =

            await firebase
                .database()
                .ref(
                    'taxis'
                )
                .once(
                    'value'
                );


        if (
            !taxisSnapshot.exists()
        ) {

            console.warn(
                'No drivers found.'
            );

            return {
                mode:
                    'none'
            };
        }


        const pickupLat =

            Number(
                request
                    .commuterLocation
                    ?.latitude
            );


        const pickupLng =

            Number(
                request
                    .commuterLocation
                    ?.longitude
            );


        const idleDrivers =
            [];


        const busyDrivers =
            [];


        taxisSnapshot.forEach(
            child => {

                const taxi =
                    child.val() ||
                    {};


                const driverId =
                    child.key;


                if (
                    taxi.isOnline !== true
                ) {

                    return;
                }


                const lat =
                    Number(
                        taxi.latitude
                    );


                const lng =
                    Number(
                        taxi.longitude
                    );


                if (
                    !Number.isFinite(lat) ||
                    !Number.isFinite(lng)
                ) {

                    return;
                }


                /*
                 * Only normal e-hailing-compatible
                 * drivers for Asiye Go.
                 */

                const vehicleType =

                    String(
                        taxi.vehicleType ||
                        ''
                    )
                    .toLowerCase();


                if (
                    vehicleType &&
                    ![
                        'ehailing',
                        'e-hailing',
                        'go',
                        'car'
                    ].includes(
                        vehicleType
                    )
                ) {

                    return;
                }


                const distanceKm =

                    this.distanceKm(

                        pickupLat,
                        pickupLng,

                        lat,
                        lng
                    );


                /*
                 * Keep our local search radius.
                 */

                if (
                    distanceKm > 10
                ) {

                    return;
                }


                const item = {

                    driverId,
                    taxi,
                    distanceKm
                };


                if (
                    taxi.currentRequest
                ) {

                    busyDrivers.push(
                        item
                    );

                } else if (
                    taxi.isFull !== true
                ) {

                    idleDrivers.push(
                        item
                    );
                }
            }
        );


        /* ========================================================
           NEAREST FIRST
           ======================================================== */

        idleDrivers.sort(
            (a, b) =>
                a.distanceKm -
                b.distanceKm
        );


        busyDrivers.sort(
            (a, b) =>
                a.distanceKm -
                b.distanceKm
        );


        /* ========================================================
           IDLE DRIVER AVAILABLE
           ======================================================== */

        if (
            idleDrivers.length
        ) {

            const candidates =

                idleDrivers.slice(
                    0,
                    8
                );


            await Promise.all(

                candidates.map(
                    async candidate => {

                        await firebase
                            .database()
                            .ref(
                                `notifications/taxis/${candidate.driverId}/${requestId}`
                            )
                            .set({

                                type:
                                    'ride_request',

                                requestId:
                                    requestId,

                                rideType:
                                    'go',

                                commuterId:
                                    request.commuterId,

                                commuterName:
                                    request.commuterName ||
                                    'Passenger',

                                pickupAddress:
                                    request.pickupAddress ||
                                    'Pickup',

                                destination:
                                    request.destination ||
                                    request.destinationName ||
                                    'Destination',

                                fare:
                                    request.finalAmount ||
                                    request.calculatedPrice ||
                                    0,

                                distanceKm:
                                    request.routeDistanceKm ||
                                    0,

                                timestamp:

                                    firebase
                                        .database
                                        .ServerValue
                                        .TIMESTAMP
                            });
                    }
                )
            );


            console.log(
                `✅ Go request sent to ${candidates.length} available driver(s)`
            );


            return {

                mode:
                    'broadcast',

                drivers:
                    candidates.length
            };
        }


        /* ========================================================
           NO IDLE DRIVER — RESERVE BUSY DRIVER
           ======================================================== */

        if (
            busyDrivers.length
        ) {

            const selected =
                busyDrivers[0];


            console.log(
                '⏳ No free driver. Queuing booking behind:',
                selected.driverId
            );


            /*
             * IMPORTANT:
             *
             * DO NOT set taxiId here.
             *
             * taxiId means the driver has ACCEPTED.
             */

            await firebase
                .database()
                .ref(
                    `requests/${requestId}`
                )
                .update({

                    status:
                        'driver_busy',

                    queuedTaxiId:
                        selected.driverId,

                    driverBusy:
                        true,

                    queuedAt:

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP
                });


            /*
             * Driver's queue.
             */

            await firebase
                .database()
                .ref(
                    `taxis/${selected.driverId}/bookingQueue/${requestId}`
                )
                .set({

                    requestId:
                        requestId,

                    commuterId:
                        request.commuterId,

                    commuterName:
                        request.commuterName ||
                        'Passenger',

                    pickupAddress:
                        request.pickupAddress ||
                        'Pickup',

                    destination:
                        request.destination ||
                        request.destinationName ||
                        'Destination',

                    fare:
                        request.finalAmount ||
                        request.calculatedPrice ||
                        0,

                    queuedAt:

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP
                });


            return {

                mode:
                    'queued',

                driverId:
                    selected.driverId
            };
        }


        /* ========================================================
           NO ONLINE DRIVER
           ======================================================== */

        await firebase
            .database()
            .ref(
                `requests/${requestId}`
            )
            .update({

                status:
                    'searching',

                driverBusy:
                    false
            });


        return {

            mode:
                'none'
        };
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

            await firebase
                .database()
                .ref(
                    `requests/${requestId}`
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
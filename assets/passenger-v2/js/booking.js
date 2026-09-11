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
       ======================================================== */

    async notifyGoDrivers(
        requestId,
        request
    ) {

        const snapshot =

            await firebase
                .database()
                .ref('taxis')
                .once('value');


        if (!snapshot.exists()) {

            return 0;
        }


        const jobs = [];

        let count = 0;


        snapshot.forEach(child => {

            const driver =
                child.val() || {};


            const lat =
                Number(
                    driver.latitude
                );


            const lng =
                Number(
                    driver.longitude
                );


            const available =

                driver.isOnline === true &&

                driver.isBroadcasting === true &&

                driver.isFull !== true &&

                !driver.currentRequest &&

                Number.isFinite(lat) &&

                Number.isFinite(lng);


            if (!available) {

                return;
            }


            /*
             * E-hailing drivers only.
             *
             * Adjust these values if your
             * driver profiles use another field.
             */

            const vehicleType =
                String(
                    driver.vehicleType ||
                    driver.serviceType ||
                    ''
                )
                .toLowerCase();


            if (
                vehicleType &&
                ![
                    'ehailing',
                    'e-hailing',
                    'go'
                ].includes(
                    vehicleType
                )
            ) {

                return;
            }


            const distance =

                this.distanceKm(

                    request
                        .commuterLocation
                        .latitude,

                    request
                        .commuterLocation
                        .longitude,

                    lat,

                    lng
                );


            /*
             * Start with 10km radius.
             */

            if (
                distance > 10
            ) {

                return;
            }


            jobs.push(

                firebase
                    .database()
                    .ref(
                        `notifications/taxis/${child.key}`
                    )
                    .push({

                        type:
                            'ride_request',

                        requestType:
                            'go',

                        requestId:
                            requestId,

                        title:
                            'New Asiye Go request',

                        commuterName:
                            request.commuterName,

                        pickupAddress:
                            request.pickupAddress,

                        destination:
                            request.destination,

                        fare:
                            request.calculatedPrice,

                        distanceToPassengerKm:
                            distance,

                        timestamp:

                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP
                    })
            );


            count++;
        });


        await Promise.all(
            jobs
        );


        return count;
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
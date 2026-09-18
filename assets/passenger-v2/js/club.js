/* ============================================================
   ASIYE PASSENGER V2
   ASIYE WORK SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.club = {

    configs: {

        club4: {

            name:
                'Asiye Work 4',

            capacity:
                4,

            minimumPassengers:
                4,

            pickupWindowMinutes:
                10,

            maxWaitMinutes:
                20
        },


        club7: {

            name:
                'Asiye Work 7',

            capacity:
                7,

            minimumPassengers:
                7,

            pickupWindowMinutes:
                15,

            maxWaitMinutes:
                25
        }
    },


    /*
     * Fail fast if Firebase hasn't loaded or
     * hasn't been initialised. Called by every
     * method that touches the database.
     */

    ensureFirebase() {

        if (
            typeof firebase ===
            'undefined'
        ) {

            throw new Error(
                'Firebase SDK is unavailable.'
            );
        }


        if (
            !firebase.apps ||
            firebase.apps.length === 0
        ) {

            throw new Error(
                'Firebase has not been initialized.'
            );
        }


        return true;
    },


    getConfig(type) {

        return (
            this.configs[type] ||
            this.configs.club4
        );
    },


    /* ========================================================
       PRICE CALCULATION

       Total trip value is shared equally between all
       passengers in the selected Asiye Work.
       ======================================================== */

    calculatePrice(
        type,
        totalFare
    ) {

        const config =
            this.getConfig(type);


        const fare =
            Number(totalFare || 0);


        const pricePerPassenger =

            fare > 0

            ? Math.max(
                1,
                Math.ceil(
                    fare /
                    config.capacity
                )
            )

            : 0;


        return {

            capacity:
                config.capacity,

            totalFare:
                fare,

            pricePerPassenger:
                pricePerPassenger
        };
    },


    /* ========================================================
       SELECT CLUB
       ======================================================== */

    select(type) {

        const config =
            this.getConfig(type);


        const prices =
            ASIYE.pricing.calculate();


        /*
         * Use full Go-equivalent route fare as
         * pool value for now.
         *
         * Later you can apply a Asiye Work multiplier
         * if required.
         */

        const totalFare =
            prices.go;


        const pricing =
            this.calculatePrice(
                type,
                totalFare
            );


        ASIYE.state.booking
            .rideType =
            type;


        ASIYE.state.booking.club = {

            mode:
                type,

            capacity:
                config.capacity,

            confirmedPassengers:
                1,

            remainingSeats:
                config.capacity - 1,

            totalFare:
                pricing.totalFare,

            pricePerPassenger:
                pricing.pricePerPassenger,

            departureTime:
                null,

            pickupWindowMinutes:
                config.pickupWindowMinutes,

            maxWaitMinutes:
                config.maxWaitMinutes,

            poolId:
                null,

            poolReady:
                false
        };


        return ASIYE.state.booking.club;
    },


    getCommuteDirection() {

        const destination =
            ASIYE.state.destination || {};

        const home =
            ASIYE.places?.getSavedPlace?.('home');

        const work =
            ASIYE.places?.getSavedPlace?.('work');

        const distanceTo = place => {

            if (!place) return Infinity;

            return this.distanceKm(
                Number(destination.latitude),
                Number(destination.longitude),
                Number(place.latitude),
                Number(place.longitude)
            );
        };


        if (distanceTo(work) <= 2) {

            return 'to_work';
        }


        if (distanceTo(home) <= 2) {

            return 'to_home';
        }


        return 'other';
    },


    /* ========================================================
       FIND COMPATIBLE EXISTING POOL
       ======================================================== */

    async findCompatiblePool(
        type
    ) {

        this.ensureFirebase();


        const pickup =
            ASIYE.state.location;


        const destination =
            ASIYE.state.destination;


        const config =
            this.getConfig(type);


        const commuteDirection =
            this.getCommuteDirection();


        const snapshot =

            await firebase
                .database()
                .ref('requests')
                .orderByChild('type')
                .equalTo('club')
                .once('value');


        if (!snapshot.exists()) {

            return null;
        }


        let bestPool =
            null;


        let bestScore =
            Infinity;


        snapshot.forEach(child => {

            const pool =
                child.val();


            if (!pool) return;


            if (
                pool.clubMode !== type
            ) {

                return;
            }


            if (
                commuteDirection !== 'other' &&
                pool.commuteDirection &&
                pool.commuteDirection !== commuteDirection
            ) {

                return;
            }


            /*
             * A pool is joinable while it is
             * pooling, still waiting for members,
             * OR already has a driver assigned
             * but is not yet full.
             *
             * Driver V2 may accept a Club early,
             * which sets status to driver_waiting.
             * New commuters must still be able to
             * join that pool until capacity is hit.
             */

            if (
                ![
                    'pooling',
                    'waiting_members',
                    'driver_waiting'
                ].includes(
                    pool.status
                )
            ) {

                return;
            }


            const count =

                Number(
                    pool.passengerCount ||
                    Object.keys(
                        pool.passengers || {}
                    ).length
                );


            if (
                count >= config.capacity
            ) {

                return;
            }


            /*
             * Passenger pickup must be reasonably
             * close to the pool pickup area.
             */

            const poolLat =
                Number(
                    pool.poolCenterLat ||
                    pool.commuterLocation
                        ?.latitude
                );


            const poolLng =
                Number(
                    pool.poolCenterLng ||
                    pool.commuterLocation
                        ?.longitude
                );


            if (
                !Number.isFinite(poolLat) ||
                !Number.isFinite(poolLng)
            ) {

                return;
            }


            const pickupDistance =

                ASIYE.club
                    .distanceKm(

                        pickup.latitude,
                        pickup.longitude,

                        poolLat,
                        poolLng
                    );


            /*
             * Destination should also be
             * reasonably close.
             */

            const poolDestLat =
                Number(
                    pool.destinationCoords
                        ?.latitude
                );


            const poolDestLng =
                Number(
                    pool.destinationCoords
                        ?.longitude
                );


            if (
                !Number.isFinite(poolDestLat) ||
                !Number.isFinite(poolDestLng)
            ) {

                return;
            }


            const destinationDistance =

                ASIYE.club
                    .distanceKm(

                        destination.latitude,
                        destination.longitude,

                        poolDestLat,
                        poolDestLng
                    );

            /*
             * Current compatibility rules:
             *
             * same Asiye Work mode/direction
             * pickup within 3km
             * destination within 5km
             * pool still inside its waiting window
             */
            const createdAt =
                Number(pool.createdAt || 0);

            const maxWaitMinutes =
                Number(
                    pool.maxWaitMinutes ||
                    config.maxWaitMinutes ||
                    20
                );

            const ageMinutes =
                createdAt > 0
                ? (
                    Date.now() -
                    createdAt
                  ) / 60000
                : 0;

            if (
                pickupDistance > 3 ||
                destinationDistance > 5 ||
                (
                    createdAt > 0 &&
                    ageMinutes >
                    maxWaitMinutes
                )
            ) {

                return;
            }


            /*
             * Prefer the closest route, while giving
             * fuller pools a small advantage so
             * passengers can leave sooner.
             */
            const fullnessBoost =
                (
                    count /
                    config.capacity
                ) * 2;


            const score =
                pickupDistance +
                destinationDistance -
                fullnessBoost;


            if (
                score < bestScore
            ) {

                bestScore =
                    score;


                bestPool = {

                    id:
                        child.key,

                    data:
                        pool
                };
            }
        });


        return bestPool;
    },


    /* ========================================================
       JOIN EXISTING POOL
       ======================================================== */

    async joinPool(
        poolId
    ) {

        this.ensureFirebase();


        const uid =
            ASIYE.state.userId;


        if (
            !uid ||
            !poolId
        ) {

            throw new Error(
                'Missing passenger or Asiye Work pool.'
            );
        }


        const poolRef =

            firebase
                .database()
                .ref(
                    `requests/${poolId}`
                );


        const result =

            await poolRef.transaction(
                pool => {

                    if (!pool) {

                        return;
                    }


                    const config =
                        this.getConfig(
                            pool.clubMode
                        );


                    pool.passengers =
                        pool.passengers || {};


                    /*
                     * Already joined.
                     */

                    if (
                        pool.passengers[uid]
                    ) {

                        return pool;
                    }


                    const currentCount =

                        Object.keys(
                            pool.passengers
                        ).length;


                    if (
                        currentCount >=
                        config.capacity
                    ) {

                        return;
                    }


                    const user =
                        ASIYE.state.user || {};


                    pool.passengers[uid] = {

                        commuterId:
                            uid,

                        name:
                            user.name ||
                            user.firstName ||
                            'Passenger',

                        phone:
                            user.phone || '',

                        pickupAddress:
                            ASIYE.state.location
                                .address ||
                            'Current location',

                        pickupLat:
                            ASIYE.state.location
                                .latitude,

                        pickupLng:
                            ASIYE.state.location
                                .longitude,

                        destination:
                            ASIYE.state.destination
                                .address ||
                            ASIYE.state.destination
                                .name,

                        destinationLat:
                            ASIYE.state.destination
                                .latitude,

                        destinationLng:
                            ASIYE.state.destination
                                .longitude,

                        commuteDirection:
                            this.getCommuteDirection(),

                        pickupTiming:
                            'asap',

                        departureTime:
                            'ASAP',

                        paymentMethod:
                            ASIYE.state.booking
                                .paymentMethod ||
                            'cash',

                        status:
                            'waiting_pool',

                        joinedAt:
                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP
                    };


                    const newCount =

                        Object.keys(
                            pool.passengers
                        ).length;


                    pool.passengerCount =
                        newCount;


                    /*
                     * Recalculate equal split.
                     */

                    const totalFare =

                        Number(
                            pool.totalPoolFare ||
                            pool.calculatedPrice ||
                            0
                        );


                    const seatPrice =

                        Math.ceil(
                            totalFare /
                            config.capacity
                        );


                    pool.pricePerPassenger =
                        seatPrice;


                    Object.keys(
                        pool.passengers
                    )
                    .forEach(
                        passengerId => {

                            pool.passengers[
                                passengerId
                            ].price =
                                seatPrice;
                        }
                    );


                    /*
                     * Pool becomes ready only
                     * when completely filled.
                     *
                     * If a driver already accepted
                     * early (taxiId present), we
                     * keep the pool in the
                     * driver_waiting state until
                     * the last seat is taken.
                     */

                    if (
                        newCount >=
                        config.capacity
                    ) {

                        pool.status =
                            'pool_ready';

                        pool.poolReady =
                            true;

                        pool.poolReadyAt =
                            firebase
                                .database
                                .ServerValue
                                .TIMESTAMP;

                    } else {

                        /*
                         * Keep assigned driver's waiting state.
                         */

                        pool.status =

                            pool.taxiId

                            ? 'driver_waiting'

                            : 'pooling';
                    }


                    return pool;
                }
            );


        if (!result.committed) {

            throw new Error(
                'Unable to join this Asiye Work ride.'
            );
        }


        ASIYE.state.booking
            .requestId =
            poolId;


        ASIYE.state.booking
            .club.poolId =
            poolId;


        localStorage.setItem(
            'currentRequestId',
            poolId
        );


        await firebase
            .database()
            .ref(
                `commuters/${uid}`
            )
            .update({

                currentRequest:
                    poolId
            });


        return poolId;
    },


    /* ========================================================
       CREATE NEW CLUB POOL
       ======================================================== */

    async createPool(
        type
    ) {

        this.ensureFirebase();


        const uid =
            ASIYE.state.userId;


        if (!uid) {

            throw new Error(
                'Passenger is not logged in.'
            );
        }


        const config =
            this.getConfig(type);


        const pricing =
            this.calculatePrice(

                type,

                ASIYE.pricing.calculate()
                    .go
            );


        const requestRef =

            firebase
                .database()
                .ref('requests')
                .push();


        const requestId =
            requestRef.key;


        const user =
            ASIYE.state.user || {};


        const pickup =
            ASIYE.state.location;


        const destination =
            ASIYE.state.destination;


        const pin =

            String(
                Math.floor(
                    1000 +
                    Math.random() *
                    9000
                )
            );


        const passenger = {

            commuterId:
                uid,

            name:
                user.name ||
                user.firstName ||
                'Passenger',

            phone:
                user.phone || '',

            pickupAddress:
                pickup.address ||
                'Current location',

            pickupLat:
                pickup.latitude,

            pickupLng:
                pickup.longitude,

            destination:
                destination.address ||
                destination.name,

            destinationLat:
                destination.latitude,

            destinationLng:
                destination.longitude,

            commuteDirection:
                this.getCommuteDirection(),

            pickupTiming:
                'asap',

            departureTime:
                'ASAP',

            price:
                pricing.pricePerPassenger,

            paymentMethod:
                ASIYE.state.booking
                    .paymentMethod ||
                'cash',

            status:
                'waiting_pool',

            pickupPin:
                pin,

            joinedAt:
                firebase
                    .database
                    .ServerValue
                    .TIMESTAMP
        };


        const requestData = {

            requestId:
                requestId,

            type:
                'club',

            service:
                'asiye_work',

            serviceName:
                'Asiye Work',

            commuteDirection:
                this.getCommuteDirection(),

            clubMode:
                type,

            status:
                'pooling',

            poolReady:
                false,

            capacity:
                config.capacity,

            minimumPassengers:
                config.minimumPassengers,

            passengerCount:
                1,

            remainingSeats:
                config.capacity - 1,

            pickupTiming:
                'asap',

            departureTime:
                'ASAP',

            pickupWindowMinutes:
                config.pickupWindowMinutes,

            maxWaitMinutes:
                config.maxWaitMinutes,

            totalPoolFare:
                pricing.totalFare,

            pricePerPassenger:
                pricing.pricePerPassenger,

            agreedFare:
                pricing.pricePerPassenger,

            pricingVersion:
                1,

            commuterId:
                uid,

            commuterName:
                passenger.name,

            commuterPhone:
                passenger.phone,

            commuterLocation: {

                latitude:
                    pickup.latitude,

                longitude:
                    pickup.longitude
            },

            pickupAddress:
                pickup.address ||
                'Current location',

            poolCenterLat:
                pickup.latitude,

            poolCenterLng:
                pickup.longitude,

            destination:
                destination.address ||
                destination.name,

            destinationCoords: {

                latitude:
                    destination.latitude,

                longitude:
                    destination.longitude
            },

            routeDistanceKm:
                ASIYE.state.route
                    .distanceKm,

            routeDurationMinutes:
                ASIYE.state.route
                    .durationMinutes,

            paymentMethod:
                ASIYE.state.booking
                    .paymentMethod ||
                'cash',

            requirePin:
                true,

            passengers: {

                [uid]:
                    passenger
            },

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
            .club.poolId =
            requestId;


        localStorage.setItem(
            'currentRequestId',
            requestId
        );


        return requestId;
    },


    /* ========================================================
       BOOK CLUB
       ======================================================== */

    async book(
        type
    ) {

        this.ensureFirebase();

        this.select(type);


        const existingPool =

            await this.findCompatiblePool(
                type
            );


        let requestId;


        if (existingPool) {

            requestId =

                await this.joinPool(
                    existingPool.id
                );


        } else {

            requestId =

                await this.createPool(
                    type
                );
        }


        return requestId;
    },


    /* ========================================================
       POOL COUNTERS
       ======================================================== */

    getPoolProgress(request) {

        const capacity =

            Number(
                request.capacity ||
                this.getConfig(
                    request.clubMode
                ).capacity
            );


        const confirmed =

            Number(
                request.passengerCount ||
                Object.keys(
                    request.passengers || {}
                ).length
            );


        return {

            capacity:
                capacity,

            confirmed:
                confirmed,

            remaining:
                Math.max(
                    0,
                    capacity - confirmed
                ),

            percent:
                Math.min(
                    100,
                    Math.round(
                        confirmed /
                        capacity *
                        100
                    )
                ),

            ready:
                confirmed >= capacity
        };
    },


    /* ========================================================
       HELPERS
       ======================================================== */

    timeDifferenceMinutes(
        first,
        second
    ) {

        if (
            !first ||
            !second
        ) {

            return Infinity;
        }


        const toMinutes =
            value => {

                const parts =
                    String(value)
                    .split(':');


                return (
                    Number(parts[0]) * 60 +
                    Number(parts[1])
                );
            };


        return Math.abs(

            toMinutes(first) -
            toMinutes(second)
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


        const toRad =
            value =>
                value *
                Math.PI /
                180;


        const dLat =
            toRad(
                lat2 - lat1
            );


        const dLng =
            toRad(
                lng2 - lng1
            );


        const a =

            Math.sin(
                dLat / 2
            ) ** 2 +

            Math.cos(
                toRad(lat1)
            ) *

            Math.cos(
                toRad(lat2)
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
    }

};
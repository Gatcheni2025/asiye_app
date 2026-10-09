/* ============================================================
   ASIYE PASSENGER V2
   ASIYE CLUB SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.club = {

    configs: {

        club4: {

            name:
                'Asiye Work 3',

            capacity:
                4,

            minimumPassengers:
                3,

            pickupWindowMinutes:
                10,

            maxWaitMinutes:
                20
        },


        club7: {

            name:
                'Asiye Work 4',

            capacity:
                7,

            minimumPassengers:
                4,

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
       passengers in the selected Club.
       ======================================================== */

    calculatePrice(
        type,
        totalFare
    ) {

        const config =
            this.getConfig(type);


        const fare =
            Number(totalFare || 0);


        const targetPassengers =
            Number(
                config.minimumPassengers ||
                config.capacity
            );


        const pricePerPassenger =
            fare > 0
            ? Math.max(
                1,
                Math.ceil(
                    (
                        fare /
                        targetPassengers
                    ) *
                    1.15
                )
            )
            : 0;


        const clubTotal =
            pricePerPassenger *
            targetPassengers;


        return {

            capacity:
                config.capacity,

            requiredPassengers:
                targetPassengers,

            totalFare:
                clubTotal,

            marketReferenceFare:
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
         * Later you can apply a Club multiplier
         * if required.
         */

        const totalFare =
            prices.marketReference;


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

            requiredPassengers:
                config.minimumPassengers,

            remainingSeats:
                Math.max(
                    0,
                    config.minimumPassengers - 1
                ),

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


    /* ========================================================
       FIND COMPATIBLE EXISTING POOL
       ======================================================== */

    async findCompatiblePool(
        type,
        departureTime
    ) {

        this.ensureFirebase();


        const pickup =
            ASIYE.state.location;


        const destination =
            ASIYE.state.destination;


        const config =
            this.getConfig(type);


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
             * pickup within 3km and destination within 5km.
             * Club no longer asks for or matches by departure time.
             */

            if (
                pickupDistance > 3 ||
                destinationDistance > 5
            ) {

                return;
            }


            const score =

                pickupDistance +

                destinationDistance;


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
        poolId,
        departureTime
    ) {

        this.ensureFirebase();


        const uid =
            ASIYE.state.userId;


        if (
            !uid ||
            !poolId
        ) {

            throw new Error(
                'Missing passenger or Club pool.'
            );
        }


        const user =
            ASIYE.state.user || {};


        const profileImageUrl =
            ASIYE.profile.getUrl(user);


        const pin =
            await ASIYE.booking
                .requirePassengerPin();


        const liveTrackingUrl =
            await ASIYE.booking
                .createLiveShareUrl(
                    poolId
                );


        const shareToken =
            new URL(
                liveTrackingUrl
            )
                .searchParams
                .get(
                    'share'
                ) ||
            '';


        await ASIYE.booking.requireTripShare({

            requestId:
                poolId,

            liveTrackingUrl:
                liveTrackingUrl,

            pickupPin:
                pin,

            pickupAddress:
                ASIYE.state.location.address ||
                'Current location',

            destination:
                ASIYE.state.destination.address ||
                ASIYE.state.destination.name,

            service:
                'Asiye Work'
        });


        /*
         * SECURITY:
         * Pool-wide membership, capacity, pricing and ready-state
         * changes are performed by the verified backend.
         */

        const authUser =
            firebase.auth().currentUser;


        if (!authUser) {

            throw new Error(
                'Please sign in again before joining this Club ride.'
            );
        }


        const token =
            await authUser.getIdToken(true);


        const response =
            await fetch(

                'https://us-central1-asiye-80386.cloudfunctions.net/joinClubPoolSecure',

                {
                    method:
                        'POST',

                    headers: {

                        'Authorization':
                            `Bearer ${token}`,

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({

                            poolId:
                                poolId,

                            shareToken:
                                shareToken,

                            pickupPin:
                                pin,

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

                            departureTime:
                                departureTime,

                            paymentMethod:
                                String(
                                    ASIYE.state.booking
                                        .paymentMethod ||
                                    'cash'
                                )
                                .toLowerCase(),

                            profileImageUrl:
                                profileImageUrl
                        })
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
                'Unable to join this Club ride.'
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


        if (
            payload.passengerPaymentStatus ===
                'payment_required' &&
            String(
                ASIYE.state.booking
                    .paymentMethod ||
                'cash'
            )
                .toLowerCase() ===
                'card'
        ) {
            await ASIYE.payments
                ?.prepare?.(
                    poolId
                );
        }


        return poolId;
    },


    /* ========================================================
       CREATE NEW CLUB POOL
       ======================================================== */

    async createPool(
        type,
        departureTime
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
                    .marketReference
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
            await ASIYE.booking
                .requirePassengerPin();


        const profileImageUrl =
            ASIYE.profile.getUrl(user);


        const passenger = {

            commuterId:
                uid,

            name:
                user.name ||
                user.firstName ||
                'Passenger',

            phone:
                user.phone || '',

            profileImageUrl:
                profileImageUrl,

            profile_picture_url:
                profileImageUrl,

            requirePin:
                true,

            safetyShareRequired:
                true,

            safetyShareCompleted:
                false,

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

            departureTime:
                departureTime,

            price:
                pricing.pricePerPassenger,

            paymentMethod:
                String(
                    ASIYE.state.booking
                        .paymentMethod ||
                    'cash'
                )
                .toLowerCase(),

            paymentStatus:
                'waiting_pool',

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

            clubMode:
                type,

            status:
                'share_required',

            poolReady:
                false,

            paymentsReady:
                false,

            paymentStatus:
                'waiting_pool',

            capacity:
                config.capacity,

            minimumPassengers:
                config.minimumPassengers,

            passengerCount:
                1,

            remainingSeats:
                Math.max(
                    0,
                    config.minimumPassengers - 1
                ),

            departureTime:
                departureTime,

            pickupWindowMinutes:
                config.pickupWindowMinutes,

            maxWaitMinutes:
                config.maxWaitMinutes,

            totalPoolFare:
                pricing.totalFare,

            marketReferenceFare:
                pricing.marketReferenceFare,

            driverGrossFare:
                pricing.totalFare,

            commissionRate:
                0.20,

            pricePerPassenger:
                pricing.pricePerPassenger,

            commuterId:
                uid,

            commuterName:
                passenger.name,

            commuterPhone:
                passenger.phone,

            commuterProfileImageUrl:
                profileImageUrl,

            passengerProfileImageUrl:
                profileImageUrl,

            requirePin:
                true,

            pickupPin:
                pin,

            safetyShareRequired:
                true,

            safetyShareCompleted:
                false,

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
                String(
                    ASIYE.state.booking
                        .paymentMethod ||
                    'cash'
                )
                .toLowerCase(),

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


        let liveTrackingUrl;

        try {

            liveTrackingUrl =
                await ASIYE.booking
                    .createLiveShareUrl(
                        requestId
                    );


            await ASIYE.booking.requireTripShare({
                requestId:
                    requestId,
                liveTrackingUrl:
                    liveTrackingUrl,
                pickupPin:
                    pin,
                pickupAddress:
                    pickup.address ||
                    'Current location',
                destination:
                    destination.address ||
                    destination.name,
                service:
                    'Asiye Work'
            });


            await requestRef.update({

                status:
                    'pooling',

                safetyShareCompleted:
                    true,

                safetyShareAt:
                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP,

                [`passengers/${uid}/safetyShareCompleted`]:
                    true,

                [`passengers/${uid}/safetyShareAt`]:
                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            });


            requestData.status =
                'pooling';

            requestData.safetyShareCompleted =
                true;

        } catch (error) {

            await requestRef
                .remove()
                .catch(
                    () => {}
                );

            throw error;
        }


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
        type,
        departureTime
    ) {

        this.ensureFirebase();

        this.select(type);

        const requiredFare =
            Number(
                ASIYE.state.booking
                    .club
                    ?.pricePerPassenger ||
                0
            );

        const paymentMethod =
            String(
                ASIYE.state.booking
                    .paymentMethod ||
                'cash'
            )
            .toLowerCase();

        if (
            paymentMethod ===
            'wallet'
        ) {
            if (
                !ASIYE.wallet ||
                typeof ASIYE.wallet.requireFare !==
                    'function'
            ) {
                throw new Error(
                    'Asiye Wallet is unavailable. Reopen the app and try again.'
                );
            }

            await ASIYE.wallet
                .requireFare(
                    requiredFare,
                    this.getConfig(type).name
                );
        }

        await ASIYE.profile
            .ensureRequired();


        const existingPool =

            await this.findCompatiblePool(

                type,

                departureTime
            );


        let requestId;


        if (existingPool) {

            requestId =

                await this.joinPool(

                    existingPool.id,

                    departureTime
                );


        } else {

            requestId =

                await this.createPool(

                    type,

                    departureTime
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
                request.minimumPassengers ||
                request.requiredPassengers ||
                this.getConfig(
                    request.clubMode
                ).minimumPassengers ||
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
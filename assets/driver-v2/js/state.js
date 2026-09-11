/* ============================================================
   ASIYE DRIVER V2
   GLOBAL APPLICATION STATE
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};


/* ============================================================
   MAIN STATE
   ============================================================ */

ASIYE_DRIVER.state = {

    /* ========================================================
       AUTH / DRIVER
       ======================================================== */

    driverId:
        null,

    driver:
        null,


    /* ========================================================
       DRIVER LOCATION
       ======================================================== */

    location: {

        latitude:
            null,

        longitude:
            null,

        accuracy:
            null,

        heading:
            null,

        speed:
            null,

        updatedAt:
            null
    },


    /* ========================================================
       DRIVER AVAILABILITY
       ======================================================== */

    availability: {

        isOnline:
            false,

        isBroadcasting:
            false,

        isFull:
            false,

        currentRequest:
            null,

        passengerCount:
            0
    },


    /* ========================================================
       INCOMING REQUEST
       ======================================================== */

    incomingRequest:
        null,


    /* ========================================================
       ACTIVE REQUEST
       ======================================================== */

    activeRequest:
        null,


    /* ========================================================
       CURRENT TRIP
       ======================================================== */

    trip: {

        requestId:
            null,

        type:
            null,

        status:
            null,

        phase:
            null,

        startedAt:
            null,

        completedAt:
            null
    },


    /* ========================================================
       ASIYE GO
       ======================================================== */

    go: {

        commuterId:
            null,

        commuterName:
            null,

        commuterPhone:
            null,

        pickupAddress:
            null,

        pickupLatitude:
            null,

        pickupLongitude:
            null,

        destination:
            null,

        destinationLatitude:
            null,

        destinationLongitude:
            null,

        fare:
            0,

        paymentMethod:
            'cash',

        pickupPin:
            null
    },


    /* ========================================================
       ASIYE CLUB
       ======================================================== */

    club: {

        mode:
            null,

        capacity:
            0,

        passengerCount:
            0,

        remainingSeats:
            0,

        poolReady:
            false,

        departureTime:
            null,

        pricePerPassenger:
            0,

        totalPoolFare:
            0,

        passengers:
            {},

        currentPassengerId:
            null,

        collectedPassengerIds:
            [],

        waitingPassengerIds:
            []
    },


    /* ========================================================
       ROUTE / NAVIGATION
       ======================================================== */

    navigation: {

        active:
            false,

        targetType:
            null,

        targetId:
            null,

        targetName:
            null,

        targetLatitude:
            null,

        targetLongitude:
            null,

        distanceKm:
            0,

        durationMinutes:
            0,

        geometry:
            null
    },


    /* ========================================================
       UI
       ======================================================== */

    ui: {

        screen:
            'dashboard',

        requestPopupOpen:
            false,

        menuOpen:
            false,

        loading:
            false,

        pinPassengerId:
            null
    }

};


/* ============================================================
   DRIVER HELPERS
   ============================================================ */

ASIYE_DRIVER.setDriver = function(
    driverId,
    driverData
) {

    ASIYE_DRIVER.state.driverId =
        driverId || null;


    ASIYE_DRIVER.state.driver =
        driverData || null;


    if (
        driverData
    ) {

        ASIYE_DRIVER.syncDriverAvailability(
            driverData
        );
    }
};


/* ============================================================
   SYNC DRIVER AVAILABILITY
   ============================================================ */

ASIYE_DRIVER.syncDriverAvailability = function(
    driverData
) {

    const driver =
        driverData || {};


    ASIYE_DRIVER.state.availability = {

        isOnline:
            driver.isOnline === true,

        isBroadcasting:
            driver.isBroadcasting === true,

        isFull:
            driver.isFull === true,

        currentRequest:
            driver.currentRequest || null,

        passengerCount:
            Number(
                driver.passengerCount || 0
            )
    };
};


/* ============================================================
   SET DRIVER LOCATION
   ============================================================ */

ASIYE_DRIVER.setLocation = function(
    latitude,
    longitude,
    options = {}
) {

    const lat =
        Number(latitude);


    const lng =
        Number(longitude);


    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {

        return;
    }


    ASIYE_DRIVER.state.location = {

        latitude:
            lat,

        longitude:
            lng,

        accuracy:

            Number.isFinite(
                Number(options.accuracy)
            )

            ? Number(
                options.accuracy
            )

            : null,

        heading:

            Number.isFinite(
                Number(options.heading)
            )

            ? Number(
                options.heading
            )

            : null,

        speed:

            Number.isFinite(
                Number(options.speed)
            )

            ? Number(
                options.speed
            )

            : null,

        updatedAt:
            Date.now()
    };


    /*
     * Mirror into driver object so
     * requests.js / trip-controller.js
     * can access driver.latitude
     * and driver.longitude directly.
     */

    if (
        ASIYE_DRIVER.state.driver
    ) {

        ASIYE_DRIVER.state.driver.latitude =
            lat;


        ASIYE_DRIVER.state.driver.longitude =
            lng;


        ASIYE_DRIVER.state.driver.locationUpdatedAt =
            Date.now();
    }
};


/* ============================================================
   SET INCOMING REQUEST
   ============================================================ */

ASIYE_DRIVER.setIncomingRequest = function(
    request
) {

    ASIYE_DRIVER.state.incomingRequest =
        request || null;
};


/* ============================================================
   SET ACTIVE REQUEST
   ============================================================ */

ASIYE_DRIVER.setActiveRequest = function(
    requestId,
    requestData
) {

    if (!requestData) {

        ASIYE_DRIVER.state.activeRequest =
            null;


        ASIYE_DRIVER.resetTripState();

        return;
    }


    const request = {

        key:
            requestId ||
            requestData.key ||
            requestData.requestId ||
            null,

        ...requestData
    };


    ASIYE_DRIVER.state.activeRequest =
        request;


    ASIYE_DRIVER.state.trip.requestId =
        request.key;


    ASIYE_DRIVER.state.trip.type =
        request.type || null;


    ASIYE_DRIVER.state.trip.status =
        request.status || null;


    ASIYE_DRIVER.state.trip.phase =
        ASIYE_DRIVER.getTripPhase(
            request
        );


    /*
     * Populate specific service state.
     */

    if (
        request.type ===
        'club'
    ) {

        ASIYE_DRIVER.loadClubState(
            request
        );

    } else {

        ASIYE_DRIVER.loadGoState(
            request
        );
    }
};


/* ============================================================
   LOAD ASIYE GO STATE
   ============================================================ */

ASIYE_DRIVER.loadGoState = function(
    request
) {

    const pickup =
        request.commuterLocation ||
        {};


    const destination =
        request.destinationCoords ||
        {};


    ASIYE_DRIVER.state.go = {

        commuterId:
            request.commuterId || null,

        commuterName:
            request.commuterName ||
            'Passenger',

        commuterPhone:
            request.commuterPhone || '',

        pickupAddress:
            request.pickupAddress ||
            'Pickup location',

        pickupLatitude:

            Number.isFinite(
                Number(
                    pickup.latitude
                )
            )

            ? Number(
                pickup.latitude
            )

            : null,

        pickupLongitude:

            Number.isFinite(
                Number(
                    pickup.longitude
                )
            )

            ? Number(
                pickup.longitude
            )

            : null,

        destination:
            request.destination ||
            'Destination',

        destinationLatitude:

            Number.isFinite(
                Number(
                    destination.latitude
                )
            )

            ? Number(
                destination.latitude
            )

            : null,

        destinationLongitude:

            Number.isFinite(
                Number(
                    destination.longitude
                )
            )

            ? Number(
                destination.longitude
            )

            : null,

        fare:
            Number(
                request.finalAmount ||
                request.calculatedPrice ||
                request.price ||
                0
            ),

        paymentMethod:
            request.paymentMethod ||
            'cash',

        pickupPin:
            request.pickupPin ||
            null
    };


    ASIYE_DRIVER.resetClubState();
};


/* ============================================================
   LOAD ASIYE CLUB STATE
   ============================================================ */

ASIYE_DRIVER.loadClubState = function(
    request
) {

    const passengers =
        request.passengers || {};


    const activePassengerEntries =

        Object.entries(
            passengers
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
        );


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


    const collectedPassengerIds =

        activePassengerEntries
        .filter(
            ([id, passenger]) =>

                [
                    'passenger_onboard',
                    'in_transit',
                    'completed'
                ]
                .includes(
                    passenger.status
                )
        )
        .map(
            ([id]) => id
        );


    const waitingPassengerIds =

        activePassengerEntries
        .filter(
            ([id, passenger]) =>

                ![
                    'passenger_onboard',
                    'in_transit',
                    'completed'
                ]
                .includes(
                    passenger.status
                )
        )
        .map(
            ([id]) => id
        );


    ASIYE_DRIVER.state.club = {

        mode:

            request.clubMode ||

            (
                capacity === 7
                ? 'club7'
                : 'club4'
            ),

        capacity:
            capacity,

        passengerCount:
            activePassengerEntries.length,

        remainingSeats:

            Math.max(

                0,

                capacity -
                activePassengerEntries.length
            ),

        poolReady:

            request.poolReady === true ||

            activePassengerEntries.length >=
            capacity,

        departureTime:

            request.departureTime ||

            request.morningDeparture ||

            null,

        pricePerPassenger:

            Number(
                request.pricePerPassenger ||
                request.originalPerPersonPrice ||
                request.calculatedPrice ||
                0
            ),

        totalPoolFare:

            Number(
                request.totalPoolFare ||
                0
            ),

        passengers:
            passengers,

        currentPassengerId:

            ASIYE_DRIVER.state
                .club
                ?.currentPassengerId ||
            null,

        collectedPassengerIds:
            collectedPassengerIds,

        waitingPassengerIds:
            waitingPassengerIds
    };


    ASIYE_DRIVER.resetGoState();
};


/* ============================================================
   UPDATE TRIP STATUS
   ============================================================ */

ASIYE_DRIVER.setTripStatus = function(
    status
) {

    ASIYE_DRIVER.state.trip.status =
        status || null;


    if (
        ASIYE_DRIVER.state.activeRequest
    ) {

        ASIYE_DRIVER.state.activeRequest.status =
            status;
    }


    ASIYE_DRIVER.state.trip.phase =
        ASIYE_DRIVER.getTripPhase(

            ASIYE_DRIVER.state
                .activeRequest ||
            {
                status:
                    status
            }
        );
};


/* ============================================================
   GET TRIP PHASE
   ============================================================ */

ASIYE_DRIVER.getTripPhase = function(
    request
) {

    if (!request) {

        return null;
    }


    const status =
        String(
            request.status || ''
        );


    const isClub =
        request.type ===
        'club';


    if (isClub) {

        switch (status) {

            case 'pooling':

            case 'waiting_members':

            case 'driver_waiting':

                return 'waiting_for_club';


            case 'pool_ready':

                return 'club_ready';


            case 'collecting_passengers':

            case 'driver_on_way':

            case 'arrived':

                return 'collecting_passengers';


            case 'all_onboard':

                return 'all_onboard';


            case 'in_transit':

                return 'driving_to_destination';


            case 'completed':

                return 'completed';


            case 'cancelled_by_driver':

            case 'cancelled_by_commuter':

            case 'cancelled_by_admin':

            case 'rejected':

                return 'cancelled';


            default:

                return status || null;
        }
    }


    /*
     * ASIYE GO
     */

    switch (status) {

        case 'accepted':

            return 'accepted';


        case 'driver_on_way':

            return 'driving_to_pickup';


        case 'arrived':

            return 'at_pickup';


        case 'passenger_onboard':

            return 'passenger_onboard';


        case 'in_transit':

            return 'driving_to_destination';


        case 'completed':

            return 'completed';


        case 'cancelled_by_driver':

        case 'cancelled_by_commuter':

        case 'cancelled_by_admin':

        case 'rejected':

            return 'cancelled';


        default:

            return status || null;
    }
};


/* ============================================================
   NAVIGATION TARGET
   ============================================================ */

ASIYE_DRIVER.setNavigationTarget = function(
    target
) {

    if (!target) {

        ASIYE_DRIVER.clearNavigation();

        return;
    }


    ASIYE_DRIVER.state.navigation = {

        active:
            true,

        targetType:
            target.type || null,

        targetId:
            target.id || null,

        targetName:
            target.name ||
            target.label ||
            null,

        targetLatitude:

            Number.isFinite(
                Number(
                    target.latitude
                )
            )

            ? Number(
                target.latitude
            )

            : null,

        targetLongitude:

            Number.isFinite(
                Number(
                    target.longitude
                )
            )

            ? Number(
                target.longitude
            )

            : null,

        distanceKm:

            Number(
                target.distanceKm ||
                0
            ),

        durationMinutes:

            Number(
                target.durationMinutes ||
                0
            ),

        geometry:
            target.geometry ||
            null
    };
};


/* ============================================================
   CLEAR NAVIGATION
   ============================================================ */

ASIYE_DRIVER.clearNavigation = function() {

    ASIYE_DRIVER.state.navigation = {

        active:
            false,

        targetType:
            null,

        targetId:
            null,

        targetName:
            null,

        targetLatitude:
            null,

        targetLongitude:
            null,

        distanceKm:
            0,

        durationMinutes:
            0,

        geometry:
            null
    };
};


/* ============================================================
   CURRENT CLUB PASSENGER
   ============================================================ */

ASIYE_DRIVER.setCurrentClubPassenger = function(
    passengerId
) {

    ASIYE_DRIVER.state.club
        .currentPassengerId =
        passengerId || null;


    ASIYE_DRIVER.state.ui
        .pinPassengerId =
        passengerId || null;
};


/* ============================================================
   UI SCREEN
   ============================================================ */

ASIYE_DRIVER.setScreen = function(
    screen
) {

    ASIYE_DRIVER.state.ui.screen =
        screen || 'dashboard';
};


/* ============================================================
   UI LOADING
   ============================================================ */

ASIYE_DRIVER.setLoading = function(
    loading
) {

    ASIYE_DRIVER.state.ui.loading =
        loading === true;
};


/* ============================================================
   RESET GO STATE
   ============================================================ */

ASIYE_DRIVER.resetGoState = function() {

    ASIYE_DRIVER.state.go = {

        commuterId:
            null,

        commuterName:
            null,

        commuterPhone:
            null,

        pickupAddress:
            null,

        pickupLatitude:
            null,

        pickupLongitude:
            null,

        destination:
            null,

        destinationLatitude:
            null,

        destinationLongitude:
            null,

        fare:
            0,

        paymentMethod:
            'cash',

        pickupPin:
            null
    };
};


/* ============================================================
   RESET CLUB STATE
   ============================================================ */

ASIYE_DRIVER.resetClubState = function() {

    ASIYE_DRIVER.state.club = {

        mode:
            null,

        capacity:
            0,

        passengerCount:
            0,

        remainingSeats:
            0,

        poolReady:
            false,

        departureTime:
            null,

        pricePerPassenger:
            0,

        totalPoolFare:
            0,

        passengers:
            {},

        currentPassengerId:
            null,

        collectedPassengerIds:
            [],

        waitingPassengerIds:
            []
    };
};


/* ============================================================
   RESET TRIP STATE
   ============================================================ */

ASIYE_DRIVER.resetTripState = function() {

    ASIYE_DRIVER.state.activeRequest =
        null;


    ASIYE_DRIVER.state.incomingRequest =
        null;


    ASIYE_DRIVER.state.trip = {

        requestId:
            null,

        type:
            null,

        status:
            null,

        phase:
            null,

        startedAt:
            null,

        completedAt:
            null
    };


    ASIYE_DRIVER.resetGoState();

    ASIYE_DRIVER.resetClubState();

    ASIYE_DRIVER.clearNavigation();


    ASIYE_DRIVER.state.ui
        .pinPassengerId =
        null;
};


/* ============================================================
   FULL DRIVER SESSION RESET
   ============================================================ */

ASIYE_DRIVER.resetDriverSession = function() {

    ASIYE_DRIVER.state.driverId =
        null;


    ASIYE_DRIVER.state.driver =
        null;


    ASIYE_DRIVER.state.location = {

        latitude:
            null,

        longitude:
            null,

        accuracy:
            null,

        heading:
            null,

        speed:
            null,

        updatedAt:
            null
    };


    ASIYE_DRIVER.state.availability = {

        isOnline:
            false,

        isBroadcasting:
            false,

        isFull:
            false,

        currentRequest:
            null,

        passengerCount:
            0
    };


    ASIYE_DRIVER.resetTripState();


    ASIYE_DRIVER.state.ui = {

        screen:
            'dashboard',

        requestPopupOpen:
            false,

        menuOpen:
            false,

        loading:
            false,

        pinPassengerId:
            null
    };
};


/* ============================================================
   DEBUG HELPER

   In console you can run:

   ASIYE_DRIVER.debugState()

   ============================================================ */

ASIYE_DRIVER.debugState = function() {

    console.log(
        '🚕 ASIYE DRIVER V2 STATE'
    );


    console.table({

        driverId:
            ASIYE_DRIVER.state.driverId,

        online:
            ASIYE_DRIVER.state
                .availability
                .isOnline,

        broadcasting:
            ASIYE_DRIVER.state
                .availability
                .isBroadcasting,

        currentRequest:
            ASIYE_DRIVER.state
                .availability
                .currentRequest,

        tripType:
            ASIYE_DRIVER.state
                .trip
                .type,

        tripStatus:
            ASIYE_DRIVER.state
                .trip
                .status,

        tripPhase:
            ASIYE_DRIVER.state
                .trip
                .phase,

        clubPassengers:
            ASIYE_DRIVER.state
                .club
                .passengerCount,

        clubCapacity:
            ASIYE_DRIVER.state
                .club
                .capacity
    });


    return ASIYE_DRIVER.state;
};
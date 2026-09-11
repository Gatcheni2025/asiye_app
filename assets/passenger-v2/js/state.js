/* ============================================================
   ASIYE PASSENGER V2
   Global Application State
   ============================================================ */

window.ASIYE = window.ASIYE || {};


ASIYE.state = {

    userId:
        null,

    user:
        null,


    location: {

        latitude:
            null,

        longitude:
            null,

        address:
            null,

        accuracy:
            null
    },


    destination: {

        name:
            null,

        address:
            null,

        latitude:
            null,

        longitude:
            null
    },


    route: {

        distanceKm:
            0,

        durationMinutes:
            0,

        geometry:
            null
    },


    booking: {

        rideType:
            null,

        paymentMethod:
            'cash',

        fare:
            0,

        requestId:
            null,

        request:
            null
    },


    driver: {

        id:
            null,

        data:
            null
    },


    ui: {

        page:
            'home',

        menuOpen:
            false,

        sheet:
            'home'
    }

};


/* ============================================================
   Convenience State Helpers
   ============================================================ */

ASIYE.setUser = function(
    uid,
    data
) {

    ASIYE.state.userId =
        uid || null;


    ASIYE.state.user =
        data || null;
};


ASIYE.setLocation = function(
    lat,
    lng,
    address = null,
    accuracy = null
) {

    ASIYE.state.location = {

        latitude:
            Number(lat),

        longitude:
            Number(lng),

        address:
            address,

        accuracy:
            accuracy
    };
};


ASIYE.setDestination = function(
    destination
) {

    ASIYE.state.destination = {

        name:
            destination?.name || null,

        address:
            destination?.address || null,

        latitude:
            Number(
                destination?.latitude
            ) || null,

        longitude:
            Number(
                destination?.longitude
            ) || null
    };
};


ASIYE.resetDestination = function() {

    ASIYE.state.destination = {

        name:
            null,

        address:
            null,

        latitude:
            null,

        longitude:
            null
    };


    ASIYE.state.route = {

        distanceKm:
            0,

        durationMinutes:
            0,

        geometry:
            null
    };
};
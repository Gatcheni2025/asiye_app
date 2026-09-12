/* ============================================================
   ASIYE DRIVER V2
   LOCATION

   Continuous GPS watch. Pushes the driver's live position
   into:
     - ASIYE_DRIVER.state.location       (local state)
     - ASIYE_DRIVER.map                  (live car on map)
     - taxis/{driverId}                  (Firebase, for passengers)
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};


ASIYE_DRIVER.location = {

    watchId:
        null,

    lastPosition:
        null,

    lastSyncAt:
        0,

    /*
     * Minimum ms between Firebase writes.
     * Prevents hammering the DB when the
     * GPS emits bursts of samples.
     */

    minSyncIntervalMs:
        2000,


    /* ========================================================
       START
       ======================================================== */

    start() {

        if (
            !('geolocation' in navigator)
        ) {

            console.error(
                '❌ Geolocation is not supported.'
            );


            ASIYE_DRIVER.ui?.toast(
                'Location services are not available on this device.',
                'danger'
            );

            return;
        }


        /*
         * Do not double-subscribe.
         */

        if (
            this.watchId !== null
        ) {

            return;
        }


        this.watchId =

            navigator
                .geolocation
                .watchPosition(

                    position => {

                        this.handlePosition(
                            position
                        );
                    },

                    error => {

                        console.warn(
                            'Driver GPS error:',
                            error
                        );


                        this.handleError(
                            error
                        );
                    },

                    {
                        enableHighAccuracy:
                            true,

                        maximumAge:
                            2000,

                        timeout:
                            12000
                    }
                );


        console.log(
            '✅ Driver GPS watch started.'
        );
    },


    /* ========================================================
       STOP
       ======================================================== */

    stop() {

        if (
            this.watchId === null
        ) {

            return;
        }


        navigator
            .geolocation
            .clearWatch(
                this.watchId
            );


        this.watchId =
            null;


        console.log(
            '🛑 Driver GPS watch stopped.'
        );
    },


    /* ========================================================
       HANDLE POSITION
       ======================================================== */

    handlePosition(
        position
    ) {

        if (
            !position?.coords
        ) {

            return;
        }


        const latitude =

            Number(
                position.coords.latitude
            );


        const longitude =

            Number(
                position.coords.longitude
            );


        if (
            !Number.isFinite(
                latitude
            ) ||
            !Number.isFinite(
                longitude
            )
        ) {

            return;
        }


        const heading =

            Number.isFinite(
                position.coords.heading
            )

            ? position.coords.heading

            : 0;


        const speed =

            Number.isFinite(
                position.coords.speed
            )

            ? position.coords.speed

            : 0;


        const accuracy =

            Number.isFinite(
                position.coords.accuracy
            )

            ? position.coords.accuracy

            : null;


        this.lastPosition =
            position;


        /*
         * 1) Local state.
         */

        ASIYE_DRIVER.setLocation(

            latitude,

            longitude,

            {
                accuracy:
                    accuracy,

                heading:
                    heading,

                speed:
                    speed
            }
        );


        /*
         * 2) Live car on the driver's own map.
         */

        ASIYE_DRIVER.map
            ?.showDriverLocation?.(

                latitude,

                longitude,

                heading
            );


        /*
         * 3) Firebase — throttled.
         */

        const now =
            Date.now();


        if (
            now - this.lastSyncAt <
            this.minSyncIntervalMs
        ) {

            return;
        }


        this.lastSyncAt =
            now;


        this.pushToFirebase(

            latitude,

            longitude,

            heading,

            speed,

            accuracy
        );
    },


    /* ========================================================
       PUSH TO FIREBASE
       ======================================================== */

    pushToFirebase(

        latitude,

        longitude,

        heading,

        speed,

        accuracy
    ) {

        const driverId =

            ASIYE_DRIVER.state
                ?.driverId;


        if (!driverId) {

            return;
        }


        firebase
            .database()
            .ref(
                `taxis/${driverId}`
            )
            .update({

                latitude:
                    latitude,

                longitude:
                    longitude,

                heading:
                    heading,

                speed:
                    speed,

                accuracy:
                    accuracy,

                lastSeen:

                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            })
            .catch(
                error => {

                    console.warn(
                        'Driver location sync failed:',
                        error
                    );
                }
            );
    },


    /* ========================================================
       HANDLE ERROR
       ======================================================== */

    handleError(
        error
    ) {

        if (!error) {

            return;
        }


        /*
         * 1 = PERMISSION_DENIED
         * 2 = POSITION_UNAVAILABLE
         * 3 = TIMEOUT
         */

        let message =
            'Unable to read your location.';


        switch (error.code) {

            case 1:

                message =
                    'Location permission denied. Enable GPS access.';

                break;


            case 2:

                message =
                    'Location unavailable. Move to an open area.';

                break;


            case 3:

                message =
                    'Location request timed out.';

                break;
        }


        ASIYE_DRIVER.ui?.toast(
            message,
            'warning'
        );
    }

};
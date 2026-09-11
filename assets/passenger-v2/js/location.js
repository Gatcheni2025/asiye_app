/* ============================================================
   ASIYE PASSENGER V2
   LOCATION SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.location = {

    watchId: null,

    async start() {

        if (!navigator.geolocation) {

            ASIYE.ui?.toast(
                'Location is not supported on this device.'
            );

            return;
        }

        navigator.geolocation.getCurrentPosition(

            position => {

                this.handlePosition(
                    position,
                    true
                );
            },

            error => {

                console.warn(
                    'Initial location error:',
                    error
                );

                this.handleError(error);
            },

            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 5000
            }
        );


        this.watchId =
            navigator.geolocation.watchPosition(

                position => {

                    this.handlePosition(
                        position,
                        false
                    );
                },

                error => {

                    console.warn(
                        'Location watch error:',
                        error
                    );
                },

                {
                    enableHighAccuracy: true,
                    timeout: 20000,
                    maximumAge: 8000
                }
            );
    },


    async handlePosition(
        position,
        shouldCenter
    ) {

        const lat =
            Number(
                position.coords.latitude
            );

        const lng =
            Number(
                position.coords.longitude
            );

        const accuracy =
            Number(
                position.coords.accuracy
            );


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {

            return;
        }


        ASIYE.setLocation(
            lat,
            lng,
            ASIYE.state.location.address,
            accuracy
        );


        ASIYE.map?.showUserLocation(
            lat,
            lng
        );


        if (
            shouldCenter &&
            ASIYE.map?.instance
        ) {

            ASIYE.map.instance.easeTo({

                center: [
                    lng,
                    lat
                ],

                zoom: 15,

                duration: 700,

                essential: true
            });
        }


        /*
         * Reverse geocode only if no current address
         * or user moved significantly later.
         */

        if (
            !ASIYE.state.location.address
        ) {

            const address =
                await this.reverseGeocode(
                    lat,
                    lng
                );


            if (address) {

                ASIYE.state.location.address =
                    address;


                const text =
                    document.getElementById(
                        'currentLocationText'
                    );


                if (text) {

                    text.textContent =
                        address;
                }


                const pickupInput =
                    document.getElementById(
                        'pickupInput'
                    );


                if (pickupInput) {

                    pickupInput.value =
                        address;
                }
            }
        }
    },


    async reverseGeocode(
        lat,
        lng
    ) {

        const token =
            window.ASIYE_CONFIG
                ?.mapboxToken;


        if (!token) {

            return 'Current location';
        }


        try {

            const url =

                `https://api.mapbox.com/geocoding/v5/mapbox.places/` +

                `${lng},${lat}.json` +

                `?access_token=${encodeURIComponent(token)}` +

                `&types=address,place,locality,neighborhood` +

                `&limit=1`;


            const response =
                await fetch(url);


            if (!response.ok) {

                throw new Error(
                    `Reverse geocode failed: ${response.status}`
                );
            }


            const data =
                await response.json();


            const feature =
                data.features?.[0];


            if (!feature) {

                return 'Current location';
            }


            return (
                feature.place_name ||
                feature.text ||
                'Current location'
            );


        } catch (error) {

            console.warn(
                'Reverse geocoding failed:',
                error
            );


            return 'Current location';
        }
    },


    handleError(error) {

        let message =
            'Unable to get your location.';


        if (
            error?.code === 1
        ) {

            message =
                'Location permission was denied. Please allow location access.';
        }


        if (
            error?.code === 2
        ) {

            message =
                'Your location is currently unavailable.';
        }


        if (
            error?.code === 3
        ) {

            message =
                'Location request timed out.';
        }


        ASIYE.ui?.toast(
            message
        );


        const text =
            document.getElementById(
                'currentLocationText'
            );


        if (text) {

            text.textContent =
                'Location unavailable';
        }
    },


    stop() {

        if (
            this.watchId !== null
        ) {

            navigator.geolocation
                .clearWatch(
                    this.watchId
                );


            this.watchId =
                null;
        }
    }

};
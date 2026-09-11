/* ============================================================
   ASIYE PASSENGER V2
   Map Controller
   ============================================================ */

window.ASIYE = window.ASIYE || {};


ASIYE.map = {

    instance:
        null,

    userMarker:
        null,

    destinationMarker:
        null,

    initialized:
        false,


    init() {

        if (
            typeof mapboxgl ===
            'undefined'
        ) {

            console.error(
                'Mapbox GL has not loaded.'
            );

            return;
        }


        /*
         * MAPBOX TOKEN
         *
         * Later move this into config.js.
         */

        const token =

            window.ASIYE_CONFIG
            ?.mapboxToken;


        if (!token) {

            console.warn(
                'No Mapbox token found in ASIYE_CONFIG.'
            );
        }


        mapboxgl.accessToken =
            token || '';


        /*
         * Default map position.
         *
         * This is temporary until GPS responds.
         */

        const defaultLng =
            31.0218;

        const defaultLat =
            -29.8587;


        try {

            this.instance =

                new mapboxgl.Map({

                    container:
                        'map',

                    style:
                        'mapbox://styles/mapbox/streets-v12',

                    center: [
                        defaultLng,
                        defaultLat
                    ],

                    zoom:
                        13,

                    pitch:
                        0,

                    bearing:
                        0,

                    attributionControl:
                        true
                });


            this.instance.on(
                'load',
                () => {

                    this.initialized =
                        true;


                    console.log(
                        '✅ Asiye V2 map ready'
                    );


                    const location =
                        ASIYE.state.location;


                    if (
                        Number.isFinite(
                            location.latitude
                        ) &&
                        Number.isFinite(
                            location.longitude
                        )
                    ) {

                        this.showUserLocation(

                            location.latitude,

                            location.longitude
                        );
                    }
                }
            );


        } catch (error) {

            console.error(
                'Unable to initialise Mapbox:',
                error
            );
        }
    },


    /* ========================================================
       USER LOCATION MARKER
       ======================================================== */

    showUserLocation(
        latitude,
        longitude
    ) {

        if (
            !this.instance ||
            !Number.isFinite(
                Number(latitude)
            ) ||
            !Number.isFinite(
                Number(longitude)
            )
        ) {

            return;
        }


        const lat =
            Number(latitude);

        const lng =
            Number(longitude);


        if (!this.userMarker) {

            const element =
                document.createElement(
                    'div'
                );


            element.className =
                'asiye-user-marker';


            element.innerHTML = `

                <div
                    style="
                        position:relative;

                        width:22px;
                        height:22px;

                        border-radius:50%;

                        background:#276ef1;

                        border:4px solid white;

                        box-shadow:
                            0 3px 12px
                            rgba(0,0,0,.25);
                    "
                >

                    <span
                        style="
                            position:absolute;

                            inset:-10px;

                            border-radius:50%;

                            background:
                                rgba(
                                    39,
                                    110,
                                    241,
                                    .16
                                );

                            z-index:-1;
                        "
                    ></span>

                </div>

            `;


            this.userMarker =

                new mapboxgl.Marker({

                    element:
                        element,

                    anchor:
                        'center'
                })

                .setLngLat([
                    lng,
                    lat
                ])

                .addTo(
                    this.instance
                );


        } else {

            this.userMarker
                .setLngLat([
                    lng,
                    lat
                ]);
        }
    },


    /* ========================================================
       CENTER USER
       ======================================================== */

    centerUser(
        zoom = 15
    ) {

        const location =
            ASIYE.state.location;


        if (
            !this.instance ||
            !Number.isFinite(
                location.latitude
            ) ||
            !Number.isFinite(
                location.longitude
            )
        ) {

            ASIYE.ui.toast(
                'Your current location is not available yet.'
            );

            return;
        }


        this.instance.easeTo({

            center: [

                location.longitude,

                location.latitude

            ],

            zoom:
                zoom,

            duration:
                700,

            essential:
                true
        });
    },


    resize() {

        if (
            this.instance &&
            typeof this.instance.resize ===
                'function'
        ) {

            this.instance.resize();
        }
    }

};
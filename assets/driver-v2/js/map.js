/* ============================================================
   ASIYE DRIVER V2
   MAP + NAVIGATION
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};


ASIYE_DRIVER.map = {

    instance:
        null,

    driverMarker:
        null,

    targetMarker:
        null,

    initialized:
        false,

    routeGeometry:
        null,


    /* ========================================================
       INITIALIZE
       ======================================================== */

    init() {

        if (
            this.instance
        ) {

            this.instance.resize();

            return;
        }


        if (
            typeof mapboxgl ===
            'undefined'
        ) {

            console.error(
                '❌ Mapbox GL is not loaded.'
            );

            return;
        }


        const token =

            window.ASIYE_DRIVER_CONFIG
                ?.mapboxToken;


        if (
            !token ||
            token ===
            'pk.eyJ1IjoiYXNpeWUxIiwiYSI6ImNtcWR2dHBydDEyMjIycXF5eThzcWUzcXUifQ.KgsJuS9O1OLDvAN2CMmrKw'
        ) {

            console.error(
                '❌ Driver Mapbox token missing.'
            );


            ASIYE_DRIVER.ui?.toast(
                'Map configuration is missing.',
                'danger'
            );

            return;
        }


        mapboxgl.accessToken =
            token;


        const stateLocation =
            ASIYE_DRIVER.state.location;


        const lat =

            Number.isFinite(
                stateLocation.latitude
            )

            ? stateLocation.latitude

            : -29.8587;


        const lng =

            Number.isFinite(
                stateLocation.longitude
            )

            ? stateLocation.longitude

            : 31.0218;


        try {

            this.instance =

                new mapboxgl.Map({

                    container:
                        'map',

                    style:
                        'mapbox://styles/mapbox/streets-v12',

                    center: [
                        lng,
                        lat
                    ],

                    zoom:
                        13,

                    attributionControl:
                        false
                });


            this.instance.addControl(

                new mapboxgl.NavigationControl({
                    showCompass:
                        false
                }),

                'bottom-right'
            );


            this.instance.on(
                'load',
                () => {

                    this.initialized =
                        true;


                    console.log(
                        '✅ Driver Mapbox ready'
                    );


                    this.instance.resize();


                    const location =
                        ASIYE_DRIVER.state.location;


                    if (
                        Number.isFinite(
                            location.latitude
                        ) &&
                        Number.isFinite(
                            location.longitude
                        )
                    ) {

                        this.showDriverLocation(

                            location.latitude,

                            location.longitude,

                            location.heading
                        );
                    }
                }
            );


            this.instance.on(
                'error',
                error => {

                    console.error(
                        'Mapbox error:',
                        error?.error ||
                        error
                    );
                }
            );


        } catch (error) {

            console.error(
                '❌ Driver map initialization failed:',
                error
            );
        }
    },


    /* ========================================================
       DRIVER MARKER
       ======================================================== */

    showDriverLocation(
        latitude,
        longitude,
        heading = 0
    ) {

        const lat =
            Number(latitude);


        const lng =
            Number(longitude);


        if (
            !this.instance ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {

            return;
        }


        if (
            !this.driverMarker
        ) {

            const element =
                document.createElement(
                    'div'
                );


            element.className =
                'asiye-driver-map-car';


            element.innerHTML = `

                <div class="asiye-driver-car-inner">

                    <i class="fas fa-car-side"></i>

                </div>

            `;


            this.driverMarker =

                new mapboxgl.Marker({

                    element:
                        element,

                    anchor:
                        'center',

                    rotationAlignment:
                        'map',

                    pitchAlignment:
                        'map'
                })

                .setLngLat([
                    lng,
                    lat
                ])

                .addTo(
                    this.instance
                );
        }


        this.driverMarker
            .setLngLat([
                lng,
                lat
            ]);


        if (
            Number.isFinite(
                Number(heading)
            )
        ) {

            this.driverMarker
                .setRotation(
                    Number(heading)
                );
        }
    },


    /* ========================================================
       CENTER DRIVER
       ======================================================== */

    centerDriver(
        zoom = 16
    ) {

        const location =
            ASIYE_DRIVER.state.location;


        if (
            !this.instance ||
            !Number.isFinite(
                location.latitude
            ) ||
            !Number.isFinite(
                location.longitude
            )
        ) {

            ASIYE_DRIVER.ui?.toast(
                'Waiting for GPS location.'
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
                650
        });
    },


    /* ========================================================
       ROUTE TO PICKUP / DESTINATION
       ======================================================== */

    async routeTo(
        target
    ) {

        if (
            !target ||
            !Number.isFinite(
                Number(
                    target.latitude
                )
            ) ||
            !Number.isFinite(
                Number(
                    target.longitude
                )
            )
        ) {

            return;
        }


        const driverLocation =
            ASIYE_DRIVER.state.location;


        if (
            !Number.isFinite(
                driverLocation.latitude
            ) ||
            !Number.isFinite(
                driverLocation.longitude
            )
        ) {

            ASIYE_DRIVER.ui?.toast(
                'Waiting for your GPS location.',
                'warning'
            );

            return;
        }


        const token =

            window.ASIYE_DRIVER_CONFIG
                ?.mapboxToken;


        if (!token) {

            return;
        }


        const destinationLat =
            Number(
                target.latitude
            );


        const destinationLng =
            Number(
                target.longitude
            );


        this.showTargetMarker(

            destinationLat,

            destinationLng,

            target.type
        );


        try {

            const url =

                `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +

                `${driverLocation.longitude},${driverLocation.latitude};` +

                `${destinationLng},${destinationLat}` +

                `?geometries=geojson` +

                `&overview=full` +

                `&steps=true` +

                `&alternatives=false` +

                `&access_token=${encodeURIComponent(token)}`;


            const response =
                await fetch(url);


            if (!response.ok) {

                throw new Error(
                    `Directions returned ${response.status}`
                );
            }


            const data =
                await response.json();


            const route =
                data.routes?.[0];


            if (!route) {

                throw new Error(
                    'No driving route was found.'
                );
            }


            this.routeGeometry =
                route.geometry;


            this.drawRoute(
                route.geometry
            );


            this.fitRoute(
                route.geometry
            );


            ASIYE_DRIVER.setNavigationTarget({

                type:
                    target.type,

                id:
                    target.id || null,

                name:
                    target.label,

                latitude:
                    destinationLat,

                longitude:
                    destinationLng,

                distanceKm:
                    route.distance / 1000,

                durationMinutes:
                    Math.max(
                        1,
                        Math.round(
                            route.duration / 60
                        )
                    ),

                geometry:
                    route.geometry
            });


            return {

                distanceKm:
                    route.distance / 1000,

                durationMinutes:
                    Math.round(
                        route.duration / 60
                    ),

                geometry:
                    route.geometry
            };


        } catch (error) {

            console.error(
                'Driver directions failed:',
                error
            );


            ASIYE_DRIVER.ui?.toast(
                'Unable to calculate navigation.',
                'danger'
            );


            return null;
        }
    },


    /* ========================================================
       TARGET MARKER
       ======================================================== */

    showTargetMarker(
        latitude,
        longitude,
        type = 'pickup'
    ) {

        if (
            !this.instance
        ) {

            return;
        }


        if (
            this.targetMarker
        ) {

            this.targetMarker.remove();

            this.targetMarker =
                null;
        }


        const element =
            document.createElement(
                'div'
            );


        element.className =
            'asiye-route-target';


        element.innerHTML = `

            <div class="asiye-route-target-inner">

                <i
                    class="
                        fas
                        ${
                            type === 'dropoff'
                            ? 'fa-location-dot'
                            : 'fa-user'
                        }
                    "
                ></i>

            </div>

        `;


        this.targetMarker =

            new mapboxgl.Marker({

                element:
                    element,

                anchor:
                    'center'
            })

            .setLngLat([

                longitude,

                latitude

            ])

            .addTo(
                this.instance
            );
    },


    /* ========================================================
       DRAW ROUTE
       ======================================================== */

    drawRoute(
        geometry
    ) {

        if (
            !this.instance ||
            !geometry
        ) {

            return;
        }


        const sourceId =
            'driver-route';


        const data = {

            type:
                'Feature',

            properties:
                {},

            geometry:
                geometry
        };


        if (
            this.instance.getSource(
                sourceId
            )
        ) {

            this.instance
                .getSource(
                    sourceId
                )
                .setData(
                    data
                );


            return;
        }


        this.instance.addSource(

            sourceId,

            {

                type:
                    'geojson',

                data:
                    data
            }
        );


        /*
         * White route border.
         */

        this.instance.addLayer({

            id:
                'driver-route-outline',

            type:
                'line',

            source:
                sourceId,

            layout: {

                'line-cap':
                    'round',

                'line-join':
                    'round'
            },

            paint: {

                'line-color':
                    '#ffffff',

                'line-width':
                    9,

                'line-opacity':
                    .95
            }
        });


        /*
         * Main black route.
         */

        this.instance.addLayer({

            id:
                'driver-route-line',

            type:
                'line',

            source:
                sourceId,

            layout: {

                'line-cap':
                    'round',

                'line-join':
                    'round'
            },

            paint: {

                'line-color':
                    '#111111',

                'line-width':
                    5,

                'line-opacity':
                    .95
            }
        });
    },


    /* ========================================================
       FIT ROUTE
       ======================================================== */

    fitRoute(
        geometry
    ) {

        if (
            !this.instance ||
            !geometry?.coordinates
        ) {

            return;
        }


        const bounds =
            new mapboxgl.LngLatBounds();


        geometry.coordinates
            .forEach(
                coord => {

                    bounds.extend(
                        coord
                    );
                }
            );


        this.instance.fitBounds(

            bounds,

            {

                padding: {

                    top:
                        110,

                    right:
                        55,

                    bottom:
                        310,

                    left:
                        55
                },

                duration:
                    750,

                maxZoom:
                    16
            }
        );
    },


    fitCurrentRoute() {

        if (
            this.routeGeometry
        ) {

            this.fitRoute(
                this.routeGeometry
            );
        }
    },


    /* ========================================================
       CLEAR ROUTE
       ======================================================== */

    clearRoute() {

        if (
            this.targetMarker
        ) {

            this.targetMarker.remove();

            this.targetMarker =
                null;
        }


        if (
            this.instance?.getLayer(
                'driver-route-line'
            )
        ) {

            this.instance.removeLayer(
                'driver-route-line'
            );
        }


        if (
            this.instance?.getLayer(
                'driver-route-outline'
            )
        ) {

            this.instance.removeLayer(
                'driver-route-outline'
            );
        }


        if (
            this.instance?.getSource(
                'driver-route'
            )
        ) {

            this.instance.removeSource(
                'driver-route'
            );
        }


        this.routeGeometry =
            null;


        ASIYE_DRIVER.clearNavigation();
    }

};
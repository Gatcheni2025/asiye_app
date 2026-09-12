/* ============================================================
   ASIYE PASSENGER V2
   Map Controller
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.map = {

    instance: null,

    userMarker: null,

    destinationMarker: null,

    initialized: false,

    driverMarker: null,

    driverLocation: null,


    init() {

        if (this.instance) {
            this.resize();
            return;
        }

        if (typeof mapboxgl === 'undefined') {

            console.error('Mapbox GL has not loaded.');

            return;
        }


        /*
         * MAPBOX TOKEN
         *
         * Later move this into config.js.
         */

        const token =
            window.ASIYE_CONFIG?.mapboxToken;


        if (!token) {

            console.warn('No Mapbox token found in ASIYE_CONFIG.');
        }


        mapboxgl.accessToken = token || '';


        /*
         * Default map position.
         *
         * This is temporary until GPS responds.
         */

        const defaultLng = 31.0218;
        const defaultLat = -29.8587;


        try {

            this.instance = new mapboxgl.Map({

                container: 'map',

                style: 'mapbox://styles/mapbox/streets-v12',

                center: [defaultLng, defaultLat],

                zoom: 13,

                pitch: 0,

                bearing: 0,

                attributionControl: true
            });


            this.instance.on('load', () => {

                this.initialized = true;

                this.resize();

                console.log('✅ Asiye V2 map ready');


                const location = ASIYE.state.location;


                if (
                    Number.isFinite(location.latitude) &&
                    Number.isFinite(location.longitude)
                ) {

                    this.showUserLocation(
                        location.latitude,
                        location.longitude
                    );
                }
            });

            if (this.driverLocation) {
                this.showDriverLocation(...this.driverLocation);
            }


        } catch (error) {

            console.error('Unable to initialise Mapbox:', error);
        }
    },


    /* ========================================================
       USER LOCATION MARKER
       ======================================================== */

    showDriverLocation(latitude, longitude, heading = 0) {
        if (latitude == null || longitude == null || latitude === '' || longitude === '') return;
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

        this.driverLocation = [lat, lng, heading];
        if (!this.instance) return;
        if (!this.driverMarker) {
            this.driverMarker = AsiyeLiveCar.create(this.instance, [lng, lat], heading);
        } else {
            AsiyeLiveCar.move(this.driverMarker, [lng, lat], heading);
        }
    },

    removeDriverMarker() {
        AsiyeLiveCar.stop(this.driverMarker);
        this.driverMarker?.remove();
        this.driverMarker = null;
        this.driverLocation = null;
    },

    showUserLocation(latitude, longitude) {

        if (
            !this.instance ||
            !Number.isFinite(Number(latitude)) ||
            !Number.isFinite(Number(longitude))
        ) {

            return;
        }


        const lat = Number(latitude);
        const lng = Number(longitude);


        if (!this.userMarker) {

            const element = document.createElement('div');

            element.className = 'asiye-user-marker';

            element.innerHTML = `
                <div
                    style="
                        position:relative;
                        width:22px;
                        height:22px;
                        border-radius:50%;
                        background:#276ef1;
                        border:4px solid white;
                        box-shadow: 0 3px 12px rgba(0,0,0,.25);
                    "
                >
                    <span
                        style="
                            position:absolute;
                            inset:-10px;
                            border-radius:50%;
                            background: rgba(39,110,241,.16);
                            z-index:-1;
                        "
                    ></span>
                </div>
            `;


            this.userMarker = new mapboxgl.Marker({
                element: element,
                anchor: 'center'
            })
                .setLngLat([lng, lat])
                .addTo(this.instance);


        } else {

            this.userMarker.setLngLat([lng, lat]);
        }
    },


    /* ========================================================
       CENTER USER
       ======================================================== */

    centerUser(zoom = 15) {

        const location = ASIYE.state.location;


        if (
            !this.instance ||
            !Number.isFinite(location.latitude) ||
            !Number.isFinite(location.longitude)
        ) {

            ASIYE.ui.toast('Your current location is not available yet.');

            return;
        }


        this.instance.easeTo({

            center: [location.longitude, location.latitude],

            zoom: zoom,

            duration: 700,

            essential: true
        });
    },


    resize() {

        if (
            this.instance &&
            typeof this.instance.resize === 'function'
        ) {

            this.instance.resize();
        }
    },


    /* ========================================================
       DESTINATION MARKER
       ======================================================== */

    showDestinationMarker(latitude, longitude) {

        if (
            !this.instance ||
            !Number.isFinite(Number(latitude)) ||
            !Number.isFinite(Number(longitude))
        ) {

            return;
        }


        const lat = Number(latitude);
        const lng = Number(longitude);


        if (this.destinationMarker) {

            this.destinationMarker.remove();
        }


        const element = document.createElement('div');

        element.innerHTML = `
            <div
                style="
                    width:36px;
                    height:36px;
                    border-radius:50%;
                    background:#111;
                    color:white;
                    border:3px solid white;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    box-shadow: 0 5px 16px rgba(0,0,0,.22);
                    font-size:13px;
                "
            >
                <i class="fas fa-location-dot"></i>
            </div>
        `;


        this.destinationMarker = new mapboxgl.Marker({
            element,
            anchor: 'center'
        })
            .setLngLat([lng, lat])
            .addTo(this.instance);
    },


    /* ========================================================
       ROUTE
       ======================================================== */

    drawRoute(geometry) {

        if (!this.instance || !geometry) {

            return;
        }


        const sourceId = 'asiye-route';
        const outlineId = 'asiye-route-outline';
        const layerId = 'asiye-route-line';


        const data = {
            type: 'Feature',
            properties: {},
            geometry: geometry
        };


        /*
         * If the source already exists, just
         * update the data and bail — the layers
         * are already on the map.
         */

        if (this.instance.getSource(sourceId)) {

            this.instance
                .getSource(sourceId)
                .setData(data);

            return;
        }


        this.instance.addSource(sourceId, {
            type: 'geojson',
            data: data
        });


        /*
         * White outline under the route.
         * Gives the black line a clean edge
         * over busy map tiles.
         */

        this.instance.addLayer({

            id: outlineId,

            type: 'line',

            source: sourceId,

            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },

            paint: {

                'line-color': '#ffffff',

                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 7,
                    15, 9
                ],

                'line-opacity': 0.95
            }
        });


        /*
         * Main black route line.
         */

        this.instance.addLayer({

            id: layerId,

            type: 'line',

            source: sourceId,

            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },

            paint: {

                'line-color': '#111111',

                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 4,
                    15, 6
                ],

                'line-opacity': 0.92
            }
        });
    },


    /* ========================================================
       FIT / CLEAR TRIP
       ======================================================== */

    fitTrip() {

        const pickup = ASIYE.state.location;
        const destination = ASIYE.state.destination;


        if (
            !this.instance ||
            !Number.isFinite(pickup.latitude) ||
            !Number.isFinite(pickup.longitude) ||
            !Number.isFinite(destination.latitude) ||
            !Number.isFinite(destination.longitude)
        ) {

            return;
        }


        const bounds = new mapboxgl.LngLatBounds();

        bounds.extend([pickup.longitude, pickup.latitude]);
        bounds.extend([destination.longitude, destination.latitude]);


        this.instance.fitBounds(bounds, {

            padding: {
                top: 110,
                left: 55,
                right: 55,
                bottom: 320
            },

            duration: 700,

            maxZoom: 15
        });
    },


    fitRouteGeometry(geometry) {

        if (
            !this.instance ||
            !geometry ||
            !Array.isArray(geometry.coordinates) ||
            geometry.coordinates.length === 0
        ) {

            return;
        }


        const bounds =
            new mapboxgl.LngLatBounds();


        geometry.coordinates
            .forEach(coord => {

                if (
                    Array.isArray(coord) &&
                    coord.length >= 2
                ) {

                    const lng = Number(coord[0]);
                    const lat = Number(coord[1]);


                    if (
                        Number.isFinite(lng) &&
                        Number.isFinite(lat)
                    ) {

                        bounds.extend([lng, lat]);
                    }
                }
            });


        if (bounds.isEmpty()) {

            return;
        }


        /*
         * More bottom padding because
         * ride selection sheet covers
         * part of the map.
         */

        this.instance.fitBounds(

            bounds,

            {

                padding: {

                    top: 110,

                    right: 55,

                    bottom: 360,

                    left: 55
                },

                duration: 850,

                maxZoom: 15
            }
        );
    },


    clearTrip() {

        if (this.destinationMarker) {

            this.destinationMarker.remove();
            this.destinationMarker = null;
        }


        if (this.instance?.getLayer('asiye-route-line')) {

            this.instance.removeLayer('asiye-route-line');
        }


        if (this.instance?.getLayer('asiye-route-outline')) {

            this.instance.removeLayer('asiye-route-outline');
        }


        if (this.instance?.getSource('asiye-route')) {

            this.instance.removeSource('asiye-route');
        }
    }

};

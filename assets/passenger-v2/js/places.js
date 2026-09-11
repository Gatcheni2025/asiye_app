/* ============================================================
   ASIYE PASSENGER V2
   GOOGLE PLACES SEARCH + MAPBOX DIRECTIONS
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.places = {

    autocompleteService: null,
    placesService: null,
    searchTimer: null,

    init() {

        if (
            !window.google ||
            !google.maps ||
            !google.maps.places
        ) {

            console.warn(
                'Google Places API not ready yet.'
            );

            return false;
        }

        if (!this.autocompleteService) {

            this.autocompleteService =
                new google.maps.places.AutocompleteService();
        }

        if (!this.placesService) {

            const dummyMap =
                document.createElement('div');

            this.placesService =
                new google.maps.places.PlacesService(
                    dummyMap
                );
        }

        console.log(
            '✅ Google Places ready'
        );

        return true;
    },


    search(query) {

        const value =
            String(query || '')
            .trim();


        if (value.length < 3) {

            this.renderSuggestions([]);

            return;
        }


        clearTimeout(
            this.searchTimer
        );


        this.searchTimer =
            setTimeout(
                () => {

                    this.performSearch(
                        value
                    );

                },
                250
            );
    },


    performSearch(query) {

        if (!this.init()) {

            ASIYE.ui?.toast(
                'Google location search is still loading.'
            );

            return;
        }


        const request = {

            input:
                query,

            componentRestrictions: {
                country: 'za'
            },

            types: [
                'geocode',
                'establishment'
            ]
        };


        const loc =
            ASIYE.state.location;


        if (
            Number.isFinite(
                loc.latitude
            ) &&
            Number.isFinite(
                loc.longitude
            )
        ) {

            request.locationBias = {

                center: {
                    lat:
                        loc.latitude,

                    lng:
                        loc.longitude
                },

                radius:
                    50000
            };
        }


        this.autocompleteService
            .getPlacePredictions(
                request,
                (
                    predictions,
                    status
                ) => {

                    if (
                        status !==
                        google.maps.places
                            .PlacesServiceStatus.OK
                    ) {

                        this.renderSuggestions([]);

                        return;
                    }


                    const results =
                        (predictions || [])
                        .map(item => ({

                            placeId:
                                item.place_id,

                            name:
                                item.structured_formatting
                                    ?.main_text ||
                                item.description,

                            address:
                                item.description,

                            secondary:
                                item.structured_formatting
                                    ?.secondary_text ||
                                ''
                        }));


                    this.renderSuggestions(
                        results
                    );
                }
            );
    },


    renderSuggestions(results) {

        const container =
            document.getElementById(
                'destinationSuggestions'
            );


        if (!container) return;


        if (
            !Array.isArray(results) ||
            results.length === 0
        ) {

            container.innerHTML = `

                <div
                    style="
                        padding:18px 6px;
                        color:#888;
                        font-size:11px;
                        text-align:center;
                    "
                >
                    Start typing a destination.
                </div>

            `;

            return;
        }


        container.innerHTML =
            results
            .map((place, index) => `

                <button
                    class="place-row"
                    data-place-index="${index}"
                >

                    <div class="place-icon">

                        <i class="fas fa-location-dot"></i>

                    </div>


                    <div class="place-info">

                        <span class="place-name">
                            ${ASIYE.ui.escape(
                                place.name
                            )}
                        </span>

                        <span class="place-address">
                            ${ASIYE.ui.escape(
                                place.secondary ||
                                place.address
                            )}
                        </span>

                    </div>


                    <i
                        class="fas fa-chevron-right"
                        style="
                            color:#aaa;
                            font-size:10px;
                        "
                    ></i>

                </button>

            `)
            .join('');


        container
            .querySelectorAll(
                '[data-place-index]'
            )
            .forEach(button => {

                button.addEventListener(
                    'click',
                    () => {

                        const index =
                            Number(
                                button.dataset.placeIndex
                            );


                        const place =
                            results[index];


                        if (!place) return;


                        this.resolvePlaceDetails(
                            place
                        );
                    }
                );
            });
    },


    resolvePlaceDetails(place) {

        if (
            !place?.placeId ||
            !this.placesService
        ) {

            return;
        }


        this.placesService
            .getDetails(
                {
                    placeId:
                        place.placeId,

                    fields: [
                        'name',
                        'formatted_address',
                        'geometry'
                    ]
                },
                async (
                    result,
                    status
                ) => {

                    if (
                        status !==
                        google.maps.places
                            .PlacesServiceStatus.OK ||
                        !result?.geometry?.location
                    ) {

                        ASIYE.ui?.toast(
                            'Could not load this destination.'
                        );

                        return;
                    }


                    const lat =
                        result.geometry.location.lat();


                    const lng =
                        result.geometry.location.lng();


                    const destination = {

                        name:
                            result.name ||
                            place.name,

                        address:
                            result.formatted_address ||
                            place.address,

                        latitude:
                            lat,

                        longitude:
                            lng,

                        placeId:
                            place.placeId
                    };


                    await this.selectDestination(
                        destination
                    );
                }
            );
    },


    async selectDestination(place) {

        ASIYE.setDestination(
            place
        );


        ASIYE.map
            ?.showDestinationMarker?.(

                place.latitude,

                place.longitude
            );


        const route =
            await this.calculateRoute();


        if (!route) {

            return;
        }


        ASIYE.ui
            .renderRideSelection();
    },


    async calculateRoute() {

        const origin =
            ASIYE.state.location;


        const destination =
            ASIYE.state.destination;


        if (
            !Number.isFinite(
                origin.latitude
            ) ||
            !Number.isFinite(
                origin.longitude
            ) ||
            !Number.isFinite(
                destination.latitude
            ) ||
            !Number.isFinite(
                destination.longitude
            )
        ) {

            ASIYE.ui.toast(
                'Pickup or destination location is missing.'
            );

            return null;
        }


        const token =
            window.ASIYE_CONFIG
                ?.mapboxToken;


        if (!token) {

            ASIYE.ui.toast(
                'Map routing is not configured.'
            );

            return null;
        }


        try {

            const url =

                `https://api.mapbox.com/directions/v5/mapbox/driving/` +

                `${origin.longitude},${origin.latitude};` +

                `${destination.longitude},${destination.latitude}` +

                `?geometries=geojson` +

                `&overview=full` +

                `&steps=false` +

                `&alternatives=false` +

                `&access_token=${encodeURIComponent(token)}`;


            const response =
                await fetch(url);


            if (!response.ok) {

                throw new Error(
                    `Directions failed: ${response.status}`
                );
            }


            const data =
                await response.json();


            const route =
                data.routes?.[0];


            if (!route) {

                throw new Error(
                    'No route found'
                );
            }


            ASIYE.state.route = {

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
            };


            ASIYE.map
                ?.drawRoute?.(
                    route.geometry
                );


            /*
             * IMPORTANT:
             * Fit the full route, not just
             * the two points.
             */

            ASIYE.map
                ?.fitRouteGeometry?.(
                    route.geometry
                );


            return ASIYE.state.route;


        } catch (error) {

            console.error(
                'Route calculation failed:',
                error
            );


            ASIYE.ui.toast(
                'Could not calculate the route.'
            );


            return null;
        }
    }

};
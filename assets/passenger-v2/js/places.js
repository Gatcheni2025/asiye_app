/* ============================================================
   ASIYE PASSENGER V2
   PLACES + ROUTE SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.places = {

    searchTimer: null,

    async search(query) {

        const value =
            String(query || '')
            .trim();


        if (
            value.length < 3
        ) {

            this.renderSuggestions([]);

            return;
        }


        clearTimeout(
            this.searchTimer
        );


        this.searchTimer =
            setTimeout(
                async () => {

                    await this.performSearch(
                        value
                    );

                },
                280
            );
    },


    async performSearch(query) {

        const token =
            window.ASIYE_CONFIG
                ?.mapboxToken;


        if (!token) {

            ASIYE.ui?.toast(
                'Map search is not configured yet.'
            );

            return;
        }


        const proximity =
            this.getProximity();


        try {

            let url =

                `https://api.mapbox.com/geocoding/v5/mapbox.places/` +

                `${encodeURIComponent(query)}.json` +

                `?access_token=${encodeURIComponent(token)}` +

                `&autocomplete=true` +

                `&limit=6` +

                `&country=za`;


            if (proximity) {

                url +=
                    `&proximity=${proximity.lng},${proximity.lat}`;
            }


            const response =
                await fetch(url);


            if (!response.ok) {

                throw new Error(
                    `Search failed: ${response.status}`
                );
            }


            const data =
                await response.json();


            const results =
                (data.features || [])
                .map(feature => ({

                    id:
                        feature.id,

                    name:
                        feature.text ||
                        feature.place_name,

                    address:
                        feature.place_name ||
                        feature.text,

                    longitude:
                        Number(
                            feature.center?.[0]
                        ),

                    latitude:
                        Number(
                            feature.center?.[1]
                        )

                }))
                .filter(item =>

                    Number.isFinite(
                        item.latitude
                    ) &&

                    Number.isFinite(
                        item.longitude
                    )
                );


            this.renderSuggestions(
                results
            );


        } catch (error) {

            console.error(
                'Destination search failed:',
                error
            );


            this.renderError();
        }
    },


    getProximity() {

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

            return {

                lat:
                    loc.latitude,

                lng:
                    loc.longitude
            };
        }


        return null;
    },


    renderSuggestions(results) {

        const container =
            document.getElementById(
                'destinationSuggestions'
            );


        if (!container) {

            return;
        }


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
                    async () => {

                        const index =
                            Number(
                                button.dataset.placeIndex
                            );


                        const place =
                            results[index];


                        if (!place) return;


                        await this.selectDestination(
                            place
                        );
                    }
                );
            });
    },


    renderError() {

        const container =
            document.getElementById(
                'destinationSuggestions'
            );


        if (!container) return;


        container.innerHTML = `

            <div
                style="
                    padding:18px 6px;
                    text-align:center;
                    color:#888;
                    font-size:11px;
                "
            >
                Could not search right now.
                Please try again.
            </div>

        `;
    },


    async selectDestination(place) {

        ASIYE.setDestination(
            place
        );


        ASIYE.map?.showDestinationMarker?.(

            place.latitude,

            place.longitude
        );


        await this.calculateRoute();


        ASIYE.ui.renderRideSelection();
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

                `&access_token=${encodeURIComponent(token)}`;


            const response =
                await fetch(url);


            if (!response.ok) {

                throw new Error(
                    `Route request failed: ${response.status}`
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


            ASIYE.map?.drawRoute?.(
                route.geometry
            );


            ASIYE.map?.fitTrip?.();


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
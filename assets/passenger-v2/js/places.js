/* ============================================================
   ASIYE PASSENGER V2
   GOOGLE PLACES SEARCH + MAPBOX DIRECTIONS
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.places = {

    autocompleteService: null,
    placesService: null,
    geocoder: null,
    searchTimer: null,
    initAttempts: 0,
    activeQuery: '',

    /* Saved commuter places intentionally keep the existing database
       structure compatible: the richer object lives in savedPlaces,
       while homeAddress/workAddress remain simple strings for older UI. */
    getSavedPlace(kind) {
        const key = kind === 'work' ? 'work' : 'home';
        const user = ASIYE.state?.user || {};
        const saved = user.savedPlaces?.[key] || user[`${key}Location`] || user[`${key}Place`] || null;
        const address = (
            saved?.address ||
            saved?.formattedAddress ||
            user[`${key}Address`] ||
            ''
        );

        const latitude = Number(
            saved?.latitude ??
            saved?.lat ??
            user[`${key}Latitude`] ??
            user[`${key}Lat`]
        );
        const longitude = Number(
            saved?.longitude ??
            saved?.lng ??
            saved?.lon ??
            user[`${key}Longitude`] ??
            user[`${key}Lng`]
        );

        if (!address && !Number.isFinite(latitude) && !Number.isFinite(longitude)) {
            return null;
        }

        return {
            name: key === 'work' ? 'Work' : 'Home',
            address: address || (key === 'work' ? 'Saved work location' : 'Saved home location'),
            latitude,
            longitude,
            placeId: saved?.placeId || null,
            kind: key
        };
    },

    distanceKm(a, b) {
        if (
            !Number.isFinite(Number(a?.latitude)) ||
            !Number.isFinite(Number(a?.longitude)) ||
            !Number.isFinite(Number(b?.latitude)) ||
            !Number.isFinite(Number(b?.longitude))
        ) return Infinity;

        const toRad = value => Number(value) * Math.PI / 180;
        const earthKm = 6371;
        const dLat = toRad(Number(b.latitude) - Number(a.latitude));
        const dLon = toRad(Number(b.longitude) - Number(a.longitude));
        const lat1 = toRad(a.latitude);
        const lat2 = toRad(b.latitude);

        const h =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) ** 2;

        return earthKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    },

    getCommuteSuggestion() {
        const current = ASIYE.state?.location || {};
        const home = this.getSavedPlace('home');
        const work = this.getSavedPlace('work');

        if (home && work) {
            const homeDistance = this.distanceKm(current, home);
            const workDistance = this.distanceKm(current, work);

            if (homeDistance <= 3) return 'work';
            if (workDistance <= 3) return 'home';
        }

        return null;
    },

    async useSavedPlace(kind) {
        const key = kind === 'work' ? 'work' : 'home';
        const saved = this.getSavedPlace(key);

        if (
            saved &&
            Number.isFinite(saved.latitude) &&
            Number.isFinite(saved.longitude)
        ) {
            ASIYE.state.ui.preferredRideType = 'club4';
            return this.selectDestination(saved);
        }

        this.beginSavePlace(key);
        return null;
    },

    beginSavePlace(kind) {
        const key = kind === 'work' ? 'work' : 'home';
        ASIYE.state.ui.savedPlaceTarget = key;

        const input = document.getElementById('destinationInput');
        if (input) {
            input.value = '';
            input.placeholder = key === 'work'
                ? 'Search your work address'
                : 'Search your home address';
            input.focus();
        }

        const container = document.getElementById('destinationSuggestions');
        if (container) {
            container.innerHTML = `
                <div class="saved-place-setup">
                    <i class="fas ${key === 'work' ? 'fa-briefcase' : 'fa-house'}"></i>
                    <div>
                        <strong>Set your ${key} location</strong>
                        <span>Search and choose the exact address. We will save it for faster work trips.</span>
                    </div>
                </div>
            `;
        }

        ASIYE.ui?.toast(
            key === 'work'
                ? 'Search and select your work address.'
                : 'Search and select your home address.'
        );
    },

    async savePlace(kind, place) {
        const key = kind === 'work' ? 'work' : 'home';
        const passengerId = ASIYE.state?.userId;

        if (
            !passengerId ||
            !Number.isFinite(Number(place?.latitude)) ||
            !Number.isFinite(Number(place?.longitude))
        ) {
            throw new Error('This saved place is missing its map location.');
        }

        const saved = {
            name: key === 'work' ? 'Work' : 'Home',
            address: place.address || place.name || '',
            latitude: Number(place.latitude),
            longitude: Number(place.longitude),
            placeId: place.placeId || null,
            updatedAt: firebase.database.ServerValue.TIMESTAMP
        };

        const updates = {
            [`savedPlaces/${key}`]: saved,
            [`${key}Address`]: saved.address,
            [`${key}Latitude`]: saved.latitude,
            [`${key}Longitude`]: saved.longitude
        };

        await firebase
            .database()
            .ref(`commuters/${passengerId}`)
            .update(updates);

        const user = ASIYE.state.user || {};
        ASIYE.state.user = {
            ...user,
            savedPlaces: {
                ...(user.savedPlaces || {}),
                [key]: saved
            },
            [`${key}Address`]: saved.address,
            [`${key}Latitude`]: saved.latitude,
            [`${key}Longitude`]: saved.longitude
        };

        return saved;
    },

    onGoogleReady() {
        this.initAttempts = 0;
        this.init();
        if (this.activeQuery.length >= 3) {
            this.performSearch(this.activeQuery);
        }
    },

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

        if (!this.geocoder) {
            this.geocoder = new google.maps.Geocoder();
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

        clearTimeout(this.searchTimer);
        this.activeQuery = String(query || '').trim();

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

        if (this.activeQuery !== query) return;

        if (!this.init()) {
            if (this.initAttempts++ < 12) {
                this.searchMessage('Connecting to Google Places…');
                return setTimeout(() => {
                    if (this.activeQuery === query) this.performSearch(query);
                }, 500);
            }
            return this.searchAddresses(query);
        }

        this.initAttempts = 0;


        const request = {

            input:
                query,

            componentRestrictions: {
                country: 'za'
            }
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


        const timeout = setTimeout(() => {
            if (this.activeQuery === query) this.searchWithGoogleGeocoder(query);
        }, 10000);
        this.searchMessage('Searching Google locations…');

        try {
            this.autocompleteService
            .getPlacePredictions(
                request,
                (
                    predictions,
                    status
                ) => {

                    clearTimeout(timeout);

                    if (this.activeQuery !== query) return;

                    if (
                        status !==
                        google.maps.places
                            .PlacesServiceStatus.OK
                    ) {

                        return this.searchWithGoogleGeocoder(query);
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
        } catch (error) {
            console.error('Google Places search failed:', error);
            clearTimeout(timeout);
            this.searchWithGoogleGeocoder(query);
        }
    },


    searchWithGoogleGeocoder(query) {
        if (!this.geocoder && !this.init()) {
            return this.searchAddresses(query);
        }

        this.geocoder.geocode(
            {
                address: query,
                componentRestrictions: { country: 'ZA' },
                region: 'ZA'
            },
            (results, status) => {
                if (query !== this.activeQuery) return;
                if (status !== google.maps.GeocoderStatus.OK || !results?.length) {
                    return this.searchAddresses(query);
                }

                const places = results.slice(0, 8).map(result => ({
                    placeId: result.place_id,
                    name: result.address_components?.[0]?.long_name ||
                        result.formatted_address,
                    address: result.formatted_address,
                    secondary: result.formatted_address,
                    latitude: result.geometry.location.lat(),
                    longitude: result.geometry.location.lng()
                }));
                this.renderSuggestions(places);
            }
        );
    },


    async searchAddresses(query) {
        try {
            const params = new URLSearchParams({ q: query, country: 'za', limit: '6', access_token: ASIYE_CONFIG.mapboxToken });
            const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
            if (!response.ok) throw new Error(`Address search: ${response.status}`);
            const data = await response.json();
            if (query !== this.activeQuery) return;
            const results = (data.features || []).map(feature => ({
                name: feature.properties?.name || feature.properties?.full_address,
                address: feature.properties?.full_address || feature.properties?.name,
                latitude: feature.geometry?.coordinates?.[1], longitude: feature.geometry?.coordinates?.[0]
            })).filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
            this.renderSuggestions(results);
            if (!results.length) this.searchMessage('No addresses found. Try a street name and suburb.');
        } catch {
            if (query === this.activeQuery) this.searchMessage('Location search is unavailable. Check your connection and try again.');
        }
    },

    searchMessage(message) {
        const container = document.getElementById('destinationSuggestions');
        if (container) container.textContent = message;
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

        if (Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude)) return this.selectDestination(place);

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

        const saveTarget =
            ASIYE.state?.ui?.savedPlaceTarget || null;

        if (saveTarget) {
            try {
                place = await this.savePlace(
                    saveTarget,
                    place
                );

                ASIYE.state.ui.savedPlaceTarget = null;
                ASIYE.state.ui.preferredRideType = 'club4';

                ASIYE.ui?.toast(
                    `${saveTarget === 'work' ? 'Work' : 'Home'} saved for Asiye Work.`
                );
            } catch (error) {
                console.error('Could not save commuter place:', error);
                ASIYE.ui?.toast(
                    error?.message ||
                    'Could not save this location.'
                );
                return;
            }
        }

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

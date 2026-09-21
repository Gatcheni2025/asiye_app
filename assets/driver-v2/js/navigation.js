/* Traffic-aware destination guidance with turn-by-turn voice and road context. */
window.ASIYE_DRIVER = window.ASIYE_DRIVER || {};

ASIYE_DRIVER.navigator = {
    target: null,
    route: null,
    steps: [],
    follow: true,
    navigationMode: false,
    generation: 0,
    stepIndex: 0,
    loading: false,
    lastFetch: 0,
    spokenInstructions: new Set(),
    voiceEnabled:
        localStorage.getItem('asiyeNavigationVoice') !== 'off',

    start(request) {
        const point =
            request.destinationCoords ||
            request.dropoffLocation ||
            {};

        const lat =
            point.latitude ??
            point.lat;

        const lng =
            point.longitude ??
            point.lng;

        if (
            lat == null ||
            lng == null ||
            !Number.isFinite(Number(lat)) ||
            !Number.isFinite(Number(lng)) ||
            Math.abs(Number(lat)) > 90 ||
            Math.abs(Number(lng)) > 180
        ) {
            this.stop();
            this.text(
                'navInstruction',
                'Destination coordinates unavailable'
            );
            return;
        }

        const key =
            `${request.requestId || request.key || ASIYE_DRIVER.trip?.requestId}:${lat},${lng}`;

        if (this.key !== key) {
            this.stop();
            this.key = key;
            this.target = [
                Number(lng),
                Number(lat)
            ];
            this.follow = true;
            this.spokenInstructions.clear();
        }

        document.body.classList.add(
            'destination-navigation',
            'navigation-camera-mode'
        );

        /*
         * Navigation opens in proper follow mode automatically. The driver can
         * still tap the map/navigation control to leave the pitched camera.
         */
        this.navigationMode = true;
        this.follow = true;
        ASIYE_DRIVER.map.followDriver = true;

        this.updateNavigationButton();
        this.updateVoiceButton();

        const map =
            ASIYE_DRIVER.map.instance;

        if (
            map &&
            this.boundMap !== map
        ) {
            this.boundMap = map;

            map.on(
                'dragstart',
                () => {
                    if (this.navigationMode) {
                        this.follow = false;
                    }
                }
            );
        }

        const follow =
            document.getElementById(
                'navFollow'
            );

        if (follow) {
            follow.onclick =
                () => {
                    this.follow = true;
                    this.update(
                        ASIYE_DRIVER.state.location
                    );
                };
        }

        const retry =
            document.getElementById(
                'navRetry'
            );

        if (retry) {
            retry.onclick =
                () => this.fetchRoute();
        }

        const voice =
            document.getElementById(
                'navVoiceToggle'
            );

        if (voice) {
            voice.onclick =
                () => this.toggleVoice();
        }

        this.update(
            ASIYE_DRIVER.state.location
        );
    },

    text(id, value) {
        const element =
            document.getElementById(id);

        if (element) {
            element.textContent =
                value;
        }
    },

    updateNavigationButton() {
        const button =
            document.getElementById(
                'driverNavigationButton'
            );

        if (!button) return;

        button.classList
            ?.toggle?.(
                'active',
                this.navigationMode
            );

        button.setAttribute?.(
            'aria-label',
            this.navigationMode
                ? 'Exit navigation'
                : 'Navigation'
        );

        button.title =
            this.navigationMode
                ? 'Exit navigation'
                : 'Navigation';

        const icon =
            button.querySelector('i');

        if (icon) {
            icon.className =
                this.navigationMode
                    ? 'fas fa-map'
                    : 'fas fa-route';
        }
    },

    updateVoiceButton() {
        const button =
            document.getElementById(
                'navVoiceToggle'
            );

        if (!button) return;

        button.classList.toggle(
            'muted',
            !this.voiceEnabled
        );

        button.setAttribute(
            'aria-pressed',
            this.voiceEnabled
                ? 'true'
                : 'false'
        );

        const icon =
            button.querySelector('i');

        if (icon) {
            icon.className =
                this.voiceEnabled
                    ? 'fas fa-volume-high'
                    : 'fas fa-volume-xmark';
        }

        this.text(
            'navVoiceLabel',
            this.voiceEnabled
                ? 'Voice on'
                : 'Voice off'
        );
    },

    toggleVoice() {
        this.voiceEnabled =
            !this.voiceEnabled;

        localStorage.setItem(
            'asiyeNavigationVoice',
            this.voiceEnabled
                ? 'on'
                : 'off'
        );

        this.updateVoiceButton();

        if (this.voiceEnabled) {
            this.speak(
                'Voice guidance on',
                true
            );
        } else {
            window.speechSynthesis
                ?.cancel?.();
        }
    },

    speak(text, force = false) {
        const announcement =
            String(text || '')
                .trim();

        if (
            !announcement ||
            (!this.voiceEnabled && !force)
        ) {
            return;
        }

        if (
            !('speechSynthesis' in window) ||
            typeof SpeechSynthesisUtterance ===
                'undefined'
        ) {
            return;
        }

        try {
            const utterance =
                new SpeechSynthesisUtterance(
                    announcement
                );

            utterance.lang =
                'en-ZA';

            utterance.rate =
                1.02;

            utterance.pitch =
                1;

            utterance.volume =
                1;

            const voices =
                window.speechSynthesis
                    .getVoices?.() || [];

            const preferred =
                voices.find(
                    voice =>
                        /^en-ZA$/i.test(
                            voice.lang || ''
                        )
                ) ||
                voices.find(
                    voice =>
                        /^en/i.test(
                            voice.lang || ''
                        )
                );

            if (preferred) {
                utterance.voice =
                    preferred;
            }

            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(
                utterance
            );

        } catch (error) {
            console.warn(
                'Navigation voice unavailable:',
                error
            );
        }
    },

    enterNavigationMode() {
        this.navigationMode = true;
        this.follow = true;

        document.body.classList.add(
            'navigation-camera-mode'
        );

        ASIYE_DRIVER.map.followDriver =
            true;

        this.updateNavigationButton();

        if (this.target) {
            this.update(
                ASIYE_DRIVER.state.location
            );
        } else {
            const location =
                ASIYE_DRIVER.state?.location ||
                {};

            ASIYE_DRIVER.map
                ?.followDriverNavigationView?.(
                    location.latitude,
                    location.longitude,
                    location.heading
                );
        }
    },

    exitNavigationMode() {
        this.navigationMode = false;
        this.follow = true;

        document.body.classList.remove(
            'navigation-camera-mode'
        );

        ASIYE_DRIVER.map.followDriver =
            true;

        this.updateNavigationButton();

        const location =
            ASIYE_DRIVER.state?.location ||
            {};

        if (
            Number.isFinite(
                location.latitude
            ) &&
            Number.isFinite(
                location.longitude
            )
        ) {
            ASIYE_DRIVER.map
                ?.followDriverTopView?.(
                    location.latitude,
                    location.longitude,
                    16
                );
        } else {
            ASIYE_DRIVER.map.instance
                ?.easeTo?.({
                    pitch: 0,
                    bearing: 0,
                    padding: 0,
                    duration: 500
                });
        }
    },

    toggleNavigationMode() {
        if (this.navigationMode) {
            this.exitNavigationMode();
        } else {
            this.enterNavigationMode();
        }
    },

    async fetchRoute() {
        const location =
            ASIYE_DRIVER.state.location;

        if (
            !this.target ||
            this.loading ||
            !Number.isFinite(
                location.latitude
            ) ||
            !Number.isFinite(
                location.longitude
            )
        ) {
            return;
        }

        const generation =
            this.generation;

        this.loading = true;
        this.lastFetch = Date.now();

        this.text(
            'navInstruction',
            this.route
                ? 'Updating route…'
                : 'Finding your route…'
        );

        try {
            const params =
                new URLSearchParams({
                    geometries:
                        'geojson',
                    overview:
                        'full',
                    steps:
                        'true',
                    voice_instructions:
                        'true',
                    banner_instructions:
                        'true',
                    voice_units:
                        'metric',
                    language:
                        'en',
                    roundabout_exits:
                        'true',
                    annotations:
                        'distance,duration,speed,congestion,congestion_numeric,maxspeed,closure',
                    notifications:
                        'all',
                    access_token:
                        ASIYE_DRIVER_CONFIG
                            .mapboxToken
                });

            const url =
                `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${location.longitude},${location.latitude};${this.target.join(',')}?${params.toString()}`;

            const response =
                await fetch(url);

            if (!response.ok) {
                throw new Error(
                    `Directions ${response.status}`
                );
            }

            const data =
                await response.json();

            if (
                generation !==
                this.generation
            ) {
                return;
            }

            const route =
                data.routes?.[0];

            if (
                !route?.geometry
                    ?.coordinates
                    ?.length ||
                !route.legs?.[0]
                    ?.steps?.length
            ) {
                throw new Error(
                    'No route available'
                );
            }

            this.route =
                route;

            this.steps =
                route.legs.flatMap(
                    leg =>
                        leg.steps || []
                );

            this.stepIndex =
                0;

            this.spokenInstructions
                .clear();

            ASIYE_DRIVER
                .setNavigationTarget?.({
                    type:
                        'dropoff',
                    latitude:
                        this.target[1],
                    longitude:
                        this.target[0],
                    distanceKm:
                        route.distance /
                        1000,
                    durationMinutes:
                        route.duration /
                        60,
                    geometry:
                        route.geometry
                });

            this.draw();

        } catch (error) {
            if (
                generation !==
                this.generation
            ) {
                return;
            }

            this.route =
                null;

            this.text(
                'navInstruction',
                'Route unavailable. Tap retry.'
            );

            this.text(
                'navDistance',
                '—'
            );

            this.text(
                'navEta',
                '—'
            );

            this.text(
                'navArrival',
                '—'
            );

            this.text(
                'navTurnDistance',
                'Check your connection'
            );

            this.showTrafficWarning(
                null
            );

            console.warn(
                'Destination navigation:',
                error
            );

        } finally {
            if (
                generation ===
                this.generation
            ) {
                this.loading =
                    false;

                if (this.route) {
                    this.update(
                        ASIYE_DRIVER.state
                            .location
                    );
                }
            }
        }
    },

    draw() {
        const map =
            ASIYE_DRIVER.map;

        if (
            !this.route ||
            !map.instance
                ?.isStyleLoaded()
        ) {
            return;
        }

        map.routeGeometry =
            this.route.geometry;

        map.drawRoute(
            this.route.geometry
        );

        map.showTargetMarker(
            this.target[1],
            this.target[0],
            'dropoff'
        );
    },

    /*
     * Project GPS onto road geometry and measure remaining distance.
     */
    project(point, coordinates) {
        const scale =
            Math.cos(
                point[1] *
                Math.PI /
                180
            );

        let best = {
            distance:
                Infinity,
            remaining:
                0,
            segmentIndex:
                0
        };

        let traversed =
            0;

        for (
            let i = 1;
            i < coordinates.length;
            i++
        ) {
            const a =
                coordinates[i - 1];

            const b =
                coordinates[i];

            const dx =
                (b[0] - a[0]) *
                scale *
                111320;

            const dy =
                (b[1] - a[1]) *
                111320;

            const px =
                (point[0] - a[0]) *
                scale *
                111320;

            const py =
                (point[1] - a[1]) *
                111320;

            const length =
                Math.hypot(
                    dx,
                    dy
                );

            const t =
                length
                    ? Math.max(
                        0,
                        Math.min(
                            1,
                            (
                                px * dx +
                                py * dy
                            ) /
                            (
                                length *
                                length
                            )
                        )
                    )
                    : 0;

            const distance =
                Math.hypot(
                    px -
                        t * dx,
                    py -
                        t * dy
                );

            if (
                distance <
                best.distance
            ) {
                best = {
                    distance,
                    along:
                        traversed +
                        t * length,
                    segmentIndex:
                        i - 1
                };
            }

            traversed +=
                length;
        }

        best.remaining =
            traversed -
            (best.along || 0);

        best.total =
            traversed;

        return best;
    },

    nearestRouteSegment(point) {
        const coordinates =
            this.route?.geometry
                ?.coordinates ||
            [];

        return this.project(
            point,
            coordinates
        );
    },

    annotationValues(name) {
        if (!this.route?.legs) {
            return [];
        }

        return this.route.legs
            .flatMap(
                leg =>
                    leg.annotation
                        ?.[name] ||
                    []
            );
    },

    updateSpeed(location, point) {
        const speedKmh =
            Number.isFinite(
                Number(
                    location?.speed
                )
            )
                ? Math.max(
                    0,
                    Math.round(
                        Number(
                            location.speed
                        ) * 3.6
                    )
                )
                : 0;

        this.text(
            'navCurrentSpeed',
            String(speedKmh)
        );

        const projection =
            this.nearestRouteSegment(
                point
            );

        const maxspeeds =
            this.annotationValues(
                'maxspeed'
            );

        const limit =
            maxspeeds[
                Math.max(
                    0,
                    Math.min(
                        Number(
                            projection
                                .segmentIndex
                        ) || 0,
                        maxspeeds.length -
                            1
                    )
                )
            ];

        let speedLimit =
            null;

        if (
            limit &&
            Number.isFinite(
                Number(limit.speed)
            )
        ) {
            speedLimit =
                Number(limit.speed);

            if (
                String(limit.unit)
                    .toLowerCase() ===
                'mph'
            ) {
                speedLimit *=
                    1.609344;
            }
        }

        this.text(
            'navSpeedLimit',
            Number.isFinite(speedLimit)
                ? String(
                    Math.round(
                        speedLimit
                    )
                )
                : '—'
        );

        const speedPanel =
            document.getElementById(
                'navCurrentSpeedPanel'
            );

        if (speedPanel) {
            speedPanel.classList.toggle(
                'over-limit',
                Number.isFinite(
                    speedLimit
                ) &&
                speedKmh >
                    speedLimit + 3
            );
        }

        return projection;
    },

    humanize(value) {
        return String(value || '')
            .replace(
                /[_-]+/g,
                ' '
            )
            .replace(
                /\b\w/g,
                letter =>
                    letter.toUpperCase()
            );
    },

    showTrafficWarning(message, severity = 'info') {
        const banner =
            document.getElementById(
                'navTrafficAlert'
            );

        if (!banner) return;

        if (!message) {
            banner.hidden =
                true;

            banner.className =
                'navigation-traffic-alert';

            return;
        }

        banner.hidden =
            false;

        banner.className =
            `navigation-traffic-alert ${severity}`;

        this.text(
            'navTrafficAlertText',
            message
        );
    },

    updateTraffic(segmentIndex) {
        const leg =
            this.route?.legs?.[0];

        if (!leg) {
            this.showTrafficWarning(
                null
            );
            return;
        }

        const index =
            Math.max(
                0,
                Number(segmentIndex) ||
                    0
            );

        const incidents =
            leg.incidents || [];

        const incident =
            incidents.find(
                item => {
                    const start =
                        Number(
                            item
                                .geometry_index_start ??
                            0
                        );

                    const end =
                        Number(
                            item
                                .geometry_index_end ??
                            start
                        );

                    return (
                        end >= index &&
                        start <=
                            index + 80
                    );
                }
            );

        if (incident) {
            const closed =
                incident.closed ===
                    true ||
                incident.type ===
                    'road_closure';

            const label =
                incident.description ||
                incident
                    .long_description ||
                this.humanize(
                    incident.type
                ) ||
                'Traffic incident ahead';

            this.showTrafficWarning(
                closed
                    ? `Road closure ahead · ${label}`
                    : label,
                closed
                    ? 'danger'
                    : 'warning'
            );

            return;
        }

        const congestion =
            leg.annotation
                ?.congestion_numeric ||
            [];

        let highest =
            0;

        for (
            let i = index;
            i <
                Math.min(
                    congestion.length,
                    index + 35
                );
            i++
        ) {
            const value =
                Number(
                    congestion[i]
                );

            if (
                Number.isFinite(value)
            ) {
                highest =
                    Math.max(
                        highest,
                        value
                    );
            }
        }

        if (highest >= 80) {
            this.showTrafficWarning(
                'Heavy traffic ahead',
                'danger'
            );
            return;
        }

        if (highest >= 55) {
            this.showTrafficWarning(
                'Traffic building ahead',
                'warning'
            );
            return;
        }

        const notification =
            (
                leg.notifications ||
                this.route
                    ?.notifications ||
                []
            )[0];

        if (notification) {
            this.showTrafficWarning(
                this.humanize(
                    notification
                        .subtype ||
                    notification.type ||
                    'Route alert'
                ),
                notification.type ===
                    'violation'
                    ? 'warning'
                    : 'info'
            );
            return;
        }

        this.showTrafficWarning(
            null
        );
    },

    bannerInstruction(step, remaining) {
        const banners =
            step?.bannerInstructions ||
            step?.banner_instructions ||
            [];

        const eligible =
            banners
                .filter(
                    item =>
                        Number.isFinite(
                            Number(
                                item
                                    .distanceAlongGeometry
                            )
                        ) &&
                        remaining <=
                            Number(
                                item
                                    .distanceAlongGeometry
                            ) + 12
                )
                .sort(
                    (a, b) =>
                        Number(
                            a
                                .distanceAlongGeometry
                        ) -
                        Number(
                            b
                                .distanceAlongGeometry
                        )
                );

        return (
            eligible[0] ||
            banners[0] ||
            null
        );
    },

    maybeSpeak(step, remaining, stepIndex) {
        if (!this.voiceEnabled) {
            return;
        }

        const instructions =
            step?.voiceInstructions ||
            step?.voice_instructions ||
            [];

        const candidates =
            instructions
                .filter(
                    item =>
                        Number.isFinite(
                            Number(
                                item
                                    .distanceAlongGeometry
                            )
                        ) &&
                        remaining <=
                            Number(
                                item
                                    .distanceAlongGeometry
                            ) + 12
                )
                .sort(
                    (a, b) =>
                        Number(
                            a
                                .distanceAlongGeometry
                        ) -
                        Number(
                            b
                                .distanceAlongGeometry
                        )
                );

        const instruction =
            candidates.find(
                item => {
                    const key =
                        `${stepIndex}:${item.distanceAlongGeometry}:${item.announcement}`;

                    return !this
                        .spokenInstructions
                        .has(key);
                }
            );

        if (!instruction) {
            return;
        }

        const key =
            `${stepIndex}:${instruction.distanceAlongGeometry}:${instruction.announcement}`;

        this.spokenInstructions
            .add(key);

        this.speak(
            instruction.announcement
        );
    },

    update(location) {
        if (
            !Number.isFinite(
                location?.latitude
            ) ||
            !Number.isFinite(
                location?.longitude
            )
        ) {
            this.text(
                'navInstruction',
                'Waiting for GPS…'
            );
            return;
        }

        if (!this.target) {
            if (
                this.navigationMode &&
                this.follow
            ) {
                ASIYE_DRIVER.map
                    ?.followDriverNavigationView?.(
                        location.latitude,
                        location.longitude,
                        location.heading
                    );
            }

            return;
        }

        const point = [
            location.longitude,
            location.latitude
        ];

        const map =
            ASIYE_DRIVER.map.instance;

        if (
            map &&
            this.navigationMode &&
            this.follow
        ) {
            const sheet =
                document.getElementById(
                    'activeTripContent'
                );

            map.easeTo({
                center:
                    point,
                zoom:
                    17.25,
                pitch:
                    58,
                bearing:
                    Number.isFinite(
                        location.heading
                    )
                        ? location.heading
                        : map.getBearing(),
                padding: {
                    top:
                        145,
                    bottom:
                        Math.min(
                            (
                                sheet
                                    ?.offsetHeight ||
                                250
                            ) + 24,
                            window
                                .innerHeight *
                                .46
                        ),
                    left:
                        34,
                    right:
                        34
                },
                duration:
                    650,
                essential:
                    true
            });
        }

        if (!this.route) {
            this.updateSpeed(
                location,
                point
            );

            if (
                !this.lastFetch ||
                Date.now() -
                    this.lastFetch >
                    15000
            ) {
                this.fetchRoute();
            }

            return;
        }

        const routeProjection =
            this.updateSpeed(
                location,
                point
            );

        this.updateTraffic(
            routeProjection
                .segmentIndex
        );

        const roadAccess =
            window.AsiyeRoadGuidance
                ?.nearest?.(
                    point,
                    this.route.geometry
                );

        if (
            roadAccess &&
            roadAccess.distance >
                (
                    AsiyeRoadGuidance
                        .thresholdMetres ||
                    35
                )
        ) {
            this.text(
                'navArrow',
                '↗'
            );

            this.text(
                'navTurnDistance',
                this.distance(
                    roadAccess.distance
                )
            );

            this.text(
                'navInstruction',
                'Return to the highlighted road'
            );

            if (
                !this.spokenInstructions
                    .has('off-route')
            ) {
                this.spokenInstructions
                    .add('off-route');

                this.speak(
                    'You are off route. Returning to the route.'
                );
            }

            return;
        }

        this.spokenInstructions
            .delete('off-route');

        let index =
            Math.min(
                this.stepIndex,
                Math.max(
                    0,
                    this.steps.length -
                        1
                )
            );

        let best =
            this.project(
                point,
                this.steps[index]
                    ?.geometry
                    ?.coordinates ||
                    []
            );

        /*
         * Only look ahead locally so nearby crossing roads cannot jump the
         * driver to a distant maneuver.
         */
        for (
            let i = index + 1;
            i <=
                Math.min(
                    index + 2,
                    this.steps.length -
                        1
                );
            i++
        ) {
            const candidate =
                this.project(
                    point,
                    this.steps[i]
                        ?.geometry
                        ?.coordinates ||
                        []
                );

            if (
                candidate.distance +
                    8 <
                best.distance
            ) {
                index =
                    i;

                best =
                    candidate;
            }
        }

        if (
            best.distance >
            60
        ) {
            this.text(
                'navInstruction',
                'Off route — finding a new route…'
            );

            if (
                !this.spokenInstructions
                    .has('rerouting')
            ) {
                this.spokenInstructions
                    .add('rerouting');

                this.speak(
                    'Off route. Recalculating.'
                );
            }

            if (
                Date.now() -
                    this.lastFetch >
                15000
            ) {
                this.fetchRoute();
            }

            return;
        }

        this.spokenInstructions
            .delete('rerouting');

        this.stepIndex =
            index;

        const step =
            this.steps[index];

        const next =
            this.steps[index + 1] ||
            step;

        let remaining =
            best.remaining;

        let seconds =
            (step.duration || 0) *
            (
                best.total
                    ? best.remaining /
                        best.total
                    : 0
            );

        for (
            let i = index + 1;
            i < this.steps.length;
            i++
        ) {
            remaining +=
                this.steps[i]
                    .distance ||
                0;

            seconds +=
                this.steps[i]
                    .duration ||
                0;
        }

        const arrived =
            remaining < 25;

        const banner =
            this.bannerInstruction(
                step,
                best.remaining
            );

        const modifier =
            banner?.primary
                ?.modifier ||
            next?.maneuver
                ?.modifier ||
            '';

        const direction =
            banner?.primary
                ?.text ||
            next?.maneuver
                ?.instruction ||
            'Continue on the route';

        const roadName =
            banner?.secondary
                ?.text ||
            next?.name ||
            step?.name ||
            '';

        this.text(
            'navArrow',
            arrived
                ? '●'
                : modifier
                    .includes('uturn')
                    ? '↶'
                    : modifier
                        .includes('left')
                        ? '↰'
                        : modifier
                            .includes('right')
                            ? '↱'
                            : '↑'
        );

        this.text(
            'navTurnDistance',
            arrived
                ? 'Destination nearby'
                : this.distance(
                    best.remaining
                )
        );

        this.text(
            'navInstruction',
            arrived
                ? 'You are near your destination'
                : direction
        );

        this.text(
            'navRoadName',
            roadName
        );

        this.text(
            'navDistance',
            this.distance(
                remaining
            )
        );

        this.text(
            'navEta',
            arrived
                ? 'Arriving'
                : `${Math.max(
                    1,
                    Math.ceil(
                        seconds / 60
                    )
                )} min`
        );

        this.text(
            'navArrival',
            new Date(
                Date.now() +
                seconds * 1000
            )
                .toLocaleTimeString(
                    [],
                    {
                        hour:
                            '2-digit',
                        minute:
                            '2-digit'
                    }
                )
        );

        if (arrived) {
            if (
                !this.spokenInstructions
                    .has('arrived')
            ) {
                this.spokenInstructions
                    .add('arrived');

                this.speak(
                    'You have arrived at your destination.'
                );
            }
        } else {
            this.maybeSpeak(
                step,
                best.remaining,
                index
            );
        }
    },

    distance(metres) {
        return metres < 1000
            ? `${Math.max(
                0,
                Math.round(
                    metres / 10
                ) * 10
            )} m`
            : `${(
                metres / 1000
            ).toFixed(1)} km`;
    },

    stop() {
        this.generation++;

        this.navigationMode =
            false;

        this.follow =
            true;

        document.body.classList
            .remove(
                'destination-navigation',
                'navigation-camera-mode'
            );

        this.updateNavigationButton();

        window.speechSynthesis
            ?.cancel?.();

        ASIYE_DRIVER.map.followDriver =
            true;

        const location =
            ASIYE_DRIVER.state
                ?.location ||
            {};

        if (
            Number.isFinite(
                location.latitude
            ) &&
            Number.isFinite(
                location.longitude
            )
        ) {
            ASIYE_DRIVER.map
                ?.followDriverTopView?.(
                    location.latitude,
                    location.longitude,
                    16
                );
        } else {
            ASIYE_DRIVER.map.instance
                ?.easeTo?.({
                    pitch: 0,
                    bearing: 0,
                    padding: 0,
                    duration: 500
                });
        }

        this.target =
            null;

        this.key =
            null;

        this.route =
            null;

        this.steps =
            [];

        this.stepIndex =
            0;

        this.loading =
            false;

        this.lastFetch =
            0;

        this.spokenInstructions
            .clear();

        this.showTrafficWarning(
            null
        );
    }
};

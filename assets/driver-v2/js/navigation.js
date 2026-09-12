/* Destination guidance using the route's actual maneuver and step geometry. */
window.ASIYE_DRIVER = window.ASIYE_DRIVER || {};
ASIYE_DRIVER.navigator = {
    target: null,
    route: null,
    follow: true,
    generation: 0,

    start(request) {
        const point = request.destinationCoords || request.dropoffLocation || {};
        const lat = point.latitude ?? point.lat;
        const lng = point.longitude ?? point.lng;
        if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            this.stop();
            this.text('navInstruction', 'Destination coordinates unavailable');
            return;
        }
        const key = `${request.requestId || request.key || ASIYE_DRIVER.trip?.requestId}:${lat},${lng}`;
        if (this.key !== key) {
            this.stop();
            this.key = key;
            this.target = [Number(lng), Number(lat)];
            this.follow = true;
        }
        document.body.classList.add('destination-navigation');
        const map = ASIYE_DRIVER.map.instance;
        if (map && this.boundMap !== map) {
            this.boundMap = map;
            map.on('dragstart', () => { this.follow = false; });
        }
        const follow = document.getElementById('navFollow');
        if (follow) follow.onclick = () => { this.follow = true; this.update(ASIYE_DRIVER.state.location); };
        const retry = document.getElementById('navRetry');
        if (retry) retry.onclick = () => this.fetchRoute();
        this.update(ASIYE_DRIVER.state.location);
    },

    text(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    },

    async fetchRoute() {
        const location = ASIYE_DRIVER.state.location;
        if (!this.target || this.loading || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
        const generation = this.generation;
        this.loading = true;
        this.lastFetch = Date.now();
        this.text('navInstruction', this.route ? 'Updating route…' : 'Finding your route…');
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${location.longitude},${location.latitude};${this.target.join(',')}?geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(ASIYE_DRIVER_CONFIG.mapboxToken)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Directions ${response.status}`);
            const data = await response.json();
            if (generation !== this.generation) return;
            const route = data.routes?.[0];
            if (!route?.geometry?.coordinates?.length || !route.legs?.[0]?.steps?.length) throw new Error('No route available');
            this.route = route;
            this.steps = route.legs.flatMap(leg => leg.steps);
            this.stepIndex = 0;
            ASIYE_DRIVER.setNavigationTarget?.({ type: 'dropoff', latitude: this.target[1], longitude: this.target[0],
                distanceKm: route.distance / 1000, durationMinutes: route.duration / 60, geometry: route.geometry });
            this.draw();
        } catch (error) {
            if (generation !== this.generation) return;
            this.route = null;
            this.text('navInstruction', 'Route unavailable. Tap retry.');
            this.text('navDistance', '—');
            this.text('navEta', '—');
            this.text('navArrival', '—');
            this.text('navTurnDistance', 'Check your connection');
            console.warn('Destination navigation:', error);
        } finally {
            if (generation === this.generation) {
                this.loading = false;
                if (this.route) this.update(ASIYE_DRIVER.state.location);
            }
        }
    },

    draw() {
        const map = ASIYE_DRIVER.map;
        if (!this.route || !map.instance?.isStyleLoaded()) return;
        map.routeGeometry = this.route.geometry;
        map.drawRoute(this.route.geometry);
        map.showTargetMarker(this.target[1], this.target[0], 'dropoff');
    },

    // Project GPS onto each road segment; measure distance along the step.
    project(point, coordinates) {
        const scale = Math.cos(point[1] * Math.PI / 180);
        let best = { distance: Infinity, remaining: 0 };
        let traversed = 0;
        for (let i = 1; i < coordinates.length; i++) {
            const a = coordinates[i - 1], b = coordinates[i];
            const dx = (b[0] - a[0]) * scale * 111320, dy = (b[1] - a[1]) * 111320;
            const px = (point[0] - a[0]) * scale * 111320, py = (point[1] - a[1]) * 111320;
            const length = Math.hypot(dx, dy);
            const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / (length * length))) : 0;
            const distance = Math.hypot(px - t * dx, py - t * dy);
            if (distance < best.distance) best = { distance, along: traversed + t * length };
            traversed += length;
        }
        best.remaining = traversed - (best.along || 0);
        best.total = traversed;
        return best;
    },

    update(location) {
        if (!this.target) return;
        if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
            this.text('navInstruction', 'Waiting for GPS…');
            return;
        }
        const point = [location.longitude, location.latitude];
        const map = ASIYE_DRIVER.map.instance;
        if (map && this.follow) {
            const sheet = document.getElementById('activeTripContent');
            map.easeTo({ center: point, zoom: 17, pitch: 45,
                bearing: Number.isFinite(location.heading) ? location.heading : map.getBearing(),
                padding: { top: 100, bottom: Math.min((sheet?.offsetHeight || 240) + 35, window.innerHeight * .48), left: 35, right: 35 }, duration: 900 });
        }
        if (!this.route) {
            if (!this.lastFetch || Date.now() - this.lastFetch > 15000) this.fetchRoute();
            return;
        }
        let index = this.stepIndex;
        let best = this.project(point, this.steps[index].geometry?.coordinates || []);
        // Only look ahead locally so crossing roads cannot skip distant turns.
        for (let i = index + 1; i <= Math.min(index + 2, this.steps.length - 1); i++) {
            const candidate = this.project(point, this.steps[i].geometry?.coordinates || []);
            if (candidate.distance + 8 < best.distance) { index = i; best = candidate; }
        }
        if (best.distance > 60) {
            this.text('navInstruction', 'Off route — finding a new route…');
            if (Date.now() - this.lastFetch > 15000) this.fetchRoute();
            return;
        }
        this.stepIndex = index;
        const step = this.steps[index];
        const next = this.steps[index + 1] || step;
        let remaining = best.remaining;
        let seconds = (step.duration || 0) * (best.total ? best.remaining / best.total : 0);
        for (let i = index + 1; i < this.steps.length; i++) {
            remaining += this.steps[i].distance || 0;
            seconds += this.steps[i].duration || 0;
        }
        const arrived = remaining < 25;
        const modifier = next.maneuver?.modifier || '';
        this.text('navArrow', arrived ? '●' : modifier.includes('uturn') ? '↶' : modifier.includes('left') ? '↰' : modifier.includes('right') ? '↱' : '↑');
        this.text('navTurnDistance', arrived ? 'Destination nearby' : this.distance(best.remaining));
        this.text('navInstruction', arrived ? 'You are near your destination' : next.maneuver?.instruction || 'Continue on the route');
        this.text('navDistance', this.distance(remaining));
        this.text('navEta', arrived ? 'Arriving' : `${Math.max(1, Math.ceil(seconds / 60))} min`);
        this.text('navArrival', new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    },

    distance(metres) { return metres < 1000 ? `${Math.max(0, Math.round(metres / 10) * 10)} m` : `${(metres / 1000).toFixed(1)} km`; },

    stop() {
        this.generation++;
        this.target = null;
        this.key = null;
        this.route = null;
        this.loading = false;
        this.lastFetch = 0;
        document.body.classList.remove('destination-navigation');
        ASIYE_DRIVER.map.instance?.easeTo({ pitch: 0, padding: 0, duration: 500 });
    }
};

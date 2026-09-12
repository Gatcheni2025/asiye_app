/* Shared vector car and GPS interpolation for Driver V2 and Passenger V2. */
window.AsiyeLiveCar = {
    create(map, coordinates, heading) {
        const element = document.createElement('div');
        element.setAttribute('aria-label', 'Driver location');
        // Mapbox owns the outer transform; the drawing has no transform transition.
        element.style.cssText = 'width:42px;height:68px;pointer-events:none;';
        element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 100" width="42" height="68" aria-hidden="true" style="display:block;filter:drop-shadow(0 3px 3px #0006)">
            <defs><linearGradient id="car-paint" x2="1" y2="0"><stop stop-color="#9da7ad"/><stop offset=".22" stop-color="#f7fafb"/><stop offset=".5" stop-color="#fff"/><stop offset=".8" stop-color="#dce2e5"/><stop offset="1" stop-color="#89959c"/></linearGradient>
            <linearGradient id="car-glass" x2="0" y2="1"><stop stop-color="#536b78"/><stop offset="1" stop-color="#182a36"/></linearGradient></defs>
            <g fill="#172027"><rect x="10" y="20" width="7" height="17" rx="3"/><rect x="47" y="20" width="7" height="17" rx="3"/><rect x="10" y="66" width="7" height="17" rx="3"/><rect x="47" y="66" width="7" height="17" rx="3"/></g>
            <path d="M16 16Q18 6 32 6T48 16L50 79Q50 93 41 95H23Q14 93 14 79Z" fill="url(#car-paint)" stroke="#64717b" stroke-width="1.5"/>
            <path d="M21 15Q32 11 43 15L44 28Q32 24 20 28Z" fill="#f6f9fa" stroke="#bdc7cc"/>
            <path d="M20 31Q32 26 44 31L41 45H23Z" fill="url(#car-glass)" stroke="#80929c"/>
            <path d="M18 35L22 46V66L18 72Z M46 35L42 46V66L46 72Z" fill="#243945"/>
            <rect x="24" y="47" width="16" height="20" rx="3" fill="#edf2f4" stroke="#bdc7cc"/>
            <path d="M23 70H41L44 80Q32 84 20 80Z" fill="url(#car-glass)"/>
            <path d="M21 86H43" stroke="#b0bcc3" stroke-width="1.5"/>
            <path d="M17 17L24 15M40 15L47 17" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
            <path d="M17 87L23 89M41 89L47 87" stroke="#df4145" stroke-width="3" stroke-linecap="round"/>
            <path d="M15 38L9 40V44L15 43M49 38L55 40V44L49 43" fill="#d2dce1" stroke="#65747e"/>
        </svg>`;
        const marker = new mapboxgl.Marker({ element, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' })
            .setLngLat(coordinates).setRotation(Number(heading) || 0).addTo(map);
        marker.carPosition = coordinates.slice();
        marker.carHeading = Number(heading) || 0;
        return marker;
    },

    move(marker, coordinates, heading) {
        if (marker.carFrame != null) cancelAnimationFrame(marker.carFrame);
        const from = marker.carPosition.slice();
        const startHeading = marker.carHeading;
        const targetHeading = Number.isFinite(Number(heading)) && heading != null ? Number(heading) : startHeading;
        const turn = ((targetHeading - startHeading + 540) % 360 + 360) % 360 - 180;
        const lngDelta = ((coordinates[0] - from[0] + 540) % 360) - 180;
        const distance = Math.hypot(lngDelta * Math.cos(from[1] * Math.PI / 180), coordinates[1] - from[1]) * 111320;
        const now = performance.now();
        const duration = Math.min(2000, Math.max(500, now - (marker.carUpdatedAt ?? now - 1000)));
        marker.carUpdatedAt = now;
        const apply = t => {
            marker.carPosition = t === 1 ? coordinates.slice() : [from[0] + lngDelta * t, from[1] + (coordinates[1] - from[1]) * t];
            marker.carHeading = startHeading + turn * t;
            marker.setLngLat(marker.carPosition).setRotation(marker.carHeading);
        };
        // Old GPS fixes and large jumps should not animate through unrelated streets.
        if (distance > 500 || document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            apply(1);
            marker.carFrame = null;
            return;
        }
        const frame = time => {
            const t = Math.min(1, Math.max(0, (time - now) / duration));
            apply(t);
            marker.carFrame = t < 1 ? requestAnimationFrame(frame) : null;
        };
        marker.carFrame = requestAnimationFrame(frame);
    },

    stop(marker) {
        if (marker?.carFrame != null) cancelAnimationFrame(marker.carFrame);
        if (marker) marker.carFrame = null;
    }
};

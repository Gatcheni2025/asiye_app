/* Shared off-road guidance for passenger and driver maps. */
window.AsiyeRoadGuidance = {
    thresholdMetres: 35,

    nearest(point, geometry) {
        const coordinates = geometry?.coordinates;

        if (
            !Array.isArray(point) ||
            !Array.isArray(coordinates) ||
            coordinates.length < 2
        ) {
            return null;
        }

        const latitude = Number(point[1]);
        const scale =
            Math.cos(latitude * Math.PI / 180);

        let best = null;

        for (
            let index = 1;
            index < coordinates.length;
            index++
        ) {
            const a = coordinates[index - 1];
            const b = coordinates[index];

            if (
                !Array.isArray(a) ||
                !Array.isArray(b)
            ) {
                continue;
            }

            const dx =
                (Number(b[0]) - Number(a[0])) *
                scale *
                111320;

            const dy =
                (Number(b[1]) - Number(a[1])) *
                111320;

            const px =
                (Number(point[0]) - Number(a[0])) *
                scale *
                111320;

            const py =
                (Number(point[1]) - Number(a[1])) *
                111320;

            const lengthSquared =
                dx * dx + dy * dy;

            const t = lengthSquared
                ? Math.max(
                    0,
                    Math.min(
                        1,
                        (px * dx + py * dy) /
                            lengthSquared
                    )
                )
                : 0;

            const nearestLng =
                Number(a[0]) +
                (
                    Number(b[0]) -
                    Number(a[0])
                ) *
                t;

            const nearestLat =
                Number(a[1]) +
                (
                    Number(b[1]) -
                    Number(a[1])
                ) *
                t;

            const distance =
                Math.hypot(
                    px - t * dx,
                    py - t * dy
                );

            if (
                !best ||
                distance < best.distance
            ) {
                best = {
                    distance,
                    coordinate: [
                        nearestLng,
                        nearestLat
                    ]
                };
            }
        }

        return best;
    },

    _banner() {
        let banner =
            document.getElementById(
                'asiyeRoadAccessBanner'
            );

        if (banner) return banner;

        banner =
            document.createElement('div');

        banner.id =
            'asiyeRoadAccessBanner';

        banner.className =
            'asiye-road-access-banner';

        banner.innerHTML = `
            <i
                class="fas fa-person-walking"
                aria-hidden="true"
            ></i>
            <div>
                <strong>Walking directions to the road</strong>
                <span data-road-distance></span>
            </div>
        `;

        document.body.appendChild(
            banner
        );

        return banner;
    },

    _distance(metres) {
        if (metres < 1000) {
            return `${Math.max(
                1,
                Math.round(metres / 5) * 5
            )} m`;
        }

        return `${(
            metres / 1000
        ).toFixed(1)} km`;
    },

    update(
        map,
        point,
        geometry,
        {
            threshold =
                this.thresholdMetres
        } = {}
    ) {
        const nearest =
            this.nearest(
                point,
                geometry
            );

        if (
            !map ||
            !nearest ||
            nearest.distance <= threshold
        ) {
            this.clear(map);

            return {
                offRoad: false,
                distance: nearest?.distance || 0,
                coordinate:
                    nearest?.coordinate || null
            };
        }

        const banner =
            this._banner();

        const distance =
            banner.querySelector(
                '[data-road-distance]'
            );

        if (distance) {
            distance.textContent =
                `Walk ${this._distance(
                    nearest.distance
                )} to the road`;
        }

        banner.classList.add(
            'show'
        );

        if (
            map.isStyleLoaded?.()
        ) {
            const sourceId =
                'asiye-walk-to-road';

            const data = {
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        point,
                        nearest.coordinate
                    ]
                }
            };

            const source =
                map.getSource?.(
                    sourceId
                );

            if (source) {
                source.setData(data);
            } else {
                map.addSource(
                    sourceId,
                    {
                        type: 'geojson',
                        data
                    }
                );

                map.addLayer({
                    id:
                        'asiye-walk-to-road-outline',
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
                            7,
                        'line-opacity':
                            .95
                    }
                });

                map.addLayer({
                    id:
                        'asiye-walk-to-road-line',
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
                            '#f59e0b',
                        'line-width':
                            4,
                        'line-dasharray':
                            [1.5, 1.5]
                    }
                });
            }
        }

        return {
            offRoad: true,
            distance:
                nearest.distance,
            coordinate:
                nearest.coordinate
        };
    },

    clear(map) {
        document
            .getElementById(
                'asiyeRoadAccessBanner'
            )
            ?.classList
            .remove(
                'show'
            );

        if (!map) return;

        for (
            const layer of [
                'asiye-walk-to-road-line',
                'asiye-walk-to-road-outline'
            ]
        ) {
            if (
                map.getLayer?.(layer)
            ) {
                map.removeLayer(
                    layer
                );
            }
        }

        if (
            map.getSource?.(
                'asiye-walk-to-road'
            )
        ) {
            map.removeSource(
                'asiye-walk-to-road'
            );
        }
    }
};

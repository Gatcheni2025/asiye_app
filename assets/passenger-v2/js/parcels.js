/* ============================================================
   ASIYE PASSENGER V2
   DELIVERY / PARCEL SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.parcels = {
    destination: null,
    quote: null,
    searchTimer: null,
    searchGeneration: 0,

    escape(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    open() {
        const container =
            document.getElementById(
                'sheetContent'
            );

        if (!container) return;

        const pickup =
            ASIYE.state?.location || {};

        const user =
            ASIYE.state?.user || {};

        this.destination =
            null;

        this.quote =
            null;

        container.innerHTML = `
            <div class="sheet-page-header">
                <button
                    type="button"
                    id="deliveryBackButton"
                    class="sheet-back-button"
                    aria-label="Back"
                >
                    <i class="fas fa-arrow-left"></i>
                </button>

                <div>
                    <div class="home-kicker">
                        Asiye Delivery
                    </div>
                    <h2 class="sheet-page-title">
                        Send a parcel
                    </h2>
                </div>
            </div>

            <div class="delivery-intro">
                <div class="delivery-intro-icon">
                    <i class="fas fa-box"></i>
                </div>
                <div>
                    <strong>Door-to-door delivery</strong>
                    <span>
                        A nearby Asiye driver collects from you
                        and delivers directly to your recipient.
                    </span>
                </div>
            </div>

            <div class="delivery-form">
                <label>
                    Pickup
                    <div class="delivery-readonly">
                        <i class="fas fa-location-crosshairs"></i>
                        <span>
                            ${this.escape(
                                pickup.address ||
                                'Your current location'
                            )}
                        </span>
                    </div>
                </label>

                <label>
                    Deliver to
                    <div class="delivery-address-wrap">
                        <input
                            id="deliveryDestinationInput"
                            type="search"
                            autocomplete="off"
                            placeholder="Search recipient address"
                        >
                        <div
                            id="deliverySuggestions"
                            class="delivery-suggestions"
                            hidden
                        ></div>
                    </div>
                </label>

                <div class="delivery-grid">
                    <label>
                        Recipient name
                        <input
                            id="deliveryRecipientName"
                            maxlength="120"
                            placeholder="Full name"
                        >
                    </label>

                    <label>
                        Recipient phone
                        <input
                            id="deliveryRecipientPhone"
                            type="tel"
                            maxlength="25"
                            placeholder="082 123 4567"
                        >
                    </label>
                </div>

                <label>
                    Package
                    <select id="deliveryPackageType">
                        <option value="document">
                            Document / envelope
                        </option>
                        <option value="small">
                            Small parcel
                        </option>
                        <option value="medium">
                            Medium parcel
                        </option>
                        <option value="large">
                            Large parcel
                        </option>
                    </select>
                </label>

                <label>
                    Delivery notes
                    <textarea
                        id="deliveryNotes"
                        maxlength="300"
                        rows="3"
                        placeholder="Optional instructions for the driver or recipient"
                    ></textarea>
                </label>

                <div
                    id="deliveryQuote"
                    class="delivery-quote"
                    hidden
                ></div>

                <div
                    id="deliveryError"
                    class="delivery-error"
                    hidden
                ></div>

                <button
                    type="button"
                    id="deliveryRequestButton"
                    class="primary-button"
                    disabled
                >
                    Request delivery
                </button>

                <button
                    type="button"
                    id="viewDeliveriesButton"
                    class="secondary-button"
                >
                    My deliveries
                </button>
            </div>
        `;

        document
            .getElementById(
                'deliveryBackButton'
            )
            ?.addEventListener(
                'click',
                () =>
                    ASIYE.ui.renderHome()
            );

        document
            .getElementById(
                'viewDeliveriesButton'
            )
            ?.addEventListener(
                'click',
                () =>
                    AsiyePages.open(
                        'parcels'
                    )
            );

        const input =
            document.getElementById(
                'deliveryDestinationInput'
            );

        input
            ?.addEventListener(
                'input',
                event => {
                    this.destination =
                        null;

                    this.quote =
                        null;

                    this.renderQuote();

                    clearTimeout(
                        this.searchTimer
                    );

                    const query =
                        event.target.value
                            .trim();

                    if (
                        query.length < 3
                    ) {
                        this.hideSuggestions();
                        return;
                    }

                    this.searchTimer =
                        setTimeout(
                            () =>
                                this.searchDestination(
                                    query
                                ),
                            280
                        );
                }
            );

        document
            .getElementById(
                'deliveryRequestButton'
            )
            ?.addEventListener(
                'click',
                event =>
                    this.submit(
                        event.currentTarget
                    )
            );

        ASIYE.state.ui.sheet =
            'delivery';

        setTimeout(
            () => ASIYE.map?.resize?.(),
            100
        );

        if (
            !Number.isFinite(
                pickup.latitude
            ) ||
            !Number.isFinite(
                pickup.longitude
            )
        ) {
            this.showError(
                'Waiting for your pickup location. Make sure location access is enabled.'
            );
        }
    },

    hideSuggestions() {
        const box =
            document.getElementById(
                'deliverySuggestions'
            );

        if (!box) return;

        box.hidden = true;
        box.replaceChildren();
    },

    async searchDestination(query) {
        const box =
            document.getElementById(
                'deliverySuggestions'
            );

        if (!box) return;

        const generation =
            ++this.searchGeneration;

        const token =
            ASIYE_CONFIG?.mapboxToken;

        if (!token) {
            this.showError(
                'Address search is unavailable.'
            );
            return;
        }

        try {
            const params =
                new URLSearchParams({
                    q: query,
                    country: 'za',
                    limit: '6',
                    access_token: token
                });

            const response =
                await fetch(
                    `https://api.mapbox.com/search/geocode/v6/forward?${params}`
                );

            if (!response.ok) {
                throw new Error(
                    `Address search ${response.status}`
                );
            }

            const data =
                await response.json();

            if (
                generation !==
                this.searchGeneration
            ) {
                return;
            }

            const features =
                Array.isArray(
                    data.features
                )
                    ? data.features
                    : [];

            box.replaceChildren();

            if (!features.length) {
                box.hidden = true;
                return;
            }

            features.forEach(
                feature => {
                    const coordinates =
                        feature.geometry
                            ?.coordinates;

                    const lng =
                        Number(
                            coordinates?.[0]
                        );

                    const lat =
                        Number(
                            coordinates?.[1]
                        );

                    if (
                        !Number.isFinite(lat) ||
                        !Number.isFinite(lng)
                    ) {
                        return;
                    }

                    const label =
                        feature.properties
                            ?.full_address ||
                        feature.properties
                            ?.name_preferred ||
                        feature.properties
                            ?.name ||
                        feature.place_name ||
                        'Delivery address';

                    const button =
                        document.createElement(
                            'button'
                        );

                    button.type =
                        'button';

                    button.className =
                        'delivery-suggestion';

                    button.innerHTML = `
                        <i class="fas fa-location-dot"></i>
                        <span>${this.escape(label)}</span>
                    `;

                    button.onclick =
                        () => {
                            this.destination = {
                                latitude:
                                    lat,
                                longitude:
                                    lng,
                                address:
                                    label,
                                name:
                                    label
                            };

                            const input =
                                document
                                    .getElementById(
                                        'deliveryDestinationInput'
                                    );

                            if (input) {
                                input.value =
                                    label;
                            }

                            this.hideSuggestions();

                            this.calculateQuote();
                        };

                    box.appendChild(
                        button
                    );
                }
            );

            box.hidden =
                box.children.length ===
                0;
        } catch (error) {
            console.warn(
                'Delivery address search failed:',
                error
            );

            this.showError(
                'Could not search that address. Check your connection and try again.'
            );
        }
    },

    async calculateQuote() {
        const pickup =
            ASIYE.state?.location || {};

        const destination =
            this.destination;

        if (
            !destination ||
            !Number.isFinite(
                pickup.latitude
            ) ||
            !Number.isFinite(
                pickup.longitude
            )
        ) {
            return;
        }

        this.showError('');

        const token =
            ASIYE_CONFIG?.mapboxToken;

        try {
            const url =
                'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/' +
                `${pickup.longitude},${pickup.latitude};` +
                `${destination.longitude},${destination.latitude}` +
                '?geometries=geojson' +
                '&overview=full' +
                '&steps=true' +
                '&alternatives=false' +
                `&access_token=${encodeURIComponent(token)}`;

            const response =
                await fetch(url);

            if (!response.ok) {
                throw new Error(
                    `Directions ${response.status}`
                );
            }

            const data =
                await response.json();

            const route =
                data.routes?.[0];

            if (
                !route?.geometry
            ) {
                throw new Error(
                    'No delivery route found.'
                );
            }

            const distanceKm =
                Number(
                    route.distance || 0
                ) /
                1000;

            const durationMinutes =
                Math.max(
                    1,
                    Math.round(
                        Number(
                            route.duration || 0
                        ) /
                        60
                    )
                );

            const fare =
                ASIYE.pricing
                    .calculateDelivery(
                        distanceKm
                    );

            this.quote = {
                fare,
                distanceKm,
                durationMinutes,
                geometry:
                    route.geometry
            };

            ASIYE.map
                ?.showDestinationMarker?.(
                    destination.latitude,
                    destination.longitude
                );

            ASIYE.map
                ?.drawRoute?.(
                    route.geometry
                );

            ASIYE.map
                ?.fitRouteGeometry?.(
                    route.geometry
                );

            this.renderQuote();
        } catch (error) {
            console.warn(
                'Delivery quote failed:',
                error
            );

            this.quote =
                null;

            this.renderQuote();

            this.showError(
                'We could not calculate this delivery route. Try another address.'
            );
        }
    },

    renderQuote() {
        const element =
            document.getElementById(
                'deliveryQuote'
            );

        const button =
            document.getElementById(
                'deliveryRequestButton'
            );

        if (!element) return;

        if (!this.quote) {
            element.hidden = true;

            if (button) {
                button.disabled =
                    true;
            }

            return;
        }

        element.hidden = false;

        element.innerHTML = `
            <div>
                <small>Estimated delivery fare</small>
                <strong>R${Number(this.quote.fare).toFixed(0)}</strong>
            </div>
            <div>
                <small>Distance</small>
                <strong>${this.quote.distanceKm.toFixed(1)} km</strong>
            </div>
            <div>
                <small>Estimated drive</small>
                <strong>${this.quote.durationMinutes} min</strong>
            </div>
        `;

        if (button) {
            button.disabled =
                false;
        }
    },

    showError(message) {
        const element =
            document.getElementById(
                'deliveryError'
            );

        if (!element) return;

        element.textContent =
            message || '';

        element.hidden =
            !message;
    },

    phoneValid(value) {
        const digits =
            String(value || '')
                .replace(
                    /\D/g,
                    ''
                );

        return (
            digits.length >= 9 &&
            digits.length <= 15
        );
    },

    async submit(button) {
        if (
            !this.destination ||
            !this.quote
        ) {
            this.showError(
                'Choose a delivery address first.'
            );
            return;
        }

        if (
            window.AsiyeSafetyContact &&
            !await AsiyeSafetyContact.ensure({
                role: 'passenger'
            })
        ) {
            return;
        }

        const recipientName =
            document
                .getElementById(
                    'deliveryRecipientName'
                )
                ?.value
                .trim();

        const recipientPhone =
            document
                .getElementById(
                    'deliveryRecipientPhone'
                )
                ?.value
                .trim();

        const packageType =
            document
                .getElementById(
                    'deliveryPackageType'
                )
                ?.value ||
            'small';

        const notes =
            document
                .getElementById(
                    'deliveryNotes'
                )
                ?.value
                .trim() ||
            '';

        if (!recipientName) {
            this.showError(
                'Enter the recipient name.'
            );
            return;
        }

        if (
            !this.phoneValid(
                recipientPhone
            )
        ) {
            this.showError(
                'Enter a valid recipient phone number.'
            );
            return;
        }

        const uid =
            ASIYE.state?.userId;

        const user =
            ASIYE.state?.user || {};

        const pickup =
            ASIYE.state?.location || {};

        if (
            !uid ||
            !Number.isFinite(
                pickup.latitude
            ) ||
            !Number.isFinite(
                pickup.longitude
            )
        ) {
            this.showError(
                'Your account or pickup location is not ready.'
            );
            return;
        }

        button.disabled =
            true;

        button.innerHTML =
            '<i class="fas fa-circle-notch fa-spin"></i> Requesting delivery…';

        this.showError('');

        try {
            const requestRef =
                firebase
                    .database()
                    .ref(
                        'requests'
                    )
                    .push();

            const requestId =
                requestRef.key;

            if (!requestId) {
                throw new Error(
                    'Could not create a delivery reference.'
                );
            }

            const pickupPin =
                ASIYE.booking
                    .generatePin();

            const requestData = {
                requestId,
                type:
                    'delivery',
                rideType:
                    'delivery',
                serviceType:
                    'parcel_delivery',
                status:
                    'pending',

                commuterId:
                    uid,
                commuterName:
                    user.name ||
                    user.firstName ||
                    user.displayName ||
                    'Sender',
                commuterPhone:
                    user.phone ||
                    user.phoneNumber ||
                    '',

                sender: {
                    id:
                        uid,
                    name:
                        user.name ||
                        user.firstName ||
                        user.displayName ||
                        'Sender',
                    phone:
                        user.phone ||
                        user.phoneNumber ||
                        ''
                },

                recipient: {
                    name:
                        recipientName,
                    phone:
                        recipientPhone
                },
                recipientName,
                recipientPhone,

                package: {
                    type:
                        packageType,
                    notes
                },
                packageType,
                packageNotes:
                    notes,

                pickupAddress:
                    pickup.address ||
                    'Current location',

                commuterLocation: {
                    latitude:
                        pickup.latitude,
                    longitude:
                        pickup.longitude
                },

                pickupLocation: {
                    latitude:
                        pickup.latitude,
                    longitude:
                        pickup.longitude
                },

                destination:
                    this.destination.address,
                destinationName:
                    this.destination.address,

                destinationCoords: {
                    latitude:
                        this.destination.latitude,
                    longitude:
                        this.destination.longitude
                },

                dropoffLocation: {
                    latitude:
                        this.destination.latitude,
                    longitude:
                        this.destination.longitude
                },

                routeDistanceKm:
                    this.quote.distanceKm,

                routeDurationMinutes:
                    this.quote.durationMinutes,

                calculatedPrice:
                    this.quote.fare,
                finalAmount:
                    this.quote.fare,
                agreedFare:
                    this.quote.fare,
                pricingVersion:
                    1,
                deliveryPricing:
                    'asiye-go-distance-v1',

                paymentMethod:
                    ASIYE.state?.booking
                        ?.paymentMethod ||
                    'cash',

                requirePin:
                    true,
                pickupPin,

                taxiId:
                    null,
                assignedTaxiId:
                    null,

                createdAt:
                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP,

                timestamp:
                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            };

            const root =
                firebase
                    .database()
                    .ref();

            await root.update({
                [`requests/${requestId}`]:
                    requestData,

                [`delivery_requests/${requestId}`]:
                    {
                        ...requestData,
                        orderId:
                            requestId
                    },

                [`commuters/${uid}/currentRequest`]:
                    requestId
            });

            ASIYE.state.booking
                .requestId =
                requestId;

            ASIYE.state.booking
                .request =
                requestData;

            localStorage.setItem(
                'currentRequestId',
                requestId
            );

            await ASIYE.booking
                .offerSafetyShare?.(
                    requestId
                );

            const dispatch =
                await ASIYE.booking
                    .notifyGoDrivers(
                        requestId,
                        requestData
                    );

            const mirrorUpdate = {};

            if (
                dispatch?.mode ===
                    'queued'
            ) {
                mirrorUpdate.status =
                    'driver_busy';

                mirrorUpdate.queuedTaxiId =
                    dispatch.driverId ||
                    null;
            } else if (
                dispatch?.mode ===
                    'none'
            ) {
                mirrorUpdate.status =
                    'searching';
            }

            if (
                Object.keys(
                    mirrorUpdate
                ).length
            ) {
                await firebase
                    .database()
                    .ref(
                        `delivery_requests/${requestId}`
                    )
                    .update(
                        mirrorUpdate
                    );
            }

            ASIYE.ride
                ?.start?.(
                    requestId
                );

            ASIYE.ui?.toast?.(
                `Delivery requested. Collection PIN: ${pickupPin}`,
                'success'
            );
        } catch (error) {
            console.error(
                'Delivery request failed:',
                error
            );

            this.showError(
                error?.message ||
                'Could not request delivery. Please try again.'
            );

            button.disabled =
                false;

            button.textContent =
                'Request delivery';
        }
    }
};

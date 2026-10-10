/* ============================================================
   ASIYE PASSENGER V2
   Main Application Controller
   ============================================================ */

window.ASIYE = window.ASIYE || {};


ASIYE.ui = {

    /* ========================================================
       HOME
       ======================================================== */

    renderHome() {

        const container =
            document.getElementById('sheetContent');


        if (!container) {

            return;
        }


        const user =
            ASIYE.state.user || {};


        const firstName =

            (
                user.name ||
                user.firstName ||
                'there'
            )
            .trim()
            .split(' ')[0];


        const credits =
            ASIYE.wallet?.balance
                ? ASIYE.wallet.balance(user)
                : Number(
                    user.walletBalance ??
                    user.credits ??
                    0
                );


        container.innerHTML = `

            <div class="home-header">

                <div>

                    <div class="home-kicker">

                        Welcome back

                    </div>


                    <h1 class="home-title">

                        Where to,
                        ${this.escape(firstName)}?

                    </h1>


                    <div class="home-greeting">

                        Choose your destination
                        and Asiye will handle
                        the rest.

                    </div>

                </div>

            </div>


            <!-- DESTINATION -->

            <button
                id="whereToButton"
                class="destination-button"
            >

                <div class="destination-search-icon">

                    <i class="fas fa-search"></i>

                </div>


                <div class="destination-button-text">

                    <span class="destination-button-label">

                        Where to?

                    </span>


                    <span class="destination-button-subtitle">

                        Search destination

                    </span>

                </div>


                <i
                    class="
                        fas
                        fa-chevron-right
                        destination-chevron
                    "
                ></i>

            </button>


            <!-- SERVICES -->

            <div class="home-services">

                <button
                    class="home-service"
                    data-action="ride"
                >

                    <div class="service-icon">

                        <img src="../data/car.svg" alt="" class="asiye-ride-image">

                    </div>

                    <span class="service-name">
                        Ride
                    </span>

                </button>


                <button
                    class="home-service"
                    data-action="club"
                >

                    <div class="service-icon">

                        <i class="fas fa-users"></i>

                    </div>

                    <span class="service-name">
                        Club
                    </span>

                </button>


                <button
                    class="home-service"
                    data-action="parcel"
                >

                    <div class="service-icon">

                        <i class="fas fa-box"></i>

                    </div>

                    <span class="service-name">
                        Parcel
                    </span>

                </button>

            </div>


            <!-- WALLET -->

            <button
                id="walletStrip"
                class="wallet-strip"
            >

                <div class="wallet-left">

                    <div class="wallet-icon">

                        <i class="fas fa-wallet"></i>

                    </div>


                    <div>

                        <span class="wallet-label">

                            Asiye Wallet

                        </span>


                        <span class="wallet-amount">

                            R${credits.toFixed(2)}

                        </span>

                    </div>

                </div>


                <i
                    class="
                        fas
                        fa-chevron-right
                        wallet-arrow
                    "
                ></i>

            </button>

        `;


        document
            .getElementById('whereToButton')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.renderDestinationSearch();
                }
            );


        container
            .querySelector('[data-action="ride"]')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.renderDestinationSearch();
                }
            );


        container
            .querySelector('[data-action="club"]')
            ?.addEventListener(
                'click',
                () => {

                    /*
                     * We still need a destination first.
                     */

                    ASIYE.state.ui
                        .preferredRideType =
                        'club4';

                    ASIYE.state.ui
                        .preferredService =
                        null;


                    ASIYE.ui
                        .renderDestinationSearch();
                }
            );


        container
            .querySelector('[data-action="parcel"]')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.state.ui
                        .preferredService =
                        'parcel';

                    ASIYE.ui
                        .renderDestinationSearch();
                }
            );


        document
            .getElementById('walletStrip')
            ?.addEventListener(
                'click',
                () => {

                    AsiyePages.open('wallet');
                }
            );


        ASIYE.state.ui.sheet =
            'home';


        setTimeout(
            () => {

                ASIYE.map?.resize();

            },
            120
        );
    },


    /* ========================================================
       DESTINATION SEARCH
       ======================================================== */

    renderDestinationSearch() {

        const container =
            document.getElementById('sheetContent');


        if (!container) return;


        const pickup =

            ASIYE.state.location.address ||

            'Current location';


        container.innerHTML = `

            <div class="sheet-page-header">

                <button
                    id="destinationBackButton"
                    class="sheet-back-button"
                >

                    <i class="fas fa-arrow-left"></i>

                </button>


                <h2 class="sheet-page-title">

                    Plan your trip

                </h2>

            </div>


            <div class="location-input-card">

                <div class="location-input-row">

                    <span class="location-dot"></span>


                    <input
                        id="pickupInput"
                        class="location-input"
                        type="text"
                        value="${this.escape(pickup)}"
                        readonly
                    >

                </div>


                <div class="location-input-row">

                    <span
                        class="
                            location-dot
                            destination
                        "
                    ></span>


                    <input
                        id="destinationInput"
                        class="location-input"
                        type="text"
                        placeholder="Where are you going?"
                        autocomplete="off"
                    >

                </div>

            </div>


            <div class="section-label">

                Suggestions

            </div>


            <div id="destinationSuggestions">

                ${this.placeRow(
                    'home',
                    'Home',
                    'Set your home address'
                )}


                ${this.placeRow(
                    'work',
                    'Work',
                    'Set your work address'
                )}


                ${this.placeRow(
                    'recent',
                    'Recent places',
                    'Your recent destinations'
                )}

            </div>

        `;


        document
            .getElementById('destinationBackButton')
            ?.addEventListener(
                'click',
                () => {

                    this.renderHome();
                }
            );


        const input =
            document.getElementById('destinationInput');


        if (input) {

            setTimeout(
                () => {

                    input.focus();

                },
                180
            );


            input.addEventListener(
                'input',
                event => {

                    const value =
                        event.target.value.trim();


                    ASIYE.places.search(
                        value
                    );
                }
            );
        }


        ASIYE.state.ui.sheet =
            'destination-search';
    },


    placeRow(
        icon,
        name,
        address
    ) {

        let iconClass =
            'fa-clock-rotate-left';


        if (icon === 'home') {

            iconClass =
                'fa-house';
        }


        if (icon === 'work') {

            iconClass =
                'fa-briefcase';
        }


        return `

            <button class="place-row">

                <div class="place-icon">

                    <i
                        class="
                            fas
                            ${iconClass}
                        "
                    ></i>

                </div>


                <div class="place-info">

                    <span class="place-name">

                        ${this.escape(name)}

                    </span>


                    <span class="place-address">

                        ${this.escape(address)}

                    </span>

                </div>


                <i
                    class="
                        fas
                        fa-chevron-right
                    "
                    style="
                        color:#aaa;
                        font-size:10px;
                    "
                ></i>

            </button>

        `;
    },


    /* ========================================================
       PAYMENT METHOD
       ======================================================== */

    renderPaymentMethodChooser() {

        const selected =
            String(
                ASIYE.state.booking
                    .paymentMethod ||
                'cash'
            )
            .toLowerCase();

        const walletBalance =
            ASIYE.wallet?.balance
                ? ASIYE.wallet.balance()
                : Number(
                    ASIYE.state.user
                        ?.walletBalance ??
                    ASIYE.state.user
                        ?.credits ??
                    0
                );

        const methods = [
            {
                id:
                    'cash',
                icon:
                    'fa-money-bill-wave',
                label:
                    'Cash',
                detail:
                    'Pay the driver'
            },
            {
                id:
                    'card',
                icon:
                    'fa-credit-card',
                label:
                    'Card',
                detail:
                    'Card payment'
            },
            {
                id:
                    'wallet',
                icon:
                    'fa-wallet',
                label:
                    'Wallet',
                detail:
                    `R${Number(walletBalance || 0).toFixed(2)} available`
            }
        ];

        return `
            <section class="asiye-payment-picker">
                <div class="asiye-payment-title">
                    Payment method
                </div>

                <div class="asiye-payment-options">
                    ${methods.map(method => `
                        <button
                            type="button"
                            class="asiye-payment-option ${selected === method.id ? 'selected' : ''}"
                            data-payment-method="${method.id}"
                        >
                            <span class="asiye-payment-icon">
                                <i class="fas ${method.icon}"></i>
                            </span>

                            <span class="asiye-payment-copy">
                                <strong>${method.label}</strong>
                                <small>${method.detail}</small>
                            </span>

                            <span class="asiye-payment-check">
                                <i class="fas fa-check"></i>
                            </span>
                        </button>
                    `).join('')}
                </div>
            </section>
        `;
    },


    bindPaymentMethodChooser(container) {

        if (!container) {
            return;
        }

        const apply =
            method => {
                const normalised =
                    String(
                        method ||
                        ''
                    )
                    .toLowerCase();

                if (
                    ![
                        'cash',
                        'card',
                        'wallet'
                    ].includes(
                        normalised
                    )
                ) {
                    return;
                }

                ASIYE.state.booking
                    .paymentMethod =
                    normalised;

                localStorage.setItem(
                    'asiyePaymentMethod',
                    normalised
                );

                container
                    .querySelectorAll(
                        '[data-payment-method]'
                    )
                    .forEach(
                        button => {
                            button.classList.toggle(
                                'selected',
                                button.dataset
                                    .paymentMethod ===
                                    normalised
                            );
                        }
                    );
            };

        container
            .querySelectorAll(
                '[data-payment-method]'
            )
            .forEach(
                button => {
                    button.addEventListener(
                        'click',
                        () => {
                            apply(
                                button.dataset
                                    .paymentMethod
                            );
                        }
                    );
                }
            );

        apply(
            ASIYE.state.booking
                .paymentMethod ||
            'cash'
        );
    },


    /* ========================================================
       RIDE SELECTION
       ======================================================== */

    renderRideSelection() {

        const container =
            document.getElementById('sheetContent');


        if (!container) {

            return;
        }


        const destination =
            ASIYE.state.destination;


        const route =
            ASIYE.state.route;


        const prices =
            ASIYE.pricing.calculate();


        if (
            ASIYE.state.ui.preferredService ===
            'parcel'
        ) {
            ASIYE.state.ui.preferredService =
                null;

            ASIYE.parcels
                ?.renderBooking?.();

            return;
        }


        ASIYE.state.booking.fare =
            prices.go;


        container.innerHTML = `

            <div class="sheet-page-header">

                <button
                    id="rideSelectionBack"
                    class="sheet-back-button"
                >

                    <i class="fas fa-arrow-left"></i>

                </button>


                <div>

                    <h2 class="sheet-page-title">

                        Choose your ride

                    </h2>


                    <div
                        style="
                            color:#888;
                            font-size:10px;
                            margin-top:2px;
                        "
                    >

                        ${route.distanceKm.toFixed(1)} km

                        ·

                        ${route.durationMinutes} min

                    </div>

                </div>

            </div>


            <div class="asiye-route-summary">

                <div
                    style="
                        font-size:11px;
                        color:#888;
                        margin-bottom:3px;
                        font-weight:700;
                    "
                >
                    Destination
                </div>

                <div
                    style="
                        font-size:13px;
                        font-weight:800;
                        color:#111;
                    "
                >
                    ${this.escape(
                        destination.name ||
                        destination.address
                    )}
                </div>

            </div>


            ${this.renderRideCard(
                'go',
                'Asiye Go',
                'Private ride · 15% below market reference',
                prices.go,
                'fa-car-side'
            )}


            ${this.renderRideCard(
                'club4',
                'Asiye Work 3',
                '3 passengers · Shared work commute',
                prices.club4,
                'fa-users'
            )}


            ${this.renderRideCard(
                'club7',
                'Asiye Work 4',
                '4 passengers · Larger shared work commute',
                prices.club7,
                'fa-van-shuttle'
            )}


            ${this.renderPaymentMethodChooser()}


            <button
                id="confirmRideSelection"
                class="primary-button"
                style="margin-top:14px;"
            >
                Continue with Asiye Go
            </button>

        `;


        ASIYE.state.booking.rideType =

            ASIYE.state.ui
                .preferredRideType ||

            'go';


        ASIYE.state.ui
            .preferredRideType =
            null;


        this.updateRideSelection();

        this.bindPaymentMethodChooser(
            container
        );


        /*
         * The ride sheet is now at its final height. Re-fit after rendering so
         * the complete pickup → destination route stays inside the visible map
         * instead of disappearing underneath the sheet.
         */
        requestAnimationFrame(
            () => {
                setTimeout(
                    () => {
                        ASIYE.map
                            ?.fitActiveTrip?.(
                                true
                            );
                    },
                    60
                );
            }
        );


        document
            .getElementById('rideSelectionBack')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.map.clearTrip();

                    ASIYE.resetDestination();

                    this.renderDestinationSearch();
                }
            );


        container
            .querySelectorAll('[data-ride-type]')
            .forEach(card => {

                card.addEventListener(
                    'click',
                    () => {

                        ASIYE.state.booking.rideType =
                            card.dataset.rideType;


                        this.updateRideSelection();
                    }
                );
            });


        document
            .getElementById('confirmRideSelection')
            ?.addEventListener(
                'click',
                async () => {

                    const type =
                        ASIYE.state.booking.rideType;


                    /*
                     * Club flow — no departure time is requested.
                     * Confirm the shared ride immediately.
                     */

                    if (
                        type === 'club4' ||
                        type === 'club7'
                    ) {

                        ASIYE.club.select(type);
                        ASIYE.state.booking.club.departureTime = null;
                        this.renderClubConfirmation();

                        return;
                    }


                    /*
                     * Asiye Go flow.
                     */

                    const button =
                        document.getElementById(
                            'confirmRideSelection'
                        );


                    if (button) {

                        button.disabled =
                            true;

                        button.innerHTML = `
                            <i class="fas fa-circle-notch fa-spin"></i>
                            Requesting your ride
                        `;
                    }


                    try {

                        if (
                            !ASIYE.ride ||
                            typeof ASIYE.ride.start !==
                                'function'
                        ) {

                            throw new Error(
                                'Ride controller did not load.'
                            );
                        }


                        const result =

                            await ASIYE.booking
                                .createGoRide();


                        if (
                            result &&
                            typeof result ===
                                'object' &&
                            result.paymentPending ===
                                true
                        ) {
                            ASIYE.ui.toast(
                                'Complete the Paystack card payment. After payment, Asiye will create your trip PIN and ask you to share the live trip with a loved one.'
                            );

                            return;
                        }


                        const requestId =
                            typeof result ===
                                'string'
                                ? result
                                : result?.requestId;


                        await ASIYE.ride.start(
                            requestId
                        );


                    } catch (error) {

                        console.error(
                            'Go booking failed:',
                            error
                        );


                        ASIYE.ui.toast(
                            error.message ||
                            'Could not request your ride.'
                        );


                        if (button) {

                            button.disabled =
                                false;

                            button.textContent =
                                'Continue with Asiye Go';
                        }
                    }
                }
            );
    },


    renderRideCard(
        type,
        title,
        subtitle,
        price,
        icon
    ) {

        return `

            <button
                data-ride-type="${type}"
                class="ride-choice-card"
            >

                <div class="ride-choice-icon">

                    <img src="../data/${type === 'go' ? 'car.svg' : type === 'club7' ? '7seater.png' : '4seater.png'}" alt="" class="asiye-ride-image">

                </div>


                <div class="ride-choice-copy">

                    <div class="ride-choice-title">

                        ${this.escape(title)}

                    </div>


                    <div class="ride-choice-subtitle">

                        ${this.escape(subtitle)}

                    </div>

                </div>


                <div class="ride-choice-price">

                    R${Number(price).toFixed(0)}

                </div>

            </button>

        `;
    },


    updateRideSelection() {

        const selected =
            ASIYE.state.booking.rideType;


        document
            .querySelectorAll('[data-ride-type]')
            .forEach(card => {

                card.classList.toggle(

                    'selected',

                    card.dataset.rideType ===
                    selected
                );
            });


        const button =
            document.getElementById('confirmRideSelection');


        if (!button) return;


        const labels = {

            go:
                'Continue with Asiye Go',

            club4:
                'Continue with Work 3',

            club7:
                'Continue with Work 4'
        };


        button.textContent =
            labels[selected] ||
            'Continue';
    },


    /* ========================================================
       CLUB SCHEDULE
       ======================================================== */

    renderClubSchedule() {

        const type =
            ASIYE.state.booking.rideType;

        if (
            type !== 'club4' &&
            type !== 'club7'
        ) {
            return;
        }

        ASIYE.club.select(type);
        ASIYE.state.booking.club.departureTime =
            null;

        this.renderClubConfirmation();
    },


    /* ========================================================
       CLUB CONFIRMATION
       ======================================================== */

    renderClubConfirmation() {

        const container =
            document.getElementById('sheetContent');


        if (!container) return;


        const type =
            ASIYE.state.booking.rideType;


        const config =
            ASIYE.club.getConfig(type);


        const prices =
            ASIYE.pricing.calculate();


        const price =

            type === 'club7'

            ? prices.club7

            : prices.club4;


        container.innerHTML = `

            <div class="sheet-page-header">

                <button
                    id="clubConfirmBack"
                    class="sheet-back-button"
                >
                    <i class="fas fa-arrow-left"></i>
                </button>


                <h2 class="sheet-page-title">
                    Confirm Work ride
                </h2>

            </div>


            <div class="club-confirm-route">

                <div class="club-confirm-point">

                    <span class="club-origin-dot"></span>

                    <div>

                        <small>Pickup</small>

                        <strong>
                            ${
                                this.escape(
                                    ASIYE.state
                                        .location
                                        .address ||
                                    'Current location'
                                )
                            }
                        </strong>

                    </div>

                </div>


                <div class="club-route-connector"></div>


                <div class="club-confirm-point">

                    <span class="club-dest-dot"></span>

                    <div>

                        <small>Destination</small>

                        <strong>
                            ${
                                this.escape(
                                    ASIYE.state
                                        .destination
                                        .name ||
                                    ASIYE.state
                                        .destination
                                        .address
                                )
                            }
                        </strong>

                    </div>

                </div>

            </div>


            <div class="club-summary-grid">

                <div>

                    <span>Club</span>

                    <strong>
                        ${config.capacity}
                        passengers
                    </strong>

                </div>


                <div>

                    <span>Distance</span>

                    <strong>
                        ${
                            ASIYE.state.route
                                .distanceKm
                                .toFixed(1)
                        } km
                    </strong>

                </div>


                <div>

                    <span>Your price</span>

                    <strong>
                        R${price}
                    </strong>

                </div>

            </div>


            <div class="club-driver-rule">

                <img src="../data/car.svg" alt="" class="asiye-ride-image">

                <div>

                    <strong>
                        Driver waits for the Club
                    </strong>

                    <p>
                        Collection only starts once
                        all ${config.capacity}
                        passenger seats are confirmed.
                    </p>

                </div>

            </div>


            ${this.renderPaymentMethodChooser()}


            <button
                id="bookClubNow"
                class="primary-button"
                style="margin-top:16px;"
            >
                Join Club · R${price}
            </button>

        `;


        this.bindPaymentMethodChooser(
            container
        );


        document
            .getElementById('clubConfirmBack')
            ?.addEventListener(
                'click',
                () => {

                    this.renderRideSelection();
                }
            );


        document
            .getElementById('bookClubNow')
            ?.addEventListener(
                'click',
                () => {

                    this.bookClub();
                }
            );
    },


    /* ========================================================
       CLUB BOOKING
       ======================================================== */

    async bookClub() {

        const type =
            ASIYE.state.booking
                .rideType;


        const button =
            document.getElementById(
                'bookClubNow'
            );


        if (!type) {

            return;
        }


        if (button) {

            button.disabled =
                true;

            button.innerHTML = `
                <i class="fas fa-circle-notch fa-spin"></i>
                Finding your Club
            `;
        }


        try {

            if (
                !ASIYE.ride ||
                typeof ASIYE.ride.start !==
                    'function'
            ) {

                throw new Error(
                    'Ride controller did not load.'
                );
            }


            const requestId =

                await ASIYE.club.book(

                    type,

                    null
                );


            await ASIYE.ride.start(
                requestId
            );


        } catch (error) {

            console.error(
                'Club booking failed:',
                error
            );


            this.toast(
                error.message ||
                'Could not create your Club ride.'
            );


            if (button) {

                button.disabled =
                    false;

                button.textContent =
                    'Join Club';
            }
        }
    },


    /* ========================================================
       CLUB WAITING

       Pure UI. Receives the request object directly
       from ride-controller.js. Does NOT open its own
       Firebase listener — the ride controller owns
       the single requests/{id} subscription.
       ======================================================== */

    renderClubWaiting(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (
            !container ||
            !request
        ) {

            return;
        }


        const progress =
            ASIYE.club
                .getPoolProgress(
                    request
                );


        const searchStatus =
            String(
                request.driverSearchStatus ||
                ''
            );


        const driverFoundCount =
            Number(
                request.driverFoundCount ||
                0
            );


        const driverFound =
            driverFoundCount > 0 ||
            searchStatus.startsWith(
                'driver_found'
            );


        const passengersReady =
            progress.ready;


        const paymentsReady =
            request.paymentsReady ===
                true;


        const fullRequestSent =
            passengersReady &&
            paymentsReady &&
            searchStatus ===
                'driver_found_waiting_acceptance';


        const distanceKm =
            Number(
                request.nearestDriverDistanceKm ||
                0
            );


        const remainingText =
            progress.remaining === 1
                ? '1 more passenger'
                : `${progress.remaining} more passengers`;


        const headline =
            driverFound
                ? 'Driver found'
                : passengersReady
                    ? 'Passengers ready — finding a driver'
                    : 'Finding drivers and passengers';


        const primaryMessage =
            fullRequestSent
                ? 'Your Work group is complete. The full request has been sent to nearby drivers and we are waiting for one to accept.'
                : passengersReady && !paymentsReady
                    ? 'All passengers are matched. We are completing the group payment and safety checks before the driver receives the full trip.'
                    : driverFound
                        ? `A nearby driver is available. We are waiting for ${remainingText} before the driver can receive and accept the full trip.`
                        : `We are searching for a nearby driver while matching ${remainingText}. You do not need to restart the booking.`;


        const driverDetail =
            driverFound
                ? (
                    distanceKm > 0
                        ? `Available driver found about ${distanceKm.toFixed(1)} km from the pickup area.`
                        : driverFoundCount > 1
                            ? `${driverFoundCount} nearby drivers are available around the pickup area.`
                            : 'A nearby driver is available around the pickup area.'
                )
                : 'Asiye is checking active drivers near the pickup area.';


        container.innerHTML = `

            <div class="club-waiting-header">

                <div>

                    <div class="home-kicker">

                        ${
                            request.clubMode ===
                            'club7'
                            ?
                            'Asiye Work 4'
                            :
                            'Asiye Work 3'
                        }

                    </div>

                    <h2 class="home-title">
                        ${headline}
                    </h2>

                    <div class="home-greeting">
                        ${ASIYE.ui.escape(primaryMessage)}
                    </div>

                </div>


                <div class="club-count-circle">

                    ${progress.confirmed}
                    <span>
                        /
                        ${progress.capacity}
                    </span>

                </div>

            </div>


            <div class="club-progress-track">

                <div
                    class="club-progress-fill"
                    style="
                        width:
                        ${progress.percent}%;
                    "
                ></div>

            </div>


            <div class="club-progress-copy">

                ${
                    passengersReady
                    ?
                    'All required passengers are confirmed.'
                    :
                    `${remainingText} needed before the full driver request is released.`
                }

            </div>


            <div class="asiye-request-activity asiye-work-activity">

                <div class="asiye-request-step done">
                    <span><i class="fas fa-check"></i></span>
                    <div>
                        <strong>Your Work booking is active</strong>
                        <small>Asiye is matching the group and checking nearby drivers.</small>
                    </div>
                </div>

                <div class="asiye-request-step ${driverFound ? 'done' : 'active'}">
                    <span>
                        <i class="fas fa-${driverFound ? 'check' : 'location-crosshairs'}"></i>
                    </span>
                    <div>
                        <strong>
                            ${driverFound ? 'Driver found' : 'Searching for a driver'}
                        </strong>
                        <small>
                            ${ASIYE.ui.escape(driverDetail)}
                        </small>
                    </div>
                </div>

                <div class="asiye-request-step ${passengersReady ? 'done' : 'active'}">
                    <span>
                        <i class="fas fa-${passengersReady ? 'check' : 'users'}"></i>
                    </span>
                    <div>
                        <strong>
                            Passengers ${progress.confirmed}/${progress.capacity}
                        </strong>
                        <small>
                            ${
                                passengersReady
                                ? 'Your Work passenger group is complete.'
                                : `Waiting for ${remainingText}. Driver details stay private until the group is ready.`
                            }
                        </small>
                    </div>
                </div>

                <div class="asiye-request-step ${fullRequestSent ? 'active' : ''}">
                    <span><i class="fas fa-car-side"></i></span>
                    <div>
                        <strong>
                            ${
                                fullRequestSent
                                ? 'Waiting for driver to accept'
                                : passengersReady && !paymentsReady
                                    ? 'Completing payment checks'
                                    : 'Driver acceptance comes next'
                            }
                        </strong>
                        <small>
                            ${
                                fullRequestSent
                                ? 'The full trip is now visible to eligible nearby drivers.'
                                : passengersReady && !paymentsReady
                                    ? 'The full request is released only after every passenger is payment-ready.'
                                    : 'The driver receives full trip details only when the passenger group is complete.'
                            }
                        </small>
                    </div>
                </div>

            </div>


            <div class="club-summary-grid">

                <div>
                    <span>Your seat</span>
                    <strong>
                        R${
                            request.pricePerPassenger ||
                            0
                        }
                    </strong>
                </div>

                <div>
                    <span>Group status</span>
                    <strong>
                        ${
                            passengersReady
                            ? 'Ready'
                            : `${progress.confirmed}/${progress.capacity}`
                        }
                    </strong>
                </div>

            </div>


            ${
                !fullRequestSent
                ?
                `
                <button
                    class="secondary-button"
                    id="cancelClubRide"
                    style="margin-top:12px;"
                >
                    Cancel Work booking
                </button>
                `
                :
                ''
            }

        `;


        document
            .getElementById(
                'cancelClubRide'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.booking
                        ?.cancelCurrentRide?.();
                }
            );
    },


    /* ========================================================
       MENU
       ======================================================== */

    openMenu() {

        document
            .getElementById('sideMenu')
            ?.classList
            .add('open');


        document
            .getElementById('menuBackdrop')
            ?.classList
            .add('open');


        ASIYE.state.ui.menuOpen =
            true;
    },


    closeMenu() {

        document
            .getElementById('sideMenu')
            ?.classList
            .remove('open');


        document
            .getElementById('menuBackdrop')
            ?.classList
            .remove('open');


        ASIYE.state.ui.menuOpen =
            false;
    },


    /* ========================================================
       TOAST
       ======================================================== */

    toast(
        message,
        duration = 2600
    ) {

        const container =
            document.getElementById('toastContainer');


        if (!container) return;


        const toast =
            document.createElement('div');


        toast.className =
            'asiye-toast';


        toast.textContent =
            message;


        container.appendChild(toast);


        setTimeout(
            () => {

                toast.remove();

            },
            duration
        );
    },


    /* ========================================================
       ESCAPE HTML
       ======================================================== */

    escape(value) {

        return String(value ?? '')

        .replace(/&/g, '&amp;')

        .replace(/</g, '&lt;')

        .replace(/>/g, '&gt;')

        .replace(/"/g, '&quot;')

        .replace(/'/g, '&#039;');
    }

};


/* ============================================================
   APPLICATION BOOT
   ============================================================ */

document.addEventListener(
    'DOMContentLoaded',
    async function () {

        console.log(
            '🚀 Starting Asiye Passenger V2'
        );


        /*
         * Firebase readiness guard.
         */

        if (
            typeof firebase ===
                'undefined' ||
            !firebase.apps ||
            firebase.apps.length === 0
        ) {

            console.error(
                '❌ Passenger Firebase is not initialized.'
            );


            ASIYE.ui.toast(
                'Unable to connect to Asiye.'
            );


            return;
        }


        /* ====================================================
           WAIT FOR FIREBASE AUTH TO RESTORE SESSION

           The synchronous currentUser check races with
           Firebase restoring the persisted session from
           IndexedDB. Await onAuthStateChanged first so we
           only redirect when Firebase is certain there is
           no authenticated user.
           ==================================================== */

        const authUser =

            await new Promise(
                (resolve, reject) => {

                    const unsubscribe =

                        firebase
                            .auth()
                            .onAuthStateChanged(

                                user => {

                                    unsubscribe();

                                    resolve(
                                        user
                                    );
                                },

                                error => {

                                    unsubscribe();

                                    reject(
                                        error
                                    );
                                }
                            );
                }
            );


        if (!authUser) {

            console.warn(
                'No authenticated passenger session.'
            );


            window.location.replace(
                './login.html'
            );


            return;
        }


        console.log(
            '✅ Passenger authenticated:',
            authUser.uid
        );


        /* ====================================================
           LEGACY COMMUTER COMPATIBILITY

           Some older passengers have a commuter record
           keyed by an ID different from their Firebase
           Auth UID.

           We try the stored commuterId first, verify it
           against Firebase, and fall back to the Auth UID
           if it turns out to be stale.
           ==================================================== */

        let commuterId =
            localStorage.getItem(
                'commuterId'
            ) ||
            authUser.uid;


        let commuterSnapshot =

            await firebase
                .database()
                .ref(
                    `commuters/${commuterId}`
                )
                .once(
                    'value'
                );


        /*
         * If the stored commuter ID is stale,
         * fall back to Firebase Auth UID.
         */

        if (
            !commuterSnapshot.exists() &&
            commuterId !== authUser.uid
        ) {

            console.warn(
                'Stored commuterId is stale. Falling back to Auth UID.'
            );


            commuterId =
                authUser.uid;


            commuterSnapshot =

                await firebase
                    .database()
                    .ref(
                        `commuters/${commuterId}`
                    )
                    .once(
                        'value'
                    );
        }


        const commuter =
            commuterSnapshot.val() || {};

        // Phone sign-up is not finished until a full name AND a saved face
        // image exist. A user navigating directly to index.html must also be
        // sent back to the profile completion step.
        if (authUser.phoneNumber && !(
            String(commuter.name || '').trim().length >= 2 &&
            (commuter.profileImageUrl || commuter.profile_picture_url ||
             commuter.passengerProfileImageUrl)
        )) {
            window.location.replace('./login.html');
            return;
        }


        if (authUser.phoneNumber && ASIYE.profile?.photoAvailable &&
            !(await ASIYE.profile.photoAvailable(commuter))) {
            console.warn('Passenger image URL returned 404 or could not load. Require profile rescan.');
            window.location.replace('./login.html');
            return;
        }

        ASIYE.setUser(
            commuterId,
            commuter
        );

        ASIYE.profile
            ?.refreshUI?.(
                commuter
            );

        ASIYE.wallet
            ?.start?.(
                commuterId
            );

        // Reconcile a successful wallet recharge after the Paystack
        // browser returns; a delayed webhook must not leave a stale balance.
        void ASIYE.payments?.reconcileWalletTopup?.();
        if (!window._asiyeWalletReconcileBound) {
            window._asiyeWalletReconcileBound = true;
            window.addEventListener('focus', () => {
                void ASIYE.payments?.reconcileWalletTopup?.();
            });
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) void ASIYE.payments?.reconcileWalletTopup?.();
            });
        }


        localStorage.setItem(
            'userId',
            commuterId
        );


        localStorage.setItem(
            'commuterId',
            commuterId
        );


        /*
         * Map
         */

        if (
            ASIYE.map &&
            typeof ASIYE.map.init ===
                'function'
        ) {

            ASIYE.map.init();
        }


        /*
         * Location
         */

        if (
            ASIYE.location &&
            typeof ASIYE.location.start ===
                'function'
        ) {

            ASIYE.location.start();
        }


        /*
         * Restore any in-flight ride
         * before rendering home.
         */

        let restored =
            false;


        if (
            ASIYE.ride &&
            typeof ASIYE.ride.restore ===
                'function'
        ) {

            try {

                restored =
                    await ASIYE.ride.restore();

            } catch (error) {

                console.warn(
                    'Ride restore failed:',
                    error
                );
            }
        }


        /*
         * Home — only if no ride
         * was restored.
         */

        if (!restored) {

            ASIYE.ui.renderHome();
        }


        /*
         * Menu controls
         */

        document
            .getElementById('menuButton')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.openMenu();
                }
            );


        document
            .getElementById('closeMenuButton')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.closeMenu();
                }
            );


        document
            .getElementById('menuBackdrop')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.closeMenu();
                }
            );


        /*
         * Current location
         */

        document
            .getElementById('recenterButton')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.map?.centerUser();
                }
            );


        /*
         * Menu navigation
         */

        document
            .querySelectorAll('#sideMenu [data-page]')
            .forEach(button => {

                button.addEventListener(
                    'click',
                    () => {

                        const page =
                            button.dataset.page;


                        ASIYE.ui.closeMenu();


                        if (page === 'home') {

                            ASIYE.ui.renderHome();

                            return;
                        }


                        AsiyePages.open(page);
                    }
                );
            });


        console.log(
            '✅ Asiye Passenger V2 started'
        );
    }
);
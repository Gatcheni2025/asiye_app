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

            Number(
                user.credits ||
                user.walletBalance ||
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

                        <i class="fas fa-car-side"></i>

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


                    ASIYE.ui
                        .renderDestinationSearch();
                }
            );


        container
            .querySelector('[data-action="parcel"]')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.toast(
                        'Parcel service will be connected next.'
                    );
                }
            );


        document
            .getElementById('walletStrip')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.toast(
                        'Wallet screen coming next.'
                    );
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
                'Private ride · Leave immediately',
                prices.go,
                'fa-car-side'
            )}


            ${this.renderRideCard(
                'club4',
                'Asiye Club 4',
                '4 passengers · Fare split between everyone',
                prices.club4,
                'fa-users'
            )}


            ${this.renderRideCard(
                'club7',
                'Asiye Club 7',
                '7 passengers · Lowest daily commuter fare',
                prices.club7,
                'fa-van-shuttle'
            )}


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
                     * Club flow — collect schedule
                     * first, then book.
                     */

                    if (
                        type === 'club4' ||
                        type === 'club7'
                    ) {

                        this.renderClubSchedule();

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


                        const requestId =

                            await ASIYE.booking
                                .createGoRide();


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

                    <i class="fas ${icon}"></i>

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
                'Continue with Club 4',

            club7:
                'Continue with Club 7'
        };


        button.textContent =
            labels[selected] ||
            'Continue';
    },


    /* ========================================================
       CLUB SCHEDULE
       ======================================================== */

    renderClubSchedule() {

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
                    id="clubScheduleBack"
                    class="sheet-back-button"
                >
                    <i class="fas fa-arrow-left"></i>
                </button>


                <div>

                    <h2 class="sheet-page-title">

                        ${config.name}

                    </h2>

                    <div
                        style="
                            color:#888;
                            font-size:10px;
                            margin-top:2px;
                        "
                    >
                        Daily shared commute
                    </div>

                </div>

            </div>


            <div class="club-price-hero">

                <div>

                    <span class="club-price-label">
                        Your seat
                    </span>

                    <strong>
                        R${price}
                    </strong>

                </div>


                <div class="club-seat-count">

                    <i class="fas fa-users"></i>

                    ${config.capacity}
                    passengers

                </div>

            </div>


            <div class="club-info-box">

                <i class="fas fa-circle-info"></i>

                <div>

                    <strong>
                        How Club works
                    </strong>

                    <p>
                        Your fare is shared equally
                        between ${config.capacity}
                        passengers. The driver begins
                        collection once all
                        ${config.capacity} Club members
                        have joined.
                    </p>

                </div>

            </div>


            <label
                class="club-field-label"
                for="clubDepartureTime"
            >
                What time do you leave?
            </label>


            <input
                id="clubDepartureTime"
                class="club-time-input"
                type="time"
                required
            >


            <div class="club-wait-details">

                <div>

                    <i class="fas fa-clock"></i>

                    <span>
                        Pickup window
                    </span>

                    <strong>
                        ±${config.pickupWindowMinutes} min
                    </strong>

                </div>


                <div>

                    <i class="fas fa-hourglass-half"></i>

                    <span>
                        Pool size
                    </span>

                    <strong>
                        ${config.capacity}/${config.capacity}
                    </strong>

                </div>

            </div>


            <button
                id="confirmClubSchedule"
                class="primary-button"
                style="margin-top:16px;"
            >

                Find my Club

            </button>

        `;


        document
            .getElementById('clubScheduleBack')
            ?.addEventListener(
                'click',
                () => {

                    this.renderRideSelection();
                }
            );


        document
            .getElementById('confirmClubSchedule')
            ?.addEventListener(
                'click',
                async () => {

                    const time =

                        document
                            .getElementById(
                                'clubDepartureTime'
                            )
                            ?.value;


                    if (!time) {

                        this.toast(
                            'Choose your departure time.'
                        );

                        return;
                    }


                    ASIYE.state.booking.club
                        .departureTime =
                        time;


                    this.renderClubConfirmation();
                }
            );
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


        const time =
            ASIYE.state.booking
                .club
                .departureTime;


        container.innerHTML = `

            <div class="sheet-page-header">

                <button
                    id="clubConfirmBack"
                    class="sheet-back-button"
                >
                    <i class="fas fa-arrow-left"></i>
                </button>


                <h2 class="sheet-page-title">
                    Confirm Club
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

                    <span>Departure</span>

                    <strong>
                        ${time}
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

                <i class="fas fa-car-side"></i>

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


            <button
                id="bookClubNow"
                class="primary-button"
                style="margin-top:16px;"
            >
                Join Club · R${price}
            </button>

        `;


        document
            .getElementById('clubConfirmBack')
            ?.addEventListener(
                'click',
                () => {

                    this.renderClubSchedule();
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


        const time =
            ASIYE.state.booking
                .club
                .departureTime;


        const button =
            document.getElementById(
                'bookClubNow'
            );


        if (
            !type ||
            !time
        ) {

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

                    time
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


        container.innerHTML = `

            <div class="club-waiting-header">

                <div>

                    <div class="home-kicker">

                        ${
                            request.clubMode ===
                            'club7'
                            ?
                            'Asiye Club 7'
                            :
                            'Asiye Club 4'
                        }

                    </div>

                    <h2 class="home-title">

                        ${
                            progress.ready
                            ?
                            'Your Club is ready'
                            :
                            'Building your Club'
                        }

                    </h2>

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
                    progress.ready

                    ?

                    'All passengers are confirmed.'

                    :

                    `${progress.remaining}
                     seat${
                        progress.remaining === 1
                        ? ''
                        : 's'
                     }
                     remaining`
                }

            </div>


            <div class="club-summary-grid">

                <div>

                    <span>
                        Departure
                    </span>

                    <strong>
                        ${
                            request.departureTime ||
                            '—'
                        }
                    </strong>

                </div>


                <div>

                    <span>
                        Your seat
                    </span>

                    <strong>
                        R${
                            request.pricePerPassenger ||
                            0
                        }
                    </strong>

                </div>

            </div>


            <div class="club-driver-rule">

                <i class="fas fa-car-side"></i>

                <div>

                    <strong>

                        ${
                            progress.ready

                            ?

                            'Finding your Club driver'

                            :

                            'Driver collection has not started'
                        }

                    </strong>

                    <p>

                        ${
                            progress.ready

                            ?

                            'Your Club is complete. We are now preparing collection.'

                            :

                            `Collection begins once all ${progress.capacity} passengers are confirmed.`
                        }

                    </p>

                </div>

            </div>


            ${
                !progress.ready

                ?

                `

                <button
                    class="secondary-button"
                    id="cancelClubRide"
                    style="margin-top:12px;"
                >
                    Cancel Club
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


        ASIYE.setUser(
            commuterId,
            commuter
        );


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


                        ASIYE.ui.toast(
                            `${page} will be connected in Passenger V2.`
                        );
                    }
                );
            });


        console.log(
            '✅ Asiye Passenger V2 started'
        );
    }
);
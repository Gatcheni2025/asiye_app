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


        /*
         * Where to?
         */

        document
            .getElementById('whereToButton')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.renderDestinationSearch();
                }
            );


        /*
         * Ride button
         */

        container
            .querySelector('[data-action="ride"]')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.renderDestinationSearch();
                }
            );


        /*
         * Club
         */

        container
            .querySelector('[data-action="club"]')
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.toast(
                        'Asiye Club will be connected next.'
                    );
                }
            );


        /*
         * Parcel
         */

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


        /*
         * Wallet
         */

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
                'Private ride',
                prices.go,
                'fa-car-side'
            )}


            ${this.renderRideCard(
                'club4',
                'Asiye Club 4',
                'Share with up to 3 others',
                prices.club4,
                'fa-users'
            )}


            ${this.renderRideCard(
                'club6',
                'Asiye Club 6',
                'Lowest shared fare',
                prices.club6,
                'fa-people-group'
            )}


            <button
                id="confirmRideSelection"
                class="primary-button"
                style="margin-top:14px;"
            >
                Confirm Asiye Go
            </button>

        `;


        ASIYE.state.booking.rideType =
            'go';


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
                () => {

                    ASIYE.ui.toast(
                        'Next: payment and booking request.'
                    );
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
                'Confirm Asiye Go',

            club4:
                'Confirm Asiye Club 4',

            club6:
                'Confirm Asiye Club 6'
        };


        button.textContent =
            labels[selected] ||
            'Confirm ride';
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
    function () {

        console.log(
            '🚀 Starting Asiye Passenger V2'
        );


        /*
         * Temporary mock passenger.
         *
         * Firebase will replace this next.
         */

        if (!ASIYE.state.user) {

            ASIYE.setUser(

                localStorage.getItem('userId'),

                {
                    name:
                        'Passenger',

                    credits:
                        0
                }
            );
        }


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
         * Home
         */

        ASIYE.ui.renderHome();


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
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

            document.getElementById(
                'sheetContent'
            );


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
                        ${this.escape(
                            firstName
                        )}?

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

                <div
                    class="
                        destination-search-icon
                    "
                >

                    <i class="fas fa-search"></i>

                </div>


                <div
                    class="
                        destination-button-text
                    "
                >

                    <span
                        class="
                            destination-button-label
                        "
                    >
                        Where to?
                    </span>


                    <span
                        class="
                            destination-button-subtitle
                        "
                    >
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
            .getElementById(
                'whereToButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui
                        .renderDestinationSearch();
                }
            );


        /*
         * Ride button
         */

        container
            .querySelector(
                '[data-action="ride"]'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui
                        .renderDestinationSearch();
                }
            );


        /*
         * Club
         */

        container
            .querySelector(
                '[data-action="club"]'
            )
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
            .querySelector(
                '[data-action="parcel"]'
            )
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
            .getElementById(
                'walletStrip'
            )
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

            document.getElementById(
                'sheetContent'
            );


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
                        value="${
                            this.escape(
                                pickup
                            )
                        }"
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
            .getElementById(
                'destinationBackButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.renderHome();
                }
            );


        const input =

            document.getElementById(
                'destinationInput'
            );


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


                    if (
                        value.length >= 3
                    ) {

                        console.log(
                            'Search destination:',
                            value
                        );


                        /*
                         * Next step:
                         * places.js will handle
                         * Mapbox / Google search.
                         */
                    }
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


        if (
            icon === 'home'
        ) {

            iconClass =
                'fa-house';
        }


        if (
            icon === 'work'
        ) {

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
       MENU
       ======================================================== */

    openMenu() {

        document
            .getElementById(
                'sideMenu'
            )
            ?.classList
            .add(
                'open'
            );


        document
            .getElementById(
                'menuBackdrop'
            )
            ?.classList
            .add(
                'open'
            );


        ASIYE.state.ui.menuOpen =
            true;
    },


    closeMenu() {

        document
            .getElementById(
                'sideMenu'
            )
            ?.classList
            .remove(
                'open'
            );


        document
            .getElementById(
                'menuBackdrop'
            )
            ?.classList
            .remove(
                'open'
            );


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

            document.getElementById(
                'toastContainer'
            );


        if (!container) return;


        const toast =

            document.createElement(
                'div'
            );


        toast.className =
            'asiye-toast';


        toast.textContent =
            message;


        container.appendChild(
            toast
        );


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

        return String(
            value ?? ''
        )

        .replace(
            /&/g,
            '&amp;'
        )

        .replace(
            /</g,
            '&lt;'
        )

        .replace(
            />/g,
            '&gt;'
        )

        .replace(
            /"/g,
            '&quot;'
        )

        .replace(
            /'/g,
            '&#039;'
        );
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

        if (
            !ASIYE.state.user
        ) {

            ASIYE.setUser(

                localStorage.getItem(
                    'userId'
                ),

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
         * Home
         */

        ASIYE.ui.renderHome();


        /*
         * Menu controls
         */

        document
            .getElementById(
                'menuButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.openMenu();
                }
            );


        document
            .getElementById(
                'closeMenuButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.ui.closeMenu();
                }
            );


        document
            .getElementById(
                'menuBackdrop'
            )
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
            .getElementById(
                'recenterButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE.map
                        ?.centerUser();
                }
            );


        /*
         * Menu navigation
         */

        document
            .querySelectorAll(
                '#sideMenu [data-page]'
            )
            .forEach(button => {

                button.addEventListener(
                    'click',
                    () => {

                        const page =
                            button.dataset.page;


                        ASIYE.ui
                            .closeMenu();


                        if (
                            page === 'home'
                        ) {

                            ASIYE.ui
                                .renderHome();

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
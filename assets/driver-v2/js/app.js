/* ============================================================
   ASIYE DRIVER V2
   MAIN UI CONTROLLER
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};


ASIYE_DRIVER.ui = {

    requestTimer:
        null,

    requestSeconds:
        20,

    pinContext:
        null,


    /* ========================================================
       ESCAPE HTML
       ======================================================== */

    escape(value) {

        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    },


    /* ========================================================
       TOAST
       ======================================================== */

    toast(
        message,
        type = ''
    ) {

        const container =
            document.getElementById(
                'driverToastContainer'
            );


        if (!container) return;


        const toast =
            document.createElement(
                'div'
            );


        toast.className =
            `driver-toast ${type}`;


        toast.textContent =
            message;


        container.appendChild(
            toast
        );


        setTimeout(
            () => {

                toast.remove();

            },
            3200
        );
    },


    /* ========================================================
       DRIVER LOGIN REQUIRED
       ======================================================== */

    showDriverLoginRequired() {

        const container =
            document.getElementById(
                'driverSheetContent'
            );


        const homeSheet =
            document.getElementById(
                'driverHomeSheet'
            );


        const activeSheet =
            document.getElementById(
                'activeTripSheet'
            );


        activeSheet
            ?.classList
            .remove(
                'open'
            );


        homeSheet
            ?.classList
            .add(
                'open'
            );


        if (!container) {

            return;
        }


        container.innerHTML = `

            <div
                style="
                    text-align:center;
                    padding:16px 5px 8px;
                "
            >

                <div
                    style="
                        width:58px;
                        height:58px;
                        border-radius:18px;
                        background:#111;
                        color:white;
                        margin:0 auto 14px;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                        font-size:21px;
                    "
                >

                    <i class="fas fa-car-side"></i>

                </div>


                <div class="driver-kicker">

                    Asiye Driver

                </div>


                <h2
                    class="driver-title"
                    style="
                        margin-top:5px;
                    "
                >

                    Driver account required

                </h2>


                <p
                    class="driver-subtitle"
                    style="
                        max-width:300px;
                        margin:7px auto 0;
                    "
                >

                    This browser is not currently
                    connected to a registered
                    Asiye driver profile.

                </p>


                <button
                    id="retryDriverSession"
                    class="
                        driver-btn
                        driver-btn-primary
                        driver-btn-full
                    "
                    style="
                        margin-top:17px;
                    "
                >

                    <i class="fas fa-rotate-right"></i>

                    Retry driver session

                </button>

            </div>

        `;


        document
            .getElementById(
                'retryDriverSession'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.initialize();
                }
            );
    },


    /* ========================================================
       SHOW DASHBOARD
       ======================================================== */

    showDashboard() {

        const homeSheet =
            document.getElementById(
                'driverHomeSheet'
            );


        const activeSheet =
            document.getElementById(
                'activeTripSheet'
            );


        homeSheet?.classList.add(
            'open'
        );


        activeSheet?.classList.remove(
            'open'
        );


        ASIYE_DRIVER.setScreen(
            'dashboard'
        );


        this.renderDashboard();
    },


    /* ========================================================
       RENDER DASHBOARD
       ======================================================== */

    renderDashboard() {

        const container =
            document.getElementById(
                'driverSheetContent'
            );


        if (!container) return;


        const driver =
            ASIYE_DRIVER.state.driver ||
            {};


        const availability =
            ASIYE_DRIVER.state.availability;


        const firstName =

            driver.name ||

            driver.firstName ||

            driver.fullName
                ?.split(' ')[0] ||

            'Driver';


        const online =
            availability.isOnline ===
            true;


        const currentRequest =
            availability.currentRequest;


        const earnings =

            Number(
                driver.todayEarnings ||
                driver.dailyEarnings ||
                0
            );


        const trips =

            Number(
                driver.todayTrips ||
                driver.dailyTrips ||
                0
            );


        const rating =

            Number(
                driver.rating ||
                5
            );


        container.innerHTML = `

            <div class="driver-dashboard-header">

                <div>

                    <div class="driver-kicker">
                        Asiye Driver
                    </div>

                    <h1 class="driver-title">
                        Hello,
                        ${this.escape(firstName)}
                    </h1>

                    <div class="driver-subtitle">

                        ${
                            online

                            ? (
                                currentRequest

                                ? 'You are currently on a trip.'

                                : 'You are online and ready for requests.'
                            )

                            : 'Go online when you are ready to drive.'
                        }

                    </div>

                </div>


                <div
                    class="
                        driver-dashboard-status
                        ${
                            currentRequest

                            ? 'busy'

                            : online

                                ? 'online'

                                : ''
                        }
                    "
                >

                    ${
                        currentRequest
                        ? 'Busy'
                        : online
                            ? 'Online'
                            : 'Offline'
                    }

                </div>

            </div>


            <div class="driver-stat-grid">

                <div class="driver-stat-card">

                    <span class="driver-stat-value">
                        R${earnings.toFixed(0)}
                    </span>

                    <span class="driver-stat-label">
                        Today
                    </span>

                </div>


                <div class="driver-stat-card">

                    <span class="driver-stat-value">
                        ${trips}
                    </span>

                    <span class="driver-stat-label">
                        Trips
                    </span>

                </div>


                <div class="driver-stat-card">

                    <span class="driver-stat-value">
                        ${rating.toFixed(1)}
                    </span>

                    <span class="driver-stat-label">
                        Rating
                    </span>

                </div>

            </div>


            ${
                currentRequest

                ?

                `

                <button
                    id="resumeCurrentTrip"
                    class="driver-main-action"
                >

                    <i class="fas fa-route"></i>

                    Resume current trip

                </button>

                `

                :

                `

                <button
                    id="toggleDriverOnline"
                    class="
                        driver-main-action
                        ${
                            online
                            ? ''
                            : 'offline'
                        }
                    "
                >

                    <i
                        class="
                            fas
                            ${
                                online
                                ? 'fa-power-off'
                                : 'fa-car-side'
                            }
                        "
                    ></i>

                    ${
                        online
                        ? 'Go Offline'
                        : 'Go Online'
                    }

                </button>

                `
            }
        `;


        document
            .getElementById(
                'toggleDriverOnline'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.toggleOnline();
                }
            );


        document
            .getElementById(
                'resumeCurrentTrip'
            )
            ?.addEventListener(
                'click',
                () => {

                    const requestId =

                        ASIYE_DRIVER.state
                            .availability
                            .currentRequest;


                    if (
                        requestId &&
                        ASIYE_DRIVER.trip
                    ) {

                        ASIYE_DRIVER.trip
                            .start(
                                requestId
                            );
                    }
                }
            );


        this.updateTopStatus();
    },


    /* ========================================================
       ONLINE / OFFLINE
       ======================================================== */

    async toggleOnline() {

        const driverId =
            ASIYE_DRIVER.state.driverId;


        if (!driverId) {

            this.toast(
                'Driver account is not ready.',
                'warning'
            );

            return;
        }


        if (
            ASIYE_DRIVER.state.availability
                .currentRequest
        ) {

            this.toast(
                'Finish your current trip first.',
                'warning'
            );

            return;
        }


        const currentlyOnline =
            ASIYE_DRIVER.state.availability
                .isOnline;


        const newOnline =
            !currentlyOnline;


        try {

            await firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                )
                .update({

                    isOnline:
                        newOnline,

                    isBroadcasting:
                        newOnline,

                    isFull:
                        false,

                    updatedAt:

                        firebase
                            .database
                            .ServerValue
                            .TIMESTAMP
                });


            ASIYE_DRIVER.state
                .availability
                .isOnline =
                newOnline;


            ASIYE_DRIVER.state
                .availability
                .isBroadcasting =
                newOnline;


            if (
                ASIYE_DRIVER.state.driver
            ) {

                ASIYE_DRIVER.state
                    .driver
                    .isOnline =
                    newOnline;


                ASIYE_DRIVER.state
                    .driver
                    .isBroadcasting =
                    newOnline;
            }


            this.renderDashboard();


            if (newOnline) {

                this.toast(
                    'You are now online.',
                    'success'
                );


                ASIYE_DRIVER.requests
                    ?.start?.();

            } else {

                this.toast(
                    'You are now offline.'
                );
            }


        } catch (error) {

            console.error(
                'Online status failed:',
                error
            );


            this.toast(
                'Could not update driver status.',
                'danger'
            );
        }
    },


    /* ========================================================
       TOP STATUS
       ======================================================== */

    updateTopStatus() {

        const dot =
            document.getElementById(
                'driverOnlineDot'
            );


        const text =
            document.getElementById(
                'driverStatusText'
            );


        const availability =
            ASIYE_DRIVER.state.availability;


        if (!dot || !text) return;


        dot.classList.remove(
            'online',
            'busy',
            'offline'
        );


        if (
            availability.currentRequest
        ) {

            dot.classList.add(
                'busy'
            );


            text.textContent =
                'On trip';

            return;
        }


        if (
            availability.isOnline
        ) {

            dot.classList.add(
                'online'
            );


            text.textContent =
                'Online';

        } else {

            dot.classList.add(
                'offline'
            );


            text.textContent =
                'Offline';
        }
    },


    /* ========================================================
       INCOMING REQUEST
       ======================================================== */

    showIncomingRequest(
        request
    ) {

        const overlay =
            document.getElementById(
                'incomingRequestOverlay'
            );


        const content =
            document.getElementById(
                'incomingRequestContent'
            );


        const typeBadge =
            document.getElementById(
                'incomingRequestType'
            );


        if (
            !overlay ||
            !content ||
            !typeBadge
        ) {

            return;
        }


        const isClub =
            request.type === 'club';


        typeBadge.textContent =

            isClub

            ? (
                request.clubMode ===
                'club7'

                ? 'ASIYE CLUB 7'

                : 'ASIYE CLUB 4'
            )

            : 'ASIYE GO';


        typeBadge.classList.toggle(
            'club',
            isClub
        );


        const fare =

            isClub

            ? Number(
                request.pricePerPassenger ||
                request.calculatedPrice ||
                0
            )

            : Number(
                request.finalAmount ||
                request.calculatedPrice ||
                0
            );


        const distance =

            Number(
                request.routeDistanceKm ||
                0
            );


        const duration =

            Number(
                request.routeDurationMinutes ||
                0
            );


        const passengerCount =

            isClub

            ? Number(
                request.passengerCount ||
                Object.keys(
                    request.passengers ||
                    {}
                ).length
            )

            : 1;


        const capacity =

            isClub

            ? Number(
                request.capacity ||
                request.maxCapacity ||
                (
                    request.clubMode ===
                    'club7'
                    ? 7
                    : 4
                )
            )

            : 1;


        content.innerHTML = `

            <h2 class="driver-request-heading">

                ${
                    isClub
                    ? 'New Club request'
                    : 'New ride request'
                }

            </h2>


            <div class="driver-request-passenger">

                ${
                    isClub

                    ? `${passengerCount} of ${capacity} passengers confirmed`

                    : this.escape(
                        request.commuterName ||
                        'Passenger'
                    )
                }

            </div>


            <div class="driver-request-route">

                <div class="driver-route-point">

                    <span class="driver-route-dot"></span>

                    <div class="driver-route-copy">

                        <small>
                            Pickup
                        </small>

                        <strong>
                            ${this.escape(
                                request.pickupAddress ||
                                'Pickup location'
                            )}
                        </strong>

                    </div>

                </div>


                <div class="driver-route-line"></div>


                <div class="driver-route-point">

                    <span
                        class="
                            driver-route-dot
                            destination
                        "
                    ></span>

                    <div class="driver-route-copy">

                        <small>
                            Destination
                        </small>

                        <strong>
                            ${this.escape(
                                request.destination ||
                                'Destination'
                            )}
                        </strong>

                    </div>

                </div>

            </div>


            <div class="driver-request-meta">

                <div>

                    <span>
                        Distance
                    </span>

                    <strong>
                        ${
                            distance
                            ? `${distance.toFixed(1)} km`
                            : '—'
                        }
                    </strong>

                </div>


                <div>

                    <span>
                        Trip
                    </span>

                    <strong>
                        ${
                            duration
                            ? `${duration} min`
                            : '—'
                        }
                    </strong>

                </div>


                <div>

                    <span>
                        ${
                            isClub
                            ? 'Passengers'
                            : 'Payment'
                        }
                    </span>

                    <strong>

                        ${
                            isClub

                            ? `${passengerCount}/${capacity}`

                            : this.escape(
                                request.paymentMethod ||
                                'cash'
                            )
                        }

                    </strong>

                </div>

            </div>


            ${
                isClub

                ?

                `

                <div class="driver-club-summary">

                    <div>

                        <span>
                            Departure
                        </span>

                        <strong>
                            ${
                                this.escape(
                                    request.departureTime ||
                                    request.morningDeparture ||
                                    '—'
                                )
                            }
                        </strong>

                    </div>


                    <div>

                        <span>
                            Seats remaining
                        </span>

                        <strong>
                            ${
                                Math.max(
                                    0,
                                    capacity -
                                    passengerCount
                                )
                            }
                        </strong>

                    </div>

                </div>

                `

                : ''
            }


            <div class="driver-request-price">

                <span>
                    ${
                        isClub
                        ? 'Per passenger'
                        : 'Trip fare'
                    }
                </span>

                <strong>
                    R${fare.toFixed(2)}
                </strong>

            </div>
        `;


        overlay.classList.add(
            'open'
        );


        ASIYE_DRIVER.state.ui
            .requestPopupOpen =
            true;


        this.startRequestTimer();
    },


    /* ========================================================
       CLOSE INCOMING REQUEST
       ======================================================== */

    closeIncomingRequest() {

        document
            .getElementById(
                'incomingRequestOverlay'
            )
            ?.classList
            .remove(
                'open'
            );


        ASIYE_DRIVER.state.ui
            .requestPopupOpen =
            false;


        this.stopRequestTimer();
    },


    /* ========================================================
       REQUEST TIMER
       ======================================================== */

    startRequestTimer() {

        this.stopRequestTimer();


        this.requestSeconds =
            20;


        const timer =
            document.getElementById(
                'incomingRequestTimer'
            );


        if (timer) {

            timer.textContent =
                this.requestSeconds;
        }


        this.requestTimer =
            setInterval(
                () => {

                    this.requestSeconds--;


                    if (timer) {

                        timer.textContent =
                            Math.max(
                                0,
                                this.requestSeconds
                            );
                    }


                    if (
                        this.requestSeconds <=
                        0
                    ) {

                        this.stopRequestTimer();


                        ASIYE_DRIVER.requests
                            ?.decline?.();


                        this.closeIncomingRequest();
                    }

                },
                1000
            );
    },


    stopRequestTimer() {

        if (
            this.requestTimer
        ) {

            clearInterval(
                this.requestTimer
            );


            this.requestTimer =
                null;
        }
    },


    /* ========================================================
       ACCEPTED TRIP
       ======================================================== */

    showAcceptedTrip(
        request
    ) {

        this.closeIncomingRequest();


        this.openActiveTripSheet();


        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) return;


        container.innerHTML = `

            <div class="driver-trip-header">

                <div>

                    <div class="driver-kicker">
                        Asiye Go
                    </div>

                    <h2 class="driver-title">
                        Ride accepted
                    </h2>

                    <div class="driver-subtitle">

                        ${
                            this.escape(
                                request.commuterName ||
                                'Passenger'
                            )
                        }

                    </div>

                </div>


                <div class="driver-trip-status-icon">

                    <i class="fas fa-car-side"></i>

                </div>

            </div>


            <div class="driver-trip-card">

                <div class="driver-trip-row">

                    <span>
                        Pickup
                    </span>

                    <strong>
                        ${
                            this.escape(
                                request.pickupAddress ||
                                'Pickup'
                            )
                        }
                    </strong>

                </div>


                <div class="driver-trip-row">

                    <span>
                        Destination
                    </span>

                    <strong>
                        ${
                            this.escape(
                                request.destination ||
                                'Destination'
                            )
                        }
                    </strong>

                </div>


                <div class="driver-trip-row">

                    <span>
                        Fare
                    </span>

                    <strong>
                        R${
                            Number(
                                request.finalAmount ||
                                request.calculatedPrice ||
                                0
                            )
                            .toFixed(2)
                        }
                    </strong>

                </div>

            </div>


            <div
                class="
                    driver-trip-actions
                    single
                "
            >

                <button
                    id="driverStartPickup"
                    class="
                        driver-btn
                        driver-btn-primary
                    "
                >

                    <i class="fas fa-location-arrow"></i>

                    Start pickup

                </button>

            </div>
        `;


        document
            .getElementById(
                'driverStartPickup'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.trip
                        .startPickup();
                }
            );


        this.updateTopStatus();
    },


    /* ========================================================
       CLUB WAITING
       ======================================================== */

    showClubWaiting(data) {

        this.closeIncomingRequest();

        this.openActiveTripSheet();


        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) return;


        const {
            request,
            confirmed,
            capacity,
            remaining
        } =
            data;


        const percent =

            Math.min(

                100,

                Math.round(
                    confirmed /
                    capacity *
                    100
                )
            );


        container.innerHTML = `

            <div class="driver-trip-header">

                <div>

                    <div class="driver-kicker">
                        ${
                            capacity === 7
                            ? 'Asiye Club 7'
                            : 'Asiye Club 4'
                        }
                    </div>

                    <h2 class="driver-title">
                        Waiting for Club
                    </h2>

                    <div class="driver-subtitle">

                        You are assigned to this Club.
                        Collection starts when all seats are confirmed.

                    </div>

                </div>


                <div
                    class="
                        driver-trip-status-icon
                        warning
                    "
                >

                    <i class="fas fa-users"></i>

                </div>

            </div>


            <div class="driver-club-progress">

                <div class="driver-club-progress-track">

                    <div
                        class="driver-club-progress-fill"
                        style="
                            width:${percent}%;
                        "
                    ></div>

                </div>


                <div class="driver-club-progress-copy">

                    <span>
                        ${confirmed}/${capacity}
                        passengers
                    </span>

                    <span>
                        ${remaining}
                        remaining
                    </span>

                </div>

            </div>


            <div class="driver-club-summary">

                <div>

                    <span>
                        Departure
                    </span>

                    <strong>
                        ${
                            this.escape(
                                request.departureTime ||
                                request.morningDeparture ||
                                '—'
                            )
                        }
                    </strong>

                </div>


                <div>

                    <span>
                        Per passenger
                    </span>

                    <strong>
                        R${
                            Number(
                                request.pricePerPassenger ||
                                0
                            )
                            .toFixed(2)
                        }
                    </strong>

                </div>

            </div>


            <div class="driver-club-wait-card">

                <i class="fas fa-clock"></i>

                <div>

                    <strong>
                        Driver waiting
                    </strong>

                    <p>
                        Do not start collecting passengers
                        until the Club is full.
                    </p>

                </div>

            </div>


            <div
                class="
                    driver-trip-actions
                    single
                "
            >

                <button
                    id="viewClubPassengers"
                    class="
                        driver-btn
                        driver-btn-secondary
                    "
                >

                    <i class="fas fa-users"></i>

                    View passengers

                </button>

            </div>
        `;


        document
            .getElementById(
                'viewClubPassengers'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.showClubPassengers(
                        request
                    );
                }
            );


        this.updateTopStatus();
    },


    /* ========================================================
       CLUB READY
       ======================================================== */

    showClubReady(
        request
    ) {

        this.openActiveTripSheet();


        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) return;


        const capacity =

            Number(
                request.capacity ||
                request.maxCapacity ||
                4
            );


        container.innerHTML = `

            <div class="driver-trip-header">

                <div>

                    <div class="driver-kicker">

                        ${
                            capacity === 7
                            ? 'Asiye Club 7'
                            : 'Asiye Club 4'
                        }

                    </div>

                    <h2 class="driver-title">
                        Club ready
                    </h2>

                    <div class="driver-subtitle">

                        All ${capacity}
                        passengers are confirmed.

                    </div>

                </div>


                <div
                    class="
                        driver-trip-status-icon
                        success
                    "
                >

                    <i class="fas fa-check"></i>

                </div>

            </div>


            <div class="driver-club-summary">

                <div>

                    <span>
                        Passengers
                    </span>

                    <strong>
                        ${capacity}/${capacity}
                    </strong>

                </div>


                <div>

                    <span>
                        Departure
                    </span>

                    <strong>
                        ${
                            this.escape(
                                request.departureTime ||
                                'Ready'
                            )
                        }
                    </strong>

                </div>

            </div>


            <div class="driver-trip-actions">

                <button
                    id="viewClubPassengers"
                    class="
                        driver-btn
                        driver-btn-secondary
                    "
                >

                    Passengers

                </button>


                <button
                    id="startClubCollection"
                    class="
                        driver-btn
                        driver-btn-primary
                    "
                >

                    Start collection

                </button>

            </div>
        `;


        document
            .getElementById(
                'viewClubPassengers'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.showClubPassengers(
                        request
                    );
                }
            );


        document
            .getElementById(
                'startClubCollection'
            )
            ?.addEventListener(
                'click',
                async () => {

                    try {

                        await ASIYE_DRIVER.trip
                            .startClubCollection();

                    } catch (error) {

                        this.toast(
                            error.message,
                            'warning'
                        );
                    }
                }
            );
    },


    /* ========================================================
       CLUB PICKUP
       ======================================================== */

    showClubPickup(
        passenger
    ) {

        this.openActiveTripSheet();


        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) return;


        container.innerHTML = `

            <div class="driver-trip-header">

                <div>

                    <div class="driver-kicker">
                        Club collection
                    </div>

                    <h2 class="driver-title">

                        Pick up
                        ${
                            this.escape(
                                passenger.name ||
                                passenger.commuterName ||
                                'Passenger'
                            )
                        }

                    </h2>

                    <div class="driver-subtitle">

                        ${
                            this.escape(
                                passenger.pickupAddress ||
                                'Pickup location'
                            )
                        }

                    </div>

                </div>


                <div class="driver-trip-status-icon">

                    <i class="fas fa-location-dot"></i>

                </div>

            </div>


            <div class="driver-trip-card">

                <div class="driver-trip-row">

                    <span>
                        Passenger
                    </span>

                    <strong>
                        ${
                            this.escape(
                                passenger.name ||
                                passenger.commuterName ||
                                'Passenger'
                            )
                        }
                    </strong>

                </div>


                <div class="driver-trip-row">

                    <span>
                        Pickup
                    </span>

                    <strong>
                        ${
                            this.escape(
                                passenger.pickupAddress ||
                                'Pickup'
                            )
                        }
                    </strong>

                </div>

            </div>


            <div
                class="
                    driver-trip-actions
                    single
                "
            >

                <button
                    id="driverClubArrived"
                    class="
                        driver-btn
                        driver-btn-primary
                    "
                >

                    <i class="fas fa-flag-checkered"></i>

                    I have arrived

                </button>

            </div>
        `;


        document
            .getElementById(
                'driverClubArrived'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.trip
                        .markArrived();
                }
            );
    },


    /* ========================================================
       GO PICKUP NAVIGATION
       ======================================================== */

    showPickupNavigation(
        request
    ) {

        this.openActiveTripSheet();


        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) return;


        container.innerHTML = `

            <div class="driver-trip-header">

                <div>

                    <div class="driver-kicker">
                        Passenger pickup
                    </div>

                    <h2 class="driver-title">
                        Drive to passenger
                    </h2>

                    <div class="driver-subtitle">

                        ${
                            this.escape(
                                request.pickupAddress ||
                                'Pickup location'
                            )
                        }

                    </div>

                </div>


                <div class="driver-trip-status-icon">

                    <i class="fas fa-location-arrow"></i>

                </div>

            </div>


            <div
                class="
                    driver-trip-actions
                    single
                "
            >

                <button
                    id="driverMarkArrived"
                    class="
                        driver-btn
                        driver-btn-primary
                    "
                >

                    <i class="fas fa-flag-checkered"></i>

                    I have arrived

                </button>

            </div>
        `;


        document
            .getElementById(
                'driverMarkArrived'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.trip
                        .markArrived();
                }
            );
    },


    /* ========================================================
       PIN
       ======================================================== */

    showPassengerPin(
        context
    ) {

        this.pinContext =
            context;


        ASIYE_DRIVER.setCurrentClubPassenger(
            context.isClub
            ? context.passengerId
            : null
        );


        const overlay =
            document.getElementById(
                'driverPinOverlay'
            );


        const name =
            document.getElementById(
                'driverPinPassengerName'
            );


        const input =
            document.getElementById(
                'driverPinInput'
            );


        const error =
            document.getElementById(
                'driverPinError'
            );


        if (!overlay) return;


        if (name) {

            name.textContent =

                context.passengerName ||
                'Passenger';
        }


        if (input) {

            input.value =
                '';

            setTimeout(
                () => input.focus(),
                120
            );
        }


        error?.classList.remove(
            'show'
        );


        overlay.classList.add(
            'open'
        );
    },


    closePassengerPin() {

        document
            .getElementById(
                'driverPinOverlay'
            )
            ?.classList
            .remove(
                'open'
            );


        this.pinContext =
            null;
    },


    async verifyPin() {

        const input =
            document.getElementById(
                'driverPinInput'
            );


        const error =
            document.getElementById(
                'driverPinError'
            );


        if (
            !input ||
            !this.pinContext
        ) {

            return;
        }


        const entered =
            input.value.trim();


        let valid =
            false;


        if (
            this.pinContext.isClub
        ) {

            valid =

                await ASIYE_DRIVER.trip
                    .verifyClubPin(

                        this.pinContext
                            .passengerId,

                        entered
                    );

        } else {

            valid =

                await ASIYE_DRIVER.trip
                    .verifyGoPin(
                        entered
                    );
        }


        if (valid) {

            this.closePassengerPin();


            this.toast(
                'Passenger verified.',
                'success'
            );

        } else {

            error?.classList.add(
                'show'
            );


            input.value =
                '';


            input.focus();
        }
    },


    /* ========================================================
       IN TRANSIT
       ======================================================== */

    showInTransit(
        request
    ) {

        this.openActiveTripSheet();


        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) return;


        container.innerHTML = `

            <div class="driver-trip-header">

                <div>

                    <div class="driver-kicker">
                        Trip underway
                    </div>

                    <h2 class="driver-title">
                        Drive to destination
                    </h2>

                    <div class="driver-subtitle">

                        ${
                            this.escape(
                                request.destination ||
                                'Destination'
                            )
                        }

                    </div>

                </div>


                <div
                    class="
                        driver-trip-status-icon
                        success
                    "
                >

                    <i class="fas fa-route"></i>

                </div>

            </div>


            <div
                class="
                    driver-trip-actions
                    single
                "
            >

                <button
                    id="driverCompleteTrip"
                    class="
                        driver-btn
                        driver-btn-primary
                    "
                >

                    <i class="fas fa-check"></i>

                    Complete trip

                </button>

            </div>
        `;


        document
            .getElementById(
                'driverCompleteTrip'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.confirm(

                        'Complete trip',

                        'Confirm that you have reached the destination.',

                        async () => {

                            await ASIYE_DRIVER.trip
                                .completeTrip();
                        }
                    );
                }
            );
    },


    /* ========================================================
       COMPLETED
       ======================================================== */

    showTripCompleted(
        request
    ) {

        const overlay =
            document.getElementById(
                'driverCompletedOverlay'
            );


        const fareElement =
            document.getElementById(
                'driverCompletedFare'
            );


        const details =
            document.getElementById(
                'driverCompletedDetails'
            );


        if (!overlay) return;


        let amount =
            0;


        if (
            request.type ===
            'club'
        ) {

            const count =

                Number(
                    request.passengerCount ||
                    Object.keys(
                        request.passengers ||
                        {}
                    ).length
                );


            amount =

                Number(
                    request.pricePerPassenger ||
                    0
                ) *
                count;

        } else {

            amount =

                Number(
                    request.finalAmount ||
                    request.calculatedPrice ||
                    0
                );
        }


        if (fareElement) {

            fareElement.textContent =
                `R${amount.toFixed(2)}`;
        }


        if (details) {

            details.textContent =

                request.type ===
                'club'

                ? 'Club trip completed'

                : `${request.paymentMethod || 'cash'} payment`;
        }


        overlay.classList.add(
            'open'
        );
    },


    /* ========================================================
       CLUB PASSENGERS
       ======================================================== */

    showClubPassengers(
        request
    ) {

        const overlay =
            document.getElementById(
                'clubPassengerOverlay'
            );


        const container =
            document.getElementById(
                'clubPassengerList'
            );


        if (
            !overlay ||
            !container
        ) {

            return;
        }


        const passengers =

            Object.entries(
                request.passengers ||
                {}
            );


        if (
            passengers.length ===
            0
        ) {

            container.innerHTML = `

                <div class="driver-subtitle">
                    No passengers yet.
                </div>

            `;

        } else {

            container.innerHTML =

                passengers
                .map(
                    (
                        [id, passenger],
                        index
                    ) => {

                        const status =
                            passenger.status ||
                            'waiting_pool';


                        let statusClass =
                            '';


                        let statusText =
                            'Waiting';


                        if (
                            [
                                'passenger_onboard',
                                'in_transit',
                                'completed'
                            ]
                            .includes(status)
                        ) {

                            statusClass =
                                'onboard';

                            statusText =
                                'Onboard';

                        } else if (
                            status ===
                            'driver_on_way'
                        ) {

                            statusClass =
                                'on-way';

                            statusText =
                                'On way';

                        } else if (
                            status.includes(
                                'cancelled'
                            )
                        ) {

                            statusClass =
                                'cancelled';

                            statusText =
                                'Cancelled';
                        }


                        return `

                            <div class="club-passenger-item">

                                <div class="club-passenger-top">

                                    <div class="club-passenger-number">

                                        ${
                                            index + 1
                                        }

                                    </div>


                                    <div class="club-passenger-info">

                                        <div class="club-passenger-name">

                                            ${
                                                this.escape(

                                                    passenger.name ||

                                                    passenger.commuterName ||

                                                    'Passenger'
                                                )
                                            }

                                        </div>


                                        <div class="club-passenger-address">

                                            ${
                                                this.escape(
                                                    passenger.pickupAddress ||
                                                    'Pickup location'
                                                )
                                            }

                                        </div>

                                    </div>


                                    <div
                                        class="
                                            club-passenger-status
                                            ${statusClass}
                                        "
                                    >

                                        ${statusText}

                                    </div>

                                </div>

                            </div>

                        `;
                    }
                )
                .join('');
        }


        overlay.classList.add(
            'open'
        );
    },


    /* ========================================================
       ACTIVE SHEET
       ======================================================== */

    openActiveTripSheet() {

        document
            .getElementById(
                'driverHomeSheet'
            )
            ?.classList
            .remove(
                'open'
            );


        document
            .getElementById(
                'activeTripSheet'
            )
            ?.classList
            .add(
                'open'
            );


        ASIYE_DRIVER.setScreen(
            'trip'
        );


        this.updateTopStatus();
    },


    /* ========================================================
       CONFIRM
       ======================================================== */

    confirm(
        title,
        message,
        callback
    ) {

        const overlay =
            document.getElementById(
                'driverConfirmOverlay'
            );


        const titleElement =
            document.getElementById(
                'driverConfirmTitle'
            );


        const messageElement =
            document.getElementById(
                'driverConfirmMessage'
            );


        const action =
            document.getElementById(
                'driverConfirmAction'
            );


        if (!overlay) return;


        if (titleElement) {

            titleElement.textContent =
                title;
        }


        if (messageElement) {

            messageElement.textContent =
                message;
        }


        overlay.classList.add(
            'open'
        );


        if (action) {

            action.onclick =
                async () => {

                    overlay.classList
                        .remove(
                            'open'
                        );


                    if (
                        typeof callback ===
                        'function'
                    ) {

                        await callback();
                    }
                };
        }
    },


    /* ========================================================
       SIDE MENU
       ======================================================== */

    openMenu() {

        document
            .getElementById(
                'driverSideMenu'
            )
            ?.classList
            .add(
                'open'
            );


        document
            .getElementById(
                'driverMenuBackdrop'
            )
            ?.classList
            .add(
                'open'
            );
    },


    closeMenu() {

        document
            .getElementById(
                'driverSideMenu'
            )
            ?.classList
            .remove(
                'open'
            );


        document
            .getElementById(
                'driverMenuBackdrop'
            )
            ?.classList
            .remove(
                'open'
            );
    },


    /* ========================================================
       DRIVER PROFILE UI
       ======================================================== */

    updateDriverProfileUI() {

        const driver =
            ASIYE_DRIVER.state.driver ||
            {};


        const name =

            `${driver.name || ''} ${driver.surname || ''}`
            .trim() ||

            driver.fullName ||

            'Asiye Driver';


        const initial =

            name
            .charAt(0)
            .toUpperCase();


        const vehicle =

            [
                driver.vehicleMake ||
                driver.make,

                driver.vehicleModel ||
                driver.model,

                driver.registration ||
                driver.registrationNumber
            ]
            .filter(Boolean)
            .join(' ');


        const profileInitial =
            document.getElementById(
                'driverProfileInitial'
            );


        const menuAvatar =
            document.getElementById(
                'driverMenuAvatar'
            );


        const menuName =
            document.getElementById(
                'driverMenuName'
            );


        const menuVehicle =
            document.getElementById(
                'driverMenuVehicle'
            );


        if (profileInitial) {

            profileInitial.textContent =
                initial;
        }


        if (menuAvatar) {

            menuAvatar.textContent =
                initial;
        }


        if (menuName) {

            menuName.textContent =
                name;
        }


        if (menuVehicle) {

            menuVehicle.textContent =

                vehicle ||
                'Driver account';
        }
    }

};


/* ============================================================
   DRIVER SESSION RESOLUTION

   Important:
   Passenger and Driver V2 may share the same Firebase Auth
   session in the browser.

   Therefore we NEVER assume currentUser is a taxi driver.
   We verify the UID against taxis/{uid}.
   ============================================================ */

ASIYE_DRIVER.initialize = async function () {

    console.log(
        '🚕 Starting Asiye Driver V2'
    );


    try {

        const driverSession =
            await ASIYE_DRIVER.resolveDriverSession();


        if (!driverSession) {

            console.warn(
                '⚠️ No valid Asiye driver session found.'
            );


            ASIYE_DRIVER.ui
                .showDriverLoginRequired();

            return;
        }


        console.log(
            '✅ Valid driver session:',
            driverSession.uid
        );


        await ASIYE_DRIVER.loadDriver(

            driverSession.uid,

            driverSession.data
        );


    } catch (error) {

        console.error(
            '❌ Driver startup failed:',
            error
        );


        ASIYE_DRIVER.ui.toast(
            error.message ||
            'Unable to start driver app.',
            'danger'
        );
    }
};


/* ============================================================
   FIND THE CORRECT DRIVER UID
   ============================================================ */

ASIYE_DRIVER.resolveDriverSession =
async function () {

    /*
     * Candidate priority:
     *
     * 1. Dedicated Driver V2 driverId
     * 2. Old Asiye userId, but only if type says driver
     * 3. Firebase authenticated UID
     *
     * EVERY candidate is checked against taxis/{uid}.
     */

    const candidates = [];


    const savedDriverId =
        localStorage.getItem(
            'driverId'
        );


    const savedUserId =
        localStorage.getItem(
            'userId'
        );


    const savedUserType =

        String(
            localStorage.getItem(
                'userType'
            ) || ''
        )
        .toLowerCase();


    const authUser =
        firebase.auth().currentUser;


    /*
     * Dedicated V2 driver session.
     */

    if (savedDriverId) {

        candidates.push({

            uid:
                savedDriverId,

            source:
                'driverId'
        });
    }


    /*
     * Legacy Asiye Driver session.
     */

    if (
        savedUserId &&
        (
            savedUserType ===
                'driver' ||

            savedUserType ===
                'taxi' ||

            !savedUserType
        )
    ) {

        candidates.push({

            uid:
                savedUserId,

            source:
                'legacy-userId'
        });
    }


    /*
     * Firebase Auth can be passenger OR driver.
     * So it MUST be verified against taxis/.
     */

    if (
        authUser?.uid
    ) {

        candidates.push({

            uid:
                authUser.uid,

            source:
                'firebase-auth'
        });
    }


    /*
     * Remove duplicate UIDs.
     */

    const unique = [];

    const seen =
        new Set();


    candidates.forEach(
        candidate => {

            if (
                !candidate.uid ||
                seen.has(
                    candidate.uid
                )
            ) {

                return;
            }


            seen.add(
                candidate.uid
            );


            unique.push(
                candidate
            );
        }
    );


    console.log(
        '🔎 Driver session candidates:',
        unique.map(
            candidate => ({
                source:
                    candidate.source,

                uid:
                    candidate.uid
            })
        )
    );


    /*
     * Verify each candidate against Firebase.
     */

    for (
        const candidate
        of unique
    ) {

        try {

            const snapshot =

                await firebase
                    .database()
                    .ref(
                        `taxis/${candidate.uid}`
                    )
                    .once(
                        'value'
                    );


            if (
                snapshot.exists()
            ) {

                const driver =
                    snapshot.val();


                console.log(

                    `✅ Taxi profile found using ${candidate.source}`,

                    candidate.uid
                );


                /*
                 * Save dedicated Driver V2 identity.
                 */

                localStorage.setItem(
                    'driverId',
                    candidate.uid
                );


                localStorage.setItem(
                    'userType',
                    'driver'
                );


                return {

                    uid:
                        candidate.uid,

                    data:
                        driver,

                    source:
                        candidate.source
                };
            }


            console.log(

                `ℹ️ ${candidate.source} UID is not a taxi profile:`,

                candidate.uid
            );


        } catch (error) {

            console.warn(

                `Could not check driver candidate ${candidate.uid}:`,

                error
            );
        }
    }


    return null;
};


/* ============================================================
   LOAD VERIFIED DRIVER
   ============================================================ */

ASIYE_DRIVER.loadDriver =
async function (
    driverId,
    existingDriverData = null
) {

    try {

        let driver =
            existingDriverData;


        /*
         * Fetch if resolver did not already
         * provide the profile.
         */

        if (!driver) {

            const snapshot =

                await firebase
                    .database()
                    .ref(
                        `taxis/${driverId}`
                    )
                    .once(
                        'value'
                    );


            if (
                !snapshot.exists()
            ) {

                throw new Error(
                    'This account does not have an Asiye driver profile.'
                );
            }


            driver =
                snapshot.val();
        }


        /*
         * Establish Driver V2 identity.
         */

        ASIYE_DRIVER.setDriver(
            driverId,
            driver
        );


        localStorage.setItem(
            'driverId',
            driverId
        );


        localStorage.setItem(
            'userType',
            'driver'
        );


        console.log(
            '✅ Driver profile loaded:',
            driverId
        );


        /*
         * ====================================================
         * SINGLE LIVE DRIVER PROFILE LISTENER
         * ====================================================
         */

        if (
            ASIYE_DRIVER.driverProfileRef &&
            ASIYE_DRIVER.driverProfileListener
        ) {

            ASIYE_DRIVER
                .driverProfileRef
                .off(
                    'value',

                    ASIYE_DRIVER
                        .driverProfileListener
                );
        }


        ASIYE_DRIVER.driverProfileRef =

            firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                );


        ASIYE_DRIVER.driverProfileListener =

            ASIYE_DRIVER
                .driverProfileRef
                .on(
                    'value',

                    snapshot => {

                        const liveDriver =
                            snapshot.val();


                        if (!liveDriver) {

                            console.warn(
                                'Driver profile was removed.'
                            );

                            return;
                        }


                        ASIYE_DRIVER.state.driver =
                            liveDriver;


                        ASIYE_DRIVER
                            .syncDriverAvailability(
                                liveDriver
                            );


                        ASIYE_DRIVER.ui
                            .updateTopStatus();


                        ASIYE_DRIVER.ui
                            .updateDriverProfileUI();


                        if (
                            ASIYE_DRIVER.state
                                .ui
                                .screen ===
                            'dashboard'
                        ) {

                            ASIYE_DRIVER.ui
                                .renderDashboard();
                        }
                    }
                );


        /*
         * Map
         */

        ASIYE_DRIVER.map
            ?.init?.();


        /*
         * GPS
         */

        ASIYE_DRIVER.location
            ?.start?.();


        /*
         * Driver profile UI
         */

        ASIYE_DRIVER.ui
            .updateDriverProfileUI();


        ASIYE_DRIVER.ui
            .showDashboard();


        /*
         * IMPORTANT:
         *
         * Restore an existing trip BEFORE
         * listening for new requests.
         */

        await ASIYE_DRIVER.requests
            .restoreActiveRequest();


        /*
         * Start incoming bookings only
         * when this driver is online and
         * does not already have a trip.
         */

        if (
            ASIYE_DRIVER.state
                .availability
                .isOnline &&

            !ASIYE_DRIVER.state
                .availability
                .currentRequest
        ) {

            ASIYE_DRIVER.requests
                .start();
        }


        console.log(
            '✅ Asiye Driver V2 ready'
        );


    } catch (error) {

        console.error(
            '❌ Driver initialization failed:',
            error
        );


        ASIYE_DRIVER.ui.toast(
            error.message ||
            'Could not load driver profile.',
            'danger'
        );


        ASIYE_DRIVER.ui
            .showDriverLoginRequired();
    }
};


/* ============================================================
   GLOBAL UI EVENTS
   ============================================================ */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        /* Menu */

        document
            .getElementById(
                'driverMenuButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.ui
                        .openMenu();
                }
            );


        document
            .getElementById(
                'closeDriverMenu'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.ui
                        .closeMenu();
                }
            );


        document
            .getElementById(
                'driverMenuBackdrop'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.ui
                        .closeMenu();
                }
            );


        /* Incoming Request */

        document
            .getElementById(
                'acceptRequestButton'
            )
            ?.addEventListener(
                'click',
                async event => {

                    const button =
                        event.currentTarget;


                    button.disabled =
                        true;


                    button.innerHTML = `

                        <i
                            class="
                                fas
                                fa-circle-notch
                                fa-spin
                            "
                        ></i>

                        Accepting...

                    `;


                    try {

                        await ASIYE_DRIVER.requests
                            .accept();


                        ASIYE_DRIVER.ui
                            .closeIncomingRequest();


                    } catch (error) {

                        console.error(
                            'Accept failed:',
                            error
                        );


                        ASIYE_DRIVER.ui.toast(
                            error.message ||
                            'Could not accept booking.',
                            'danger'
                        );


                        button.disabled =
                            false;


                        button.textContent =
                            'Accept';
                    }
                }
            );


        document
            .getElementById(
                'declineRequestButton'
            )
            ?.addEventListener(
                'click',
                async () => {

                    await ASIYE_DRIVER.requests
                        .decline();


                    ASIYE_DRIVER.ui
                        .closeIncomingRequest();
                }
            );


        /* PIN */

        document
            .getElementById(
                'verifyDriverPinButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.ui
                        .verifyPin();
                }
            );


        document
            .getElementById(
                'closeDriverPin'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.ui
                        .closePassengerPin();
                }
            );


        document
            .getElementById(
                'driverPinInput'
            )
            ?.addEventListener(
                'keydown',
                event => {

                    if (
                        event.key ===
                        'Enter'
                    ) {

                        ASIYE_DRIVER.ui
                            .verifyPin();
                    }
                }
            );


        /* Club passengers */

        document
            .getElementById(
                'closeClubPassengers'
            )
            ?.addEventListener(
                'click',
                () => {

                    document
                        .getElementById(
                            'clubPassengerOverlay'
                        )
                        ?.classList
                        .remove(
                            'open'
                        );
                }
            );


        /* Confirmation */

        document
            .getElementById(
                'driverConfirmCancel'
            )
            ?.addEventListener(
                'click',
                () => {

                    document
                        .getElementById(
                            'driverConfirmOverlay'
                        )
                        ?.classList
                        .remove(
                            'open'
                        );
                }
            );


        /* Completed */

        document
            .getElementById(
                'driverCompletedDone'
            )
            ?.addEventListener(
                'click',
                async () => {

                    document
                        .getElementById(
                            'driverCompletedOverlay'
                        )
                        ?.classList
                        .remove(
                            'open'
                        );


                    await ASIYE_DRIVER.trip
                        .releaseDriver();


                    ASIYE_DRIVER.ui
                        .showDashboard();
                }
            );


        /* Map controls */

        document
            .getElementById(
                'driverRecenterButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    ASIYE_DRIVER.map
                        ?.centerDriver?.();
                }
            );


        document
            .getElementById(
                'driverNavigationButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    const nav =
                        ASIYE_DRIVER.state
                            .navigation;


                    if (
                        !nav.active
                    ) {

                        ASIYE_DRIVER.ui.toast(
                            'No active navigation.'
                        );

                        return;
                    }


                    ASIYE_DRIVER.map
                        ?.fitCurrentRoute?.();
                }
            );


        /* Side pages */

        document
            .querySelectorAll(
                '[data-driver-page]'
            )
            .forEach(
                button => {

                    button.addEventListener(
                        'click',
                        () => {

                            const page =

                                button.dataset
                                    .driverPage;


                            ASIYE_DRIVER.ui
                                .closeMenu();


                            if (
                                page ===
                                'dashboard'
                            ) {

                                ASIYE_DRIVER.ui
                                    .showDashboard();

                                return;
                            }


                            ASIYE_DRIVER.ui.toast(
                                `${page} is coming next.`
                            );
                        }
                    );
                }
            );


        /*
         * Connection status.
         */

        const connectionBanner =
            document.getElementById(
                'driverConnectionBanner'
            );


        window.addEventListener(
            'offline',
            () => {

                connectionBanner
                    ?.classList
                    .add(
                        'show'
                    );
            }
        );


        window.addEventListener(
            'online',
            () => {

                connectionBanner
                    ?.classList
                    .remove(
                        'show'
                    );
            }
        );


        /*
         * Initialize driver app.
         */

        ASIYE_DRIVER.initialize();
    }
);
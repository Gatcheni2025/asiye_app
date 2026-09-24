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

                    <i class="fas ${isDelivery ? 'fa-box' : 'fa-car-side'}"></i>

                </div>


                <div class="driver-kicker">

                    Asiye Driver

                </div>


                <h2
                    class="driver-title"
                    style="margin-top:5px;"
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

                    Sign in with your registered
                    Asiye driver account to continue.

                </p>


                <button
                    id="driverLoginButton"
                    class="
                        driver-btn
                        driver-btn-primary
                        driver-btn-full
                    "
                    style="margin-top:17px;"
                >

                    <i class="fas fa-right-to-bracket"></i>

                    Sign in

                </button>


                <button
                    id="retryDriverSession"
                    class="
                        driver-btn
                        driver-btn-secondary
                        driver-btn-full
                    "
                    style="margin-top:9px;"
                >

                    <i class="fas fa-rotate-right"></i>

                    Retry driver session

                </button>

            </div>

        `;


        document
            .getElementById(
                'driverLoginButton'
            )
            ?.addEventListener(
                'click',
                () => {

                    window.location.href =
                        './login.html';
                }
            );


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


        const ratingInfo =
            ASIYE_DRIVER.metrics
                ?.rating?.(
                    driver
                ) || {
                    count: 0,
                    value: null
                };


        const ratingDisplay =
            Number.isFinite(
                ratingInfo.value
            )
                ? Number(
                    ratingInfo.value
                ).toFixed(1)
                : 'New';


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
                        ${ratingDisplay}
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


    hasApprovedVehicle(
        driver =
            ASIYE_DRIVER.state.driver ||
            {}
    ) {

        const vehicle =
            driver.vehicle ||
            {};


        const type =
            vehicle.type ||
            driver.vehicleType ||
            driver.carCategory;


        const make =
            vehicle.make ||
            driver.vehicleMake ||
            driver.make;


        const model =
            vehicle.model ||
            driver.vehicleModel ||
            driver.model;


        const colour =
            vehicle.colour ||
            vehicle.color ||
            driver.vehicleColor ||
            driver.color;


        const seats =
            Number(
                vehicle.seats ||
                driver.vehicleSeats ||
                driver.seats ||
                0
            );


        const registration =
            vehicle.registration ||
            driver.vehicleReg ||
            driver.taxiRegistrationNumber ||
            driver.registration ||
            driver.registrationNumber;


        const year =
            Number(
                vehicle.year ||
                driver.vehicleYear ||
                driver.year ||
                0
            );


        const phone =
            driver.phone ||
            driver.phoneNumber ||
            '';


        const profileImage =
            driver.profileImageUrl ||
            driver.profile_picture_url ||
            driver.profilePhotoUrl ||
            '';


        const vehiclePhoto =
            driver.vehiclePhoto ||
            driver.carPhoto ||
            driver.documents?.carUrl ||
            '';


        const approved =
            driver.vehicleApproved ===
                true ||
            String(
                driver.vehicleApprovalStatus ||
                ''
            ).toLowerCase() ===
                'approved';


        return Boolean(
            approved &&
            type &&
            make &&
            model &&
            colour &&
            registration &&
            Number.isInteger(year) &&
            year >= 1990 &&
            phone &&
            profileImage &&
            vehiclePhoto &&
            Number.isInteger(seats) &&
            seats > 0
        );
    },


    /* ========================================================
       ONLINE / OFFLINE
       ======================================================== */

    async toggleOnline() {

        if (!await AsiyeEnrollment.requireApproval()) return;

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


        if (
            newOnline &&
            !this.hasApprovedVehicle()
        ) {
            this.toast(
                'Complete your approved driver profile first: selfie, car photo, phone, make, model, colour, year, registration and seats are required before you can go online.',
                'warning'
            );

            AsiyePages
                ?.open?.(
                    'vehicle'
                );

            return;
        }


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


        const isDelivery =
            request.type ===
            'delivery';


        typeBadge.textContent =

            isClub

            ? (
                request.clubMode ===
                'club7'

                ? 'ASIYE WORK 7'

                : 'ASIYE WORK 4'
            )

            : isDelivery
                ? 'ASIYE DELIVERY'
                : 'ASIYE GO';


        typeBadge.classList.toggle(
            'club',
            isClub
        );


        const fare =

            isClub

            ? Number(
                request.driverGrossFare ||
                request.totalPoolFare ||
                (
                    Number(request.pricePerPassenger || 0) *
                    Number(request.capacity || request.maxCapacity || 1)
                ) ||
                0
            )

            : Number(
                request.agreedFare ||
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
                    ? 5
                    : 3
                )
            )

            : 1;


        content.innerHTML = `

            <h2 class="driver-request-heading">

                ${
                    isClub
                    ? 'New Asiye Work request'
                    : isDelivery
                        ? 'New delivery request'
                        : 'New ride request'
                }

            </h2>


            <div class="driver-request-passenger">

                ${
                    isClub

                    ? `${passengerCount} of ${capacity} passengers confirmed`

                    : this.escape(
                        isDelivery
                            ? (
                                request.recipientName
                                    ? `Parcel for ${request.recipientName}`
                                    : 'Parcel delivery'
                            )
                            : (
                                request.commuterName ||
                                'Passenger'
                            )
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
                        : isDelivery
                            ? 'Delivery fare'
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


        const isDelivery =
            request.type ===
            'delivery';


        const passengerName =
            request.commuterName ||
            'Passenger';


        const passengerPhoto =
            request.commuterProfileImageUrl ||
            request.passengerProfileImageUrl ||
            '';


        container.innerHTML = `

            <div class="driver-trip-header">

                <div>

                    <div class="driver-kicker">
                        ${isDelivery
                            ? 'Asiye Delivery'
                            : 'Asiye Go'}
                    </div>

                    <h2 class="driver-title">
                        ${isDelivery
                            ? 'Delivery accepted'
                            : 'Ride accepted'}
                    </h2>

                    <div class="driver-subtitle">

                        ${
                            this.escape(
                                isDelivery
                                    ? (
                                        request.recipientName
                                            ? `Delivering to ${request.recipientName}`
                                            : 'Parcel delivery'
                                    )
                                    : (
                                        request.commuterName ||
                                        'Passenger'
                                    )
                            )
                        }

                    </div>

                </div>


                <div class="driver-trip-status-icon">

                    <i class="fas fa-car-side"></i>

                </div>

            </div>


            ${
                !isDelivery
                ? `
                    <div class="navigator-passenger driver-passenger-identity">
                        <div class="navigator-avatar">
                            ${
                                passengerPhoto
                                    ? `<img src="${this.escape(passengerPhoto)}" alt="${this.escape(passengerName)}">`
                                    : this.escape(
                                        passengerName
                                            .charAt(0)
                                            .toUpperCase()
                                    )
                            }
                        </div>

                        <div>
                            <small>PASSENGER</small>
                            <strong>${this.escape(passengerName)}</strong>
                        </div>
                    </div>
                `
                : ''
            }

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
                                request.agreedFare ||
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

                    ${isDelivery
                        ? 'Collect parcel'
                        : 'Start pickup'}

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
                            capacity >= 5
                            ? 'Asiye Work 7'
                            : 'Asiye Work 4'
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
                        until the Asiye Work group is full.
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
                            capacity >= 5
                            ? 'Asiye Work 7'
                            : 'Asiye Work 4'
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


        const passengerName =
            passenger.name ||
            passenger.commuterName ||
            'Passenger';


        const passengerPhoto =
            passenger.profileImageUrl ||
            passenger.profile_picture_url ||
            passenger.profilePhotoUrl ||
            '';


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


            <div class="navigator-passenger driver-passenger-identity">
                <div class="navigator-avatar">
                    ${
                        passengerPhoto
                            ? `<img src="${this.escape(passengerPhoto)}" alt="${this.escape(passengerName)}">`
                            : this.escape(
                                passengerName
                                    .charAt(0)
                                    .toUpperCase()
                            )
                    }
                </div>

                <div>
                    <small>PASSENGER</small>
                    <strong>${this.escape(passengerName)}</strong>
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
        request,
        target = null,
        route = null
    ) {

        this.openActiveTripSheet();


        const container =
            document.getElementById(
                'activeTripContent'
            );


        if (!container) return;


        const isDelivery =
            request.type ===
            'delivery';


        const pickupLabel =
            target?.label ||
            request.pickupAddress ||
            (
                isDelivery
                    ? 'Parcel pickup'
                    : 'Passenger pickup'
            );


        container.innerHTML = `

            <div class="navigation-phase-label">
                <span>
                    <i class="fas fa-location-dot"></i>
                    ${isDelivery ? 'DRIVE TO SENDER' : 'DRIVE TO PASSENGER'}
                </span>
                <strong>${this.escape(pickupLabel)}</strong>
            </div>

            <div class="navigation-live-hud">
                <section class="turn-guidance">
                    <div id="navArrow" class="turn-guidance-arrow">↑</div>
                    <div class="turn-guidance-copy">
                        <strong id="navTurnDistance">
                            ${Number.isFinite(Number(route?.distanceKm))
                                ? `${Number(route.distanceKm).toFixed(1)} km`
                                : 'Finding route'}
                        </strong>
                        <h2 id="navInstruction">Preparing pickup navigation…</h2>
                        <p id="navRoadName" class="nav-road-name"></p>
                    </div>
                </section>

                <div class="navigation-driving-status">
                    <div id="navCurrentSpeedPanel" class="nav-speed-current">
                        <small>SPEED</small>
                        <strong id="navCurrentSpeed">0</strong>
                        <span>km/h</span>
                    </div>

                    <div class="nav-speed-limit-wrap">
                        <small>LIMIT</small>
                        <div class="nav-speed-limit-sign">
                            <strong id="navSpeedLimit">—</strong>
                        </div>
                    </div>

                    <button
                        id="navVoiceToggle"
                        class="nav-voice-toggle"
                        type="button"
                        aria-pressed="true"
                    >
                        <i class="fas fa-volume-high"></i>
                        <span id="navVoiceLabel">Voice on</span>
                    </button>
                </div>

                <div
                    id="navTrafficAlert"
                    class="navigation-traffic-alert"
                    hidden
                >
                    <i class="fas fa-triangle-exclamation"></i>
                    <span id="navTrafficAlertText">Traffic alert</span>
                </div>
            </div>

            <div class="navigation-summary">
                <strong id="navEta">
                    ${Number.isFinite(Number(route?.durationMinutes))
                        ? `${Math.max(1, Math.round(Number(route.durationMinutes)))} min`
                        : '—'}
                </strong>
                <span id="navDistance">
                    ${Number.isFinite(Number(route?.distanceKm))
                        ? `${Number(route.distanceKm).toFixed(1)} km`
                        : '—'}
                </span>
                <span>Arrival <b id="navArrival">—</b></span>
            </div>

            <p class="navigation-destination">
                <i class="fas fa-location-dot"></i>
                ${this.escape(pickupLabel)}
            </p>

            <div class="navigation-controls">
                <button id="navFollow" class="driver-btn">
                    <i class="fas fa-location-arrow"></i>
                    Follow car
                </button>

                <button id="navRetry" class="driver-btn">
                    <i class="fas fa-rotate-right"></i>
                    Retry route
                </button>
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


        setTimeout(
            () => {
                ASIYE_DRIVER.map
                    ?.resize?.();
            },
            120
        );
    },


    /* ========================================================
       NAVIGATOR
       ======================================================== */

    renderNavigator(
        target,
        request,
        route = null
    ) {

        const container =

            document.getElementById(
                'sheetContent'
            );


        if (!container) {

            return;
        }


        const distance =

            route?.distanceKm ??

            ASIYE_DRIVER.state
                ?.navigation
                ?.distanceKm ??
            null;


        const duration =

            route?.durationMinutes ??

            ASIYE_DRIVER.state
                ?.navigation
                ?.durationMinutes ??
            null;


        const currentPassenger =

            request.passengers
                ?.[target.id] ||
            {};


        const passengerName =

            currentPassenger.name ||
            currentPassenger.commuterName ||
            request.commuterName ||
            'Passenger';


        const passengerPhoto =

            currentPassenger.profileImageUrl ||
            currentPassenger.profile_picture_url ||
            request.commuterProfileImageUrl ||
            request.passengerProfileImageUrl ||
            '';


        container.innerHTML = `

            <div class="driver-navigation-card">

                <div class="navigator-top">

                    <div class="navigator-turn-icon">

                        <i class="fas fa-location-arrow"></i>

                    </div>


                    <div class="navigator-heading">

                        <small>
                            PICKUP
                        </small>

                        <strong>
                            ${this.escape(
                                target.label ||
                                'Passenger'
                            )}
                        </strong>

                    </div>

                </div>


                <div class="navigator-stats">

                    <div>

                        <span>
                            Distance
                        </span>

                        <strong>

                            ${
                                Number.isFinite(
                                    Number(distance)
                                )

                                ? `${Number(distance).toFixed(1)} km`

                                : '—'
                            }

                        </strong>

                    </div>


                    <div>

                        <span>
                            ETA
                        </span>

                        <strong>

                            ${
                                Number.isFinite(
                                    Number(duration)
                                )

                                ? `${Math.max(
                                    1,
                                    Math.round(
                                        Number(duration)
                                    )
                                )} min`

                                : '—'
                            }

                        </strong>

                    </div>

                </div>


                <div class="navigator-passenger">

                    <div class="navigator-avatar">

                        ${
                            passengerPhoto
                                ? `<img src="${this.escape(passengerPhoto)}" alt="${this.escape(passengerName)}">`
                                : this.escape(
                                    passengerName
                                        .charAt(0)
                                        .toUpperCase()
                                )
                        }

                    </div>


                    <div>

                        <small>
                            PASSENGER
                        </small>

                        <strong>

                            ${this.escape(
                                passengerName
                            )}

                        </strong>

                    </div>

                </div>


                <button
                    id="openExternalNavigator"
                    class="secondary-button"
                >

                    <i class="fas fa-route"></i>

                    Open full navigation

                </button>


                <button
                    id="driverArrivedButton"
                    class="primary-button"
                >

                    <i class="fas fa-location-dot"></i>

                    I've arrived

                </button>

            </div>

        `;


        /*
         * External navigation.
         */

        document
            .getElementById(
                'openExternalNavigator'
            )
            ?.addEventListener(
                'click',
                () => {

                    const url =

                        `https://www.google.com/maps/dir/?api=1` +

                        `&destination=${encodeURIComponent(
                            target.latitude +
                            ',' +
                            target.longitude
                        )}` +

                        `&travelmode=driving`;


                    window.open(
                        url,
                        '_blank'
                    );
                }
            );


        /*
         * Driver arrived.
         */

        document
            .getElementById(
                'driverArrivedButton'
            )
            ?.addEventListener(
                'click',
                async () => {

                    if (
                        ASIYE_DRIVER.trip &&
                        typeof ASIYE_DRIVER.trip
                            .markArrived ===
                            'function'
                    ) {

                        await ASIYE_DRIVER.trip
                            .markArrived();
                    }
                }
            );


        /*
         * Make sure map displays route.
         */

        setTimeout(
            () => {

                ASIYE_DRIVER.map
                    ?.resize?.();

                ASIYE_DRIVER.map
                    ?.fitCurrentRoute?.();

            },
            150
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

            <div class="navigation-live-hud">
                <section class="turn-guidance">
                    <div id="navArrow" class="turn-guidance-arrow">↑</div>
                    <div class="turn-guidance-copy">
                        <strong id="navTurnDistance">Trip underway</strong>
                        <h2 id="navInstruction">Finding your route…</h2>
                        <p id="navRoadName" class="nav-road-name"></p>
                    </div>
                </section>

                <div class="navigation-driving-status">
                    <div id="navCurrentSpeedPanel" class="nav-speed-current">
                        <small>SPEED</small>
                        <strong id="navCurrentSpeed">0</strong>
                        <span>km/h</span>
                    </div>

                    <div class="nav-speed-limit-wrap">
                        <small>LIMIT</small>
                        <div class="nav-speed-limit-sign">
                            <strong id="navSpeedLimit">—</strong>
                        </div>
                    </div>

                    <button
                        id="navVoiceToggle"
                        class="nav-voice-toggle"
                        type="button"
                        aria-pressed="true"
                    >
                        <i class="fas fa-volume-high"></i>
                        <span id="navVoiceLabel">Voice on</span>
                    </button>
                </div>

                <div
                    id="navTrafficAlert"
                    class="navigation-traffic-alert"
                    hidden
                >
                    <i class="fas fa-triangle-exclamation"></i>
                    <span id="navTrafficAlertText">Traffic alert</span>
                </div>
            </div>

            <div class="navigation-summary">
                <strong id="navEta">—</strong>
                <span id="navDistance">—</span>
                <span>Arrival <b id="navArrival">—</b></span>
            </div>

            <p class="navigation-destination">
                <i class="fas fa-location-dot"></i>
                ${this.escape(request.destinationName || request.destination || 'Destination')}
            </p>

            <div class="navigation-controls">
                <button id="navFollow" class="driver-btn">
                    <i class="fas fa-location-arrow"></i>
                    Follow car
                </button>
                <button id="navRetry" class="driver-btn">
                    <i class="fas fa-rotate-right"></i>
                    Retry route
                </button>
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

                    ${request.type === 'delivery'
                        ? 'Complete delivery'
                        : 'Complete trip'}

                </button>

            </div>
        `;


        ASIYE_DRIVER.navigator?.start(request);

        document
            .getElementById(
                'driverCompleteTrip'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.confirm(

                        request.type === 'delivery'
                            ? 'Complete delivery'
                            : 'Complete trip',

                        request.type === 'delivery'
                            ? 'Confirm that the parcel has reached the recipient.'
                            : 'Confirm that you have reached the destination.',

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

        ASIYE_DRIVER.navigator?.stop();

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
                    request.agreedFare ||
                    request.pricePerPassenger ||
                    0
                ) *
                count;

        } else {

            amount =

                Number(
                    request.agreedFare ||
                    request.finalAmount ||
                    request.calculatedPrice ||
                    0
                );
        }


        const grossFare =
            Number(
                request.driverGrossFare ||
                amount ||
                0
            );

        const commission =
            Number(
                request.platformCommission ||
                (grossFare * 0.20)
            );

        const netFare =
            Number(
                request.driverNetFare ||
                (grossFare - commission)
            );


        if (fareElement) {

            fareElement.textContent =
                `R${netFare.toFixed(2)}`;
        }


        if (details) {
            if (
                request.type ===
                'delivery'
            ) {
                details.innerHTML =
                    '<p>Delivery completed · ' +
                    ASIYE_DRIVER.ui.escape(
                        request.paymentMethod ||
                        'cash'
                    ) +
                    ' payment</p>' +
                    '<p style="margin-top:10px;">Gross R' +
                    grossFare.toFixed(2) +
                    ' · Asiye commission 20% R' +
                    commission.toFixed(2) +
                    ' · You receive R' +
                    netFare.toFixed(2) +
                    '</p>';

                overlay.classList.add(
                    'open'
                );

                return;
            }

            const passengers = request.type === 'club'
                ? Object.entries(request.passengers || {})
                    .filter(([, passenger]) => !String(passenger.status || '').includes('cancelled'))
                    .map(([id, passenger]) => ({ id, name: passenger.name || passenger.commuterName || 'Passenger' }))
                : [{ id: request.commuterId, name: request.commuterName || 'Passenger' }];
            const unrated = passengers.filter(passenger =>
                passenger.id && !request.ratings?.driverToPassenger?.[passenger.id]
            );

            details.innerHTML = `
                <p>${request.type === 'club' ? 'Asiye Work trip completed' : ASIYE_DRIVER.ui.escape(request.paymentMethod || 'cash') + ' payment'}</p>
                <p style="margin-top:10px;">Gross R${grossFare.toFixed(2)} · Asiye commission 20% R${commission.toFixed(2)} · You receive R${netFare.toFixed(2)}</p>
                ${unrated.length ? `
                    <section style="margin-top:16px;">
                        <strong>Rate your passenger</strong>
                        ${unrated.length > 1 ? `<select id="ratingPassengerId" style="width:100%;margin:10px 0;padding:11px;border-radius:10px;"><option value="">Choose passenger</option>${unrated.map(item => `<option value="${ASIYE_DRIVER.ui.escape(item.id)}">${ASIYE_DRIVER.ui.escape(item.name)}</option>`).join('')}</select>` : ''}
                        <div data-passenger-rating-stars style="display:flex;justify-content:center;gap:7px;margin:10px 0;">
                            ${[1,2,3,4,5].map(value => `<button type="button" data-passenger-rating="${value}" style="border:0;background:none;color:#c8c8c8;font-size:28px;">★</button>`).join('')}
                        </div>
                        <button type="button" id="submitPassengerRating" class="driver-btn driver-btn-primary driver-btn-full" disabled>Submit rating</button>
                    </section>` : '<p style="margin-top:12px;font-weight:800;">Passenger rating submitted.</p>'}
            `;

            let selectedRating = 0;
            details.querySelectorAll('[data-passenger-rating]').forEach(star => {
                star.onclick = () => {
                    selectedRating = Number(star.dataset.passengerRating);
                    details.querySelectorAll('[data-passenger-rating]').forEach(item => {
                        item.style.color = Number(item.dataset.passengerRating) <= selectedRating
                            ? '#f5b301' : '#c8c8c8';
                    });
                    const submit = details.querySelector('#submitPassengerRating');
                    if (submit) submit.disabled = false;
                };
            });
            details.querySelector('#submitPassengerRating')?.addEventListener('click', async event => {
                const passengerId = details.querySelector('#ratingPassengerId')?.value || unrated[0]?.id;
                if (!passengerId) return this.toast('Choose a passenger first.', 'warning');
                event.currentTarget.disabled = true;
                event.currentTarget.textContent = 'Saving…';
                try {
                    await ASIYE_DRIVER.trip.submitPassengerRating(passengerId, selectedRating);
                    event.currentTarget.textContent = 'Rating submitted';
                    this.toast('Passenger rating saved.', 'success');
                } catch {
                    event.currentTarget.disabled = false;
                    event.currentTarget.textContent = 'Submit rating';
                    this.toast('Could not save the rating.', 'danger');
                }
            });
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


        const approvedVehicle =
            driver.vehicle ||
            {};


        const vehicle =

            [
                approvedVehicle.make ||
                driver.vehicleMake ||
                driver.make,

                approvedVehicle.model ||
                driver.vehicleModel ||
                driver.model,

                approvedVehicle.registration ||
                driver.vehicleReg ||
                driver.taxiRegistrationNumber ||
                driver.registration ||
                driver.registrationNumber
            ]
            .filter(Boolean)
            .join(' ');


        const profileUrl =

            driver.profile_picture_url ||
            driver.profileImageUrl ||
            driver.photoURL ||
            '';


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


        const renderAvatar =
            target => {

                if (!target) return;

                if (profileUrl) {
                    target.replaceChildren();

                    const image =
                        document.createElement(
                            'img'
                        );

                    image.src =
                        profileUrl;

                    image.alt =
                        'Driver profile picture';

                    image.referrerPolicy =
                        'no-referrer';

                    target.appendChild(
                        image
                    );

                    return;
                }

                target.textContent =
                    initial;
            };


        renderAvatar(
            profileInitial
        );


        renderAvatar(
            menuAvatar
        );


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


    /*
     * If the profile is keyed by a legacy driver ID, resolve it using the
     * authenticated identity and persist the canonical driverId locally.
     */
    if (
        authUser?.uid &&
        window.AsiyeEnrollment?.resolveDriverProfile
    ) {
        try {
            const linked =
                await AsiyeEnrollment.resolveDriverProfile(authUser);

            if (linked) {
                localStorage.setItem('driverId', linked.id);
                localStorage.setItem('userId', linked.id);
                localStorage.setItem('authUid', authUser.uid);
                localStorage.setItem('userType', 'driver');

                return {
                    uid: linked.id,
                    data: linked.data,
                    source: 'linked-auth-profile'
                };
            }
        } catch (error) {
            console.warn(
                'Could not resolve linked driver profile:',
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

        if (!await AsiyeEnrollment.requireApproval(driver)) return;


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
         * One-time safety setup.
         * A verified driver must save one trusted family member
         * before going online or receiving bookings.
         */
        if (
            window.AsiyeSafetyContact &&
            !await AsiyeSafetyContact.ensure({
                role: 'driver'
            })
        ) {
            return;
        }


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


        /*
         * Rebuild trip/earnings counters from completed requests.
         * This also repairs older trips that were never counted.
         */
        await ASIYE_DRIVER.metrics
            ?.refresh?.(
                driverId
            );


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


        const signalReady = () => {
            window.AsiyeNativeBridge
                ?.notify?.(
                    'hidePreloader'
                );
        };


        setTimeout(
            signalReady,
            6000
        );


        if (
            ASIYE_DRIVER.map?.instance?.loaded?.()
        ) {
            requestAnimationFrame(
                () => requestAnimationFrame(
                    signalReady
                )
            );
        } else if (
            ASIYE_DRIVER.map?.instance?.once
        ) {
            ASIYE_DRIVER.map.instance.once(
                'load',
                () => requestAnimationFrame(
                    () => requestAnimationFrame(
                        signalReady
                    )
                )
            );
        } else {
            signalReady();
        }


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

                    ASIYE_DRIVER.navigator
                        ?.toggleNavigationMode?.();
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


                            AsiyePages.open(page);
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

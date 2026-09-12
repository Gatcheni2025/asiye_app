/* ============================================================
   ASIYE PASSENGER V2
   RIDE CONTROLLER
   ============================================================ */

window.ASIYE =
    window.ASIYE || {};

ASIYE.ride = {

    requestId:
        null,

    requestRef:
        null,

    requestListener:
        null,

    driverRef:
        null,

    driverListener:
        null,

    currentDriverId:
        null,


    /* ========================================================
       START

       Begins the single unified listener for this ride.
       All subsequent state transitions flow through
       handleRequest().
       ======================================================== */

    async start(requestId) {

        if (!requestId) {

            throw new Error(
                'Missing request ID.'
            );
        }


        this.stop();


        this.requestId =
            requestId;


        ASIYE.state.booking.requestId =
            requestId;


        localStorage.setItem(
            'currentRequestId',
            requestId
        );


        this.requestRef =

            firebase
                .database()
                .ref(
                    `requests/${requestId}`
                );


        this.requestListener =

            this.requestRef.on(
                'value',
                snapshot => {

                    const request =
                        snapshot.val();


                    if (!request) {

                        return;
                    }


                    request.requestId =
                        requestId;


                    ASIYE.state.booking.request =
                        request;


                    this.handleRequest(
                        request
                    );
                }
            );


        console.log(
            '✅ Passenger ride listener started:',
            requestId
        );
    },


    /* ========================================================
       STOP
       ======================================================== */

    stop() {

        if (
            this.requestRef &&
            this.requestListener
        ) {

            this.requestRef.off(
                'value',
                this.requestListener
            );
        }


        this.requestRef =
            null;


        this.requestListener =
            null;


        this.stopDriver();
    },


    /* ========================================================
       HANDLE REQUEST
       ======================================================== */

    handleRequest(request) {

        let status =
            request.status ||
            'pending';


        /*
         * Club passengers have individual pickup states.
         *
         * The global Club request can be collecting passengers,
         * while only one passenger is actually being collected.
         */

        if (
            request.type === 'club' &&
            request.passengers &&
            ASIYE.state.userId &&
            request.passengers[
                ASIYE.state.userId
            ]
        ) {

            const passenger =

                request.passengers[
                    ASIYE.state.userId
                ];


            const personalStatus =
                passenger.status ||
                'waiting_pool';


            if (
                [
                    'driver_on_way',
                    'arrived',
                    'passenger_onboard',
                    'in_transit',
                    'completed',
                    'cancelled_by_commuter'
                ].includes(
                    personalStatus
                )
            ) {

                status =
                    personalStatus;

            } else if (
                request.status ===
                    'collecting_passengers'
            ) {

                status =
                    'club_waiting_pickup';
            }
        }


        switch (status) {


            case 'pending':

            case 'searching':

                this.renderGoSearching(
                    request
                );

                break;


            case 'pooling':

            case 'waiting_members':

                ASIYE.ui
                    .renderClubWaiting(
                        request
                    );

                break;


            case 'pool_ready':

                this.renderPoolReady(
                    request
                );

                break;


            case 'driver_waiting':

                /*
                 * Club has a driver but is not
                 * yet full. Show the pool-building
                 * view so the passenger keeps
                 * seeing seat progress.
                 */

                ASIYE.ui
                    .renderClubWaiting(
                        request
                    );

                break;


            case 'accepted':

            case 'driver_waiting_driver':

                this.renderDriverAssigned(
                    request
                );

                break;


            case 'driver_on_way':

                this.renderDriverOnWay(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'club_waiting_pickup':

                this.renderClubWaitingPickup(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'collecting_passengers':

                /*
                 * Go passengers — treat the whole
                 * trip as "driver on way".
                 */

                this.renderDriverOnWay(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'arrived':

                this.renderArrived(
                    request
                );

                break;


            case 'passenger_onboard':

            case 'all_onboard':

            case 'in_transit':

                this.renderInTransit(
                    request
                );

                this.listenDriver(
                    request.taxiId
                );

                break;


            case 'completed':

                this.renderCompleted(
                    request
                );

                this.stopDriver();

                break;


            case 'cancelled_by_driver':

            case 'cancelled_by_admin':

            case 'rejected':

                this.renderCancelled(
                    request
                );

                break;


            case 'cancelled_by_commuter':

                this.stop();

                ASIYE.booking
                    ?.clearLocalRide?.();

                ASIYE.map
                    ?.clearTrip?.();

                ASIYE.ui
                    .renderHome();

                break;
        }
    },


    /* ========================================================
       GO SEARCHING
       ======================================================== */

    renderGoSearching(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) return;


        container.innerHTML = `

            <div class="asiye-row">

                <div class="
                    asiye-status-icon
                    asiye-search-icon
                ">
                    <i class="fas fa-car-side"></i>
                </div>

                <div>

                    <div class="home-kicker">
                        Asiye Go
                    </div>

                    <h2 class="sheet-page-title">
                        Finding your driver
                    </h2>

                    <div class="home-greeting">
                        Connecting you with nearby Asiye drivers.
                    </div>

                </div>

            </div>

            <div class="asiye-search-progress">
                <span></span>
            </div>

            <div class="asiye-route-summary">

                <div style="
                    color:#888;
                    font-size:9px;
                    font-weight:800;
                    text-transform:uppercase;
                ">
                    Destination
                </div>

                <strong style="
                    display:block;
                    margin-top:3px;
                    font-size:12px;
                ">
                    ${ASIYE.ui.escape(
                        request.destination
                    )}
                </strong>

            </div>

            <button
                id="cancelCurrentRideBtn"
                class="secondary-button"
                style="margin-top:12px;"
            >
                Cancel request
            </button>
        `;


        document
            .getElementById(
                'cancelCurrentRideBtn'
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
       POOL READY
       ======================================================== */

    renderPoolReady(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) return;


        container.innerHTML = `

            <div class="asiye-row">

                <div class="asiye-status-icon">
                    <i class="fas fa-users"></i>
                </div>

                <div>

                    <div class="home-kicker">
                        Asiye Club
                    </div>

                    <h2 class="sheet-page-title">
                        Your Club is ready
                    </h2>

                    <div class="home-greeting">
                        All ${
                            request.capacity ||
                            request.maxCapacity
                        } passengers are confirmed.
                        Finding your driver.
                    </div>

                </div>

            </div>

            <div class="asiye-search-progress">
                <span></span>
            </div>
        `;
    },


    /* ========================================================
       CLUB WAITING PICKUP

       The Club request has started collection but this
       particular passenger is not yet being picked up.
       ======================================================== */

    renderClubWaitingPickup(
        request
    ) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) {

            return;
        }


        const capacity =
            Number(
                request.capacity ||
                request.maxCapacity ||
                4
            );


        const onboardCount =

            Object.values(
                request.passengers ||
                {}
            )
            .filter(
                member =>

                    [
                        'passenger_onboard',
                        'in_transit',
                        'completed'
                    ]
                    .includes(
                        member.status
                    )
            )
            .length;


        container.innerHTML = `

            <div class="home-kicker">
                Asiye Club
            </div>


            <h2 class="home-title">
                Collection has started
            </h2>


            <div class="home-greeting">

                Your driver is collecting Club members.
                We'll notify you when you're next.

            </div>


            <div class="club-summary-grid">

                <div>

                    <span>
                        Collected
                    </span>

                    <strong>
                        ${onboardCount}/${capacity}
                    </strong>

                </div>


                <div>

                    <span>
                        Your status
                    </span>

                    <strong>
                        Waiting
                    </strong>

                </div>

            </div>


            <div class="club-driver-rule">

                <i class="fas fa-car-side"></i>

                <div>

                    <strong>
                        Driver is collecting passengers
                    </strong>

                    <p>
                        Keep your phone nearby.
                        You'll receive an update when
                        the driver starts heading to you.
                    </p>

                </div>

            </div>

        `;
    },


    /* ========================================================
       DRIVER ASSIGNED
       ======================================================== */

    renderDriverAssigned(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) return;


        const name =
            request.driverName ||
            'Your driver';


        const isClub =
            request.type === 'club';


        container.innerHTML = `

            <div class="home-kicker">
                ${
                    isClub
                    ? 'Asiye Club'
                    : 'Asiye Go'
                }
            </div>

            <h2 class="home-title">
                ${ASIYE.ui.escape(name)}
                accepted your ride
            </h2>

            <div class="home-greeting">

                ${
                    isClub

                    ?

                    'Your driver is assigned and waiting for the Club departure stage.'

                    :

                    'Your driver is preparing to come to you.'
                }

            </div>

            ${this.driverCard(request)}

        `;
    },


    /* ========================================================
       DRIVER ON WAY
       ======================================================== */

    renderDriverOnWay(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) return;


        const passenger =
            this.getPassengerData(
                request
            );


        const pin =
            passenger.pickupPin ||
            request.pickupPin ||
            '----';


        container.innerHTML = `

            <div class="asiye-between">

                <div>

                    <div class="home-kicker">
                        Driver on the way
                    </div>

                    <h2 class="sheet-page-title">
                        ${
                            ASIYE.ui.escape(
                                request.driverName ||
                                'Your driver'
                            )
                        } is coming
                    </h2>

                    <div
                        id="passengerDriverEta"
                        class="home-greeting"
                    >
                        Calculating arrival time...
                    </div>

                </div>

            </div>

            ${this.driverCard(request)}

            <div class="asiye-pin-card">

                <div class="asiye-pin-label">
                    Pickup PIN
                </div>

                <div class="asiye-pin-value">
                    ${ASIYE.ui.escape(pin)}
                </div>

            </div>

            <div class="asiye-actions">

                <button class="asiye-action-button">
                    <i class="fas fa-phone"></i>
                    Call
                </button>

                <button class="asiye-action-button">
                    <i class="fas fa-comment"></i>
                    Message
                </button>

                <button class="asiye-action-button">
                    <i class="fas fa-shield-halved"></i>
                    Safety
                </button>

            </div>
        `;
    },


    /* ========================================================
       ARRIVED
       ======================================================== */

    renderArrived(request) {

        const passenger =
            this.getPassengerData(
                request
            );


        const pin =
            passenger.pickupPin ||
            request.pickupPin ||
            '----';


        const container =
            document.getElementById(
                'sheetContent'
            );


        container.innerHTML = `

            <div class="home-kicker">
                Driver arrived
            </div>

            <h2 class="home-title">
                Your driver is here
            </h2>

            <div class="home-greeting">
                Meet the driver at your pickup point.
            </div>

            <div class="asiye-pin-card">

                <div class="asiye-pin-label">
                    Give driver this PIN
                </div>

                <div class="asiye-pin-value">
                    ${ASIYE.ui.escape(pin)}
                </div>

            </div>

        `;
    },


    /* ========================================================
       IN TRANSIT
       ======================================================== */

    renderInTransit(request) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        container.innerHTML = `

            <div class="asiye-between">

                <div>

                    <div class="home-kicker">
                        Trip underway
                    </div>

                    <h2 class="home-title">
                        On the way
                    </h2>

                    <div class="home-greeting">
                        ${
                            ASIYE.ui.escape(
                                request.destination
                            )
                        }
                    </div>

                </div>

                <div class="asiye-status-icon">
                    <i class="fas fa-route"></i>
                </div>

            </div>

            <div class="asiye-actions">

                <button class="asiye-action-button">
                    <i class="fas fa-shield-halved"></i>
                    Safety
                </button>

                <button class="asiye-action-button">
                    <i class="fas fa-share-nodes"></i>
                    Share
                </button>

                <button class="asiye-action-button">
                    <i class="fas fa-comment"></i>
                    Message
                </button>

            </div>
        `;
    },


    /* ========================================================
       COMPLETED
       ======================================================== */

    renderCompleted(request) {

        const passenger =
            this.getPassengerData(
                request
            );


        const amount =

            Number(

                passenger.finalAmount ||

                passenger.price ||

                request.finalAmount ||

                request.calculatedPrice ||

                request.pricePerPassenger ||

                0
            );


        const container =
            document.getElementById(
                'sheetContent'
            );


        container.innerHTML = `

            <div class="asiye-complete">

                <div class="asiye-complete-icon">
                    <i class="fas fa-check"></i>
                </div>

                <h2 class="home-title">
                    You've arrived
                </h2>

                <div class="home-greeting">
                    ${ASIYE.ui.escape(
                        request.destination
                    )}
                </div>

                <div class="asiye-complete-price">
                    R${amount.toFixed(2)}
                </div>

                <div class="asiye-payment-method">
                    ${
                        passenger.paymentMethod ||
                        request.paymentMethod ||
                        'cash'
                    }
                </div>

            </div>

            <button
                id="completeRideDone"
                class="primary-button"
                style="margin-top:16px;"
            >
                Done
            </button>

        `;


        document
            .getElementById(
                'completeRideDone'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.stop();

                    ASIYE.booking
                        ?.clearLocalRide?.();

                    ASIYE.map
                        ?.clearTrip?.();

                    ASIYE.ui
                        .renderHome();
                }
            );
    },


    /* ========================================================
       CANCELLED
       ======================================================== */

    renderCancelled() {

        this.stop();


        ASIYE.booking
            ?.clearLocalRide?.();


        ASIYE.map
            ?.clearTrip?.();


        ASIYE.ui.toast(
            'Your ride was cancelled.'
        );


        ASIYE.ui
            .renderHome();
    },


    /* ========================================================
       DRIVER CARD
       ======================================================== */

    driverCard(request) {

        return `

            <div class="asiye-driver-card">

                <div class="menu-avatar">

                    ${
                        ASIYE.ui.escape(
                            (
                                request.driverName ||
                                'D'
                            )
                            .charAt(0)
                        )
                    }

                </div>

                <div class="asiye-driver-data">

                    <div class="asiye-driver-name">
                        ${
                            ASIYE.ui.escape(
                                request.driverName ||
                                'Driver'
                            )
                        }
                    </div>

                    <div class="asiye-driver-details">
                        ★ ${
                            request.driverRating ||
                            '5.0'
                        }
                    </div>

                    ${
                        request.vehicleReg
                        ?
                        `
                        <div class="asiye-driver-plate">
                            ${
                                ASIYE.ui.escape(
                                    request.vehicleReg
                                )
                            }
                        </div>
                        `
                        :
                        ''
                    }

                </div>

            </div>
        `;
    },


    /* ========================================================
       PASSENGER DATA
       ======================================================== */

    getPassengerData(request) {

        if (
            request.type === 'club' &&
            request.passengers &&
            ASIYE.state.userId &&
            request.passengers[
                ASIYE.state.userId
            ]
        ) {

            return request.passengers[
                ASIYE.state.userId
            ];
        }


        return request;
    },


    /* ========================================================
       DRIVER LOCATION LISTENER
       ======================================================== */

    listenDriver(driverId) {

        if (!driverId) {

            return;
        }


        /*
         * Already listening to this driver.
         */

        if (
            this.driverRef &&
            this.currentDriverId ===
                driverId
        ) {

            return;
        }


        this.stopDriver();


        this.currentDriverId =
            driverId;


        this.driverRef =

            firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                );


        this.driverListener =

            this.driverRef.on(
                'value',
                snapshot => {

                    const driver =
                        snapshot.val();


                    if (!driver) {

                        return;
                    }


                    const lat =
                        Number(
                            driver.latitude
                        );


                    const lng =
                        Number(
                            driver.longitude
                        );


                    const heading =
                        Number(
                            driver.heading ||
                            0
                        );


                    if (
                        Number.isFinite(lat) &&
                        Number.isFinite(lng)
                    ) {

                        ASIYE.map
                            ?.showDriverLocation?.(

                                lat,

                                lng,

                                heading
                            );
                    }
                }
            );
    },


    stopDriver() {

        if (
            this.driverRef &&
            this.driverListener
        ) {

            this.driverRef.off(
                'value',
                this.driverListener
            );
        }


        this.driverRef =
            null;


        this.driverListener =
            null;


        this.currentDriverId =
            null;


        ASIYE.map
            ?.removeDriverMarker?.();
    },


    /* ========================================================
       RESTORE
       ======================================================== */

    async restore() {

        const requestId =

            localStorage.getItem(
                'currentRequestId'
            );


        if (!requestId) {

            return false;
        }


        const snap =

            await firebase
                .database()
                .ref(
                    `requests/${requestId}`
                )
                .once(
                    'value'
                );


        const request =
            snap.val();


        if (!request) {

            localStorage.removeItem(
                'currentRequestId'
            );

            return false;
        }


        const terminal = [

            'completed',
            'cancelled_by_driver',
            'cancelled_by_admin',
            'cancelled_by_commuter',
            'rejected'
        ];


        if (
            terminal.includes(
                request.status
            )
        ) {

            localStorage.removeItem(
                'currentRequestId'
            );

            return false;
        }


        await this.start(
            requestId
        );


        return true;
    }

};
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


            case 'driver_busy':

                this.renderDriverBusy(
                    request
                );

                if (
                    request.queuedTaxiId
                ) {

                    this.listenDriver(
                        request.queuedTaxiId
                    );
                }

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
       DRIVER BUSY

       Passenger is queued behind a driver who is still
       finishing another trip.
       ======================================================== */

    renderDriverBusy(
        request
    ) {

        const container =
            document.getElementById(
                'sheetContent'
            );


        if (!container) {

            return;
        }


        container.innerHTML = `

            <div class="asiye-row">

                <div
                    class="
                        asiye-status-icon
                        asiye-search-icon
                    "
                >

                    <i class="fas fa-car-side"></i>

                </div>


                <div>

                    <div class="home-kicker">

                        Asiye Go

                    </div>


                    <h2 class="sheet-page-title">

                        Your driver is completing another ride

                    </h2>


                    <div class="home-greeting">

                        You're in the queue.
                        The driver will receive your booking
                        as soon as the current trip is completed.

                    </div>

                </div>

            </div>


            <div class="asiye-search-progress">

                <span></span>

            </div>


            <div class="asiye-route-summary">

                <div
                    style="
                        font-size:9px;
                        color:#888;
                        font-weight:800;
                        text-transform:uppercase;
                    "
                >

                    Your destination

                </div>


                <strong
                    style="
                        display:block;
                        margin-top:4px;
                        font-size:12px;
                    "
                >

                    ${ASIYE.ui.escape(
                        request.destination ||
                        request.destinationName ||
                        'Destination'
                    )}

                </strong>

            </div>


            <div
                style="
                    margin-top:12px;
                    padding:13px;
                    border-radius:15px;
                    background:#f5f5f5;
                "
            >

                <div
                    style="
                        font-size:9px;
                        color:#888;
                        font-weight:800;
                        text-transform:uppercase;
                    "
                >

                    Booking status

                </div>


                <div
                    style="
                        margin-top:4px;
                        font-size:12px;
                        font-weight:900;
                        color:#111;
                    "
                >

                    <i
                        class="fas fa-clock"
                        style="margin-right:5px;"
                    ></i>

                    Driver finishing current trip

                </div>

            </div>


            <button
                id="cancelQueuedRide"
                class="secondary-button"
                style="margin-top:12px;"
            >

                Cancel booking

            </button>

        `;


        document
            .getElementById(
                'cancelQueuedRide'
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

    renderPickupCard(request, arrived) {
        const container = document.getElementById('sheetContent');
        if (!container) return;
        const escape = value => ASIYE.ui.escape(value);
        const passenger = this.getPassengerData(request);
        const pin = String(passenger.pickupPin ?? request.pickupPin ?? '----');
        const name = request.driverName || 'Your driver';
        const rating = Number(request.driverRating);
        const phone = String(request.driverPhone || '').replace(/[^\d+]/g, '');
        const icons = {
            call: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z"/>',
            message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 9h9M7 13h6"/>',
            safety: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>'
        };
        const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
        container.innerHTML = `
            <section class="pickup-card ${arrived ? 'pickup-card--arrived' : ''}">
                <header class="pickup-heading">
                    <span class="pickup-status"><span></span>${arrived ? 'Driver arrived' : 'Driver on the way'}</span>
                    <h2>${arrived ? 'Your driver is here' : `${escape(name)} is coming`}</h2>
                    <p ${arrived ? '' : 'id="passengerDriverEta"'}>${arrived ? 'Meet your driver at the pickup point.' : 'Your driver is heading to your pickup.'}</p>
                </header>
                <div class="pickup-progress" aria-hidden="true"><span></span><span></span><span></span></div>
                <div class="pickup-driver">
                    <div class="pickup-avatar" aria-hidden="true">${escape(name.charAt(0).toUpperCase())}</div>
                    <div class="pickup-driver-info"><strong>${escape(name)}</strong>
                        <span>${Number.isFinite(rating) && rating > 0 ? `<span class="pickup-star">★</span> ${rating.toFixed(1)} <span class="pickup-muted">· Driver</span>` : 'Your driver'}</span>
                    </div>
                    <div class="pickup-vehicle"><span>Vehicle plate</span><strong>${escape(request.vehicleReg || 'Not available')}</strong></div>
                </div>
                <div class="pickup-pin">
                    <div class="pickup-pin-heading"><span>${arrived ? 'Give your driver this PIN' : 'Your pickup PIN'}</span>${icon('safety')}</div>
                    <div class="pickup-pin-digits" aria-label="Pickup PIN ${escape(pin)}">${Array.from(pin).map(digit => `<span aria-hidden="true">${escape(digit)}</span>`).join('')}</div>
                    <p>${arrived ? 'Share when you are ready to start your ride.' : 'Share with your driver when they arrive.'}</p>
                </div>
                <div class="pickup-actions">
                    <button type="button" data-pickup-action="call">${icon('call')}<span>Call</span></button>
                    <button type="button" data-pickup-action="message">${icon('message')}<span>Message</span></button>
                    <button type="button" data-pickup-action="safety">${icon('safety')}<span>Safety</span></button>
                </div>
                <div class="pickup-action-feedback" role="status"></div>
            </section>`;
        container.querySelectorAll('[data-pickup-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.pickupAction;
                if (action === 'message') {
                    AsiyeTripChat.open(request, this.requestId);
                    return;
                }
                if (action === 'call') {
                    if (!phone || !/^\+?\d{7,15}$/.test(phone)) {
                        container.querySelector('.pickup-action-feedback').textContent = 'The driver’s contact number is not available yet.';
                        return;
                    }
                    window.location.href = `${action === 'call' ? 'tel' : 'sms'}:${phone}`;
                } else {
                    container.querySelector('.pickup-action-feedback').textContent = 'Check the vehicle plate before boarding. Share your pickup PIN only with your driver when you are ready to start.';
                }
            });
        });
        ASIYE.map?.resize();
    },

    renderDriverOnWay(request) {
        this.renderPickupCard(request, false);
    },

    /* ========================================================
       ARRIVED
       ======================================================== */

    renderArrived(request) {
        this.renderPickupCard(request, true);
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

            <div class="passenger-transit-card"><div class="asiye-between">

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

            <div class="asiye-actions transit-actions">

                <button class="asiye-action-button" id="transitSafety">
                    <i class="fas fa-shield-halved" aria-hidden="true"></i>
                    Safety
                </button>

                <button class="asiye-action-button" id="transitShare">
                    <i class="fas fa-share-nodes"></i>
                    Share
                </button>

                <button class="asiye-action-button" id="inTransitChat">
                    <i class="fas fa-comment"></i>
                    Message
                </button>

            </div>
            </div>
        `;
        document.getElementById('inTransitChat')?.addEventListener('click', () => AsiyeTripChat.open(request, this.requestId));
        document.getElementById('transitSafety')?.addEventListener('click', () => AsiyePages.open('safety'));
        document.getElementById('transitShare')?.addEventListener('click', async () => {
            const text = `I'm on an Asiye ride to ${request.destination || request.destinationName || 'my destination'}. Driver: ${request.driverName || 'Not available'}. Vehicle: ${request.vehicleReg || 'Not available'}.`;
            try {
                if (navigator.share) await navigator.share({ title: 'My Asiye trip', text });
                else { await navigator.clipboard.writeText(text); ASIYE.ui.toast('Trip details copied.'); }
            } catch (error) { if (error.name !== 'AbortError') ASIYE.ui.toast('Unable to share trip details.'); }
        });
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
                    <span>Payment method</span>
                    <strong>${ASIYE.ui.escape(passenger.paymentMethod || request.paymentMethod || 'cash')}</strong>
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

    listenDriver(
        driverId
    ) {

        if (!driverId) {

            return;
        }


        /*
         * Already listening to this driver.
         */

        if (
            this.currentDriverId ===
                driverId &&
            this.driverRef &&
            this.driverListener
        ) {

            return;
        }


        /*
         * Stop old driver listener.
         */

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


                    const latitude =

                        Number(
                            driver.latitude ??
                            driver.location?.latitude ??
                            driver.location?.lat
                        );


                    const longitude =

                        Number(
                            driver.longitude ??
                            driver.location?.longitude ??
                            driver.location?.lng
                        );


                    const heading =

                        Number(
                            driver.heading ??
                            driver.location?.heading ??
                            0
                        );


                    if (
                        !Number.isFinite(
                            latitude
                        ) ||
                        !Number.isFinite(
                            longitude
                        )
                    ) {

                        return;
                    }


                    ASIYE.map
                        ?.showDriverLocation?.(

                            latitude,

                            longitude,

                            heading
                        );
                }
            );
    },


    /* ========================================================
       STOP DRIVER LISTENER
       ======================================================== */

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

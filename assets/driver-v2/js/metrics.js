/* ============================================================
   ASIYE DRIVER V2
   DRIVER METRICS

   Rebuilds trip and earnings counters from completed requests so
   missed legacy increments do not leave the dashboard at zero.
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};

ASIYE_DRIVER.metrics = {

    dateKey(timestamp = Date.now()) {
        const date =
            new Date(
                Number(timestamp) ||
                Date.now()
            );

        const year =
            date.getFullYear();

        const month =
            String(
                date.getMonth() + 1
            ).padStart(2, '0');

        const day =
            String(
                date.getDate()
            ).padStart(2, '0');

        return `${year}-${month}-${day}`;
    },


    activeClubPassengers(request) {
        return Object.values(
            request?.passengers ||
            {}
        ).filter(
            passenger =>
                ![
                    'cancelled',
                    'cancelled_by_commuter',
                    'cancelled_by_driver',
                    'cancelled_by_admin',
                    'rejected'
                ].includes(
                    String(
                        passenger?.status ||
                        ''
                    )
                )
        ).length;
    },


    grossFare(request) {
        if (!request) return 0;

        if (
            request.type ===
            'club'
        ) {
            const totalPoolFare =
                Number(
                    request.totalPoolFare
                );

            if (
                Number.isFinite(
                    totalPoolFare
                ) &&
                totalPoolFare > 0
            ) {
                return totalPoolFare;
            }

            const perPassenger =
                Number(
                    request.pricePerPassenger ||
                    request.calculatedPrice ||
                    0
                );

            const passengers =
                this.activeClubPassengers(
                    request
                );

            return (
                Number.isFinite(
                    perPassenger
                )
                    ? perPassenger
                    : 0
            ) * passengers;
        }

        const amount =
            Number(
                request.finalAmount ??
                request.agreedFare ??
                request.calculatedPrice ??
                request.price ??
                0
            );

        return Number.isFinite(amount)
            ? amount
            : 0;
    },


    completionTime(request) {
        return Number(
            request?.completedAt ||
            request?.timestamp ||
            request?.createdAt ||
            0
        );
    },


    async refresh(
        driverId =
            ASIYE_DRIVER.state
                ?.driverId
    ) {
        if (!driverId) {
            return null;
        }

        try {
            const snapshot =
                await firebase
                    .database()
                    .ref('requests')
                    .orderByChild(
                        'taxiId'
                    )
                    .equalTo(
                        driverId
                    )
                    .once(
                        'value'
                    );

            const completed =
                [];

            snapshot.forEach(
                child => {
                    const request =
                        child.val() ||
                        {};

                    if (
                        request.status ===
                        'completed'
                    ) {
                        completed.push({
                            key:
                                child.key,
                            ...request
                        });
                    }
                }
            );

            const today =
                this.dateKey();

            let totalEarnings =
                0;

            let todayEarnings =
                0;

            let todayTrips =
                0;

            completed.forEach(
                request => {
                    const amount =
                        this.grossFare(
                            request
                        );

                    totalEarnings +=
                        amount;

                    if (
                        this.dateKey(
                            this.completionTime(
                                request
                            )
                        ) ===
                        today
                    ) {
                        todayTrips +=
                            1;

                        todayEarnings +=
                            amount;
                    }
                }
            );

            const metrics = {
                totalTrips:
                    completed.length,

                todayTrips,

                totalEarnings:
                    Math.round(
                        totalEarnings *
                        100
                    ) / 100,

                earnings:
                    Math.round(
                        totalEarnings *
                        100
                    ) / 100,

                todayEarnings:
                    Math.round(
                        todayEarnings *
                        100
                    ) / 100,

                dailyEarnings:
                    Math.round(
                        todayEarnings *
                        100
                    ) / 100,

                metricsDate:
                    today,

                metricsUpdatedAt:
                    firebase
                        .database
                        .ServerValue
                        .TIMESTAMP
            };

            await firebase
                .database()
                .ref(
                    `taxis/${driverId}`
                )
                .update(
                    metrics
                );

            if (
                ASIYE_DRIVER.state.driver
            ) {
                Object.assign(
                    ASIYE_DRIVER.state.driver,
                    metrics
                );
            }

            return metrics;

        } catch (error) {
            console.warn(
                'Driver metrics refresh failed:',
                error
            );

            return null;
        }
    },


    rating(driver =
        ASIYE_DRIVER.state
            ?.driver ||
        {}) {

        const count =
            Number(
                driver.ratingSummary
                    ?.count ||
                driver.ratingCount ||
                0
            );

        const total =
            Number(
                driver.ratingSummary
                    ?.total ||
                0
            );

        if (
            count > 0 &&
            Number.isFinite(total)
        ) {
            return {
                count,
                value:
                    total /
                    count
            };
        }

        const legacy =
            Number(
                driver.averageRating ||
                driver.rating ||
                0
            );

        return {
            count,
            value:
                count > 0 &&
                Number.isFinite(
                    legacy
                )
                    ? legacy
                    : null
        };
    }
};

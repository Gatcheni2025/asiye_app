/* ============================================================
   ASIYE PASSENGER V2
   PRICING SERVICE
   ============================================================ */

window.ASIYE = window.ASIYE || {};

ASIYE.pricing = {

    /*
     * Temporary clean V2 pricing.
     * We can replace these with your exact
     * production values later.
     */

    rates: {

        go: {

            baseFare:
                20,

            perKm:
                9,

            minimumFare:
                25
        },


        /*
         * Delivery starts on the same distance tariff as Asiye Go.
         * It is deliberately separate so production delivery pricing
         * can be changed without altering passenger ride pricing.
         */
        delivery: {

            baseFare:
                20,

            perKm:
                9,

            minimumFare:
                25
        },


        club4: {

            /*
             * 4-seater vehicle = 3 paying passengers.
             * The driver seat is never included in the fare split.
             */
            payingPassengers:
                3,

            minimumFare:
                18
        },


        club7: {

            /*
             * Work 7 currently operates with 5 paying passengers.
             */
            payingPassengers:
                5,

            minimumFare:
                15
        }

    },


    calculateDelivery(
        distanceKm
    ) {

        const config =
            this.rates.delivery;


        const distance =
            Math.max(
                0,
                Number(distanceKm || 0)
            );


        const fare =
            Math.max(
                config.minimumFare,
                config.baseFare +
                    distance *
                    config.perKm
            );


        return Math.round(
            fare
        );
    },


    calculate() {

        const distanceKm =
            Number(
                ASIYE.state.route.distanceKm || 0
            );


        const goConfig =
            this.rates.go;


        let goFare =

            goConfig.baseFare +

            (
                distanceKm *
                goConfig.perKm
            );


        goFare = Math.max(

            goConfig.minimumFare,

            goFare
        );


        goFare =
            Math.round(
                goFare
            );


        /*
         * Asiye Work pricing:
         *
         * 1. Start with the Asiye Go route fare.
         * 2. Add 15% to the pool total.
         * 3. Split that total only between PAYING passengers:
         *      Work 4 -> 3 passengers
         *      Work 7 -> 5 passengers
         *
         * Example:
         * R100 Go -> R115 Work pool total
         * Work 4 -> R115 / 3 = R38.33 per passenger
         * Work 7 -> R115 / 5 = R23.00 per passenger
         */

        const workPoolTotal =
            Math.round(
                goFare * 1.15
            );

        const money =
            value =>
                Math.round(
                    Number(value || 0) * 100
                ) / 100;

        const club4Fare =
            money(
                workPoolTotal /
                this.rates.club4
                    .payingPassengers
            );

        const club7Fare =
            money(
                workPoolTotal /
                this.rates.club7
                    .payingPassengers
            );


        return {

            go:
                goFare,

            club4:
                club4Fare,

            club7:
                club7Fare,

            club4Total:
                workPoolTotal,

            club7Total:
                workPoolTotal
        };
    }

};
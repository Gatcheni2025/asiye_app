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

            divisor:
                4,

            minimumFare:
                18
        },


        club7: {

            divisor:
                7,

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
         * Club pricing:
         *
         * Total amount rate split into the number of passengers plus 15%
         */

        const clubDriverFare = Math.round(goFare * 1.15);

        const club4Fare =

            Math.ceil(
                clubDriverFare / 4
            );


        const club7Fare =

            Math.ceil(
                clubDriverFare / 7
            );


        return {

            go:
                goFare,

            club4:
                club4Fare,

            club7:
                club7Fare,

            club4Total:
                club4Fare * 4,

            club7Total:
                club7Fare * 7
        };
    }

};
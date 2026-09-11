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


        club4: {

            divisor:
                4,

            minimumFare:
                18
        },


        club6: {

            divisor:
                6,

            minimumFare:
                15
        }

    },


    calculate() {

        const distanceKm =
            Number(
                ASIYE.state.route
                    .distanceKm ||
                0
            );


        const goConfig =
            this.rates.go;


        let goFare =

            goConfig.baseFare +

            (
                distanceKm *
                goConfig.perKm
            );


        goFare =

            Math.max(

                goConfig.minimumFare,

                goFare
            );


        goFare =
            Math.round(
                goFare
            );


        const club4Fare =

            Math.max(

                this.rates
                    .club4
                    .minimumFare,

                Math.round(
                    goFare /
                    this.rates
                        .club4
                        .divisor
                )
            );


        const club6Fare =

            Math.max(

                this.rates
                    .club6
                    .minimumFare,

                Math.round(
                    goFare /
                    this.rates
                        .club6
                        .divisor
                )
            );


        return {

            go:
                goFare,

            club4:
                club4Fare,

            club6:
                club6Fare
        };
    }

};
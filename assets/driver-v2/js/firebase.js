/* ============================================================
   ASIYE DRIVER V2
   FIREBASE INITIALIZATION
   ============================================================ */

window.ASIYE_DRIVER =
    window.ASIYE_DRIVER || {};


/* ============================================================
   FIREBASE CONFIG
   ============================================================ */

/*
 * IMPORTANT:
 *
 * Use the SAME Firebase project used by
 * Passenger V2 and the original Asiye apps.
 */

const DRIVER_FIREBASE_CONFIG = {

    apiKey: "AIzaSyCX_euO2EEPhfhuG5DTsSi5vCpZ9MFZczY",
              authDomain: "asiye-80386.firebaseapp.com",
              databaseURL: "https://asiye-80386-default-rtdb.firebaseio.com",
              projectId: "asiye-80386",
              storageBucket: "asiye-80386.firebasestorage.app",
              appId: "1:531902350858:web:f8a4a246bf350d50e3c1f3"
          };


/* ============================================================
   INITIALIZE FIREBASE
   ============================================================ */

try {

    if (
        typeof firebase ===
        "undefined"
    ) {

        throw new Error(
            "Firebase SDK has not loaded."
        );
    }


    if (
        firebase.apps &&
        firebase.apps.length > 0
    ) {

        ASIYE_DRIVER.firebaseApp =
            firebase.app();


        console.log(
            "✅ Existing Firebase app reused"
        );

    } else {

        ASIYE_DRIVER.firebaseApp =

            firebase.initializeApp(
                DRIVER_FIREBASE_CONFIG
            );


        console.log(
            "✅ Driver Firebase initialized"
        );
    }


    /* ========================================================
       FIREBASE SERVICES
       ======================================================== */

    ASIYE_DRIVER.auth =
        firebase.auth();


    ASIYE_DRIVER.database =
        firebase.database();


    ASIYE_DRIVER.storage =
        firebase.storage();


    /*
     * Compatibility helper.
     *
     * requests.js and trip-controller.js
     * currently use firebase.database()
     * directly, so no additional changes
     * are required.
     */

    window.database =
        ASIYE_DRIVER.database;


    console.log(
        "✅ Driver Firebase Database ready"
    );


} catch (error) {

    console.error(
        "❌ Driver Firebase initialization failed:",
        error
    );


    window.ASIYE_DRIVER_FIREBASE_ERROR =
        error;
}